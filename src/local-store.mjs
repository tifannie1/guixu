import { createReadStream, createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { realpath, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const migration = new URL('../drizzle/0000_library.sql', import.meta.url);
const sourcePathMigration = new URL('../drizzle/0001_file_source_path.sql', import.meta.url);
const archivesMigration = new URL('../drizzle/0002_archives.sql', import.meta.url);
export const localOwner = 'local-preview';

export function openLocalStore(folder) {
  const blobs = join(folder, 'blobs');
  mkdirSync(blobs, { recursive: true });
  const sql = new DatabaseSync(join(folder, 'library.sqlite'));
  sql.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  sql.exec('BEGIN IMMEDIATE');
  try {
    if (!sql.prepare("SELECT name FROM sqlite_master WHERE name='libraries'").get()) {
      sql.exec(readFileSync(migration, 'utf8'));
    }
    if (!sql.prepare('PRAGMA table_info(files)').all().some(column => column.name === 'source_path')) {
      sql.exec(readFileSync(sourcePathMigration, 'utf8'));
    }
    if (!sql.prepare("SELECT name FROM sqlite_master WHERE name='archives'").get()) {
      sql.exec(readFileSync(archivesMigration, 'utf8'));
    }
    sql.exec('COMMIT');
  } catch (error) {
    sql.exec('ROLLBACK');
    sql.close();
    throw error;
  }

  function prepare(query, values = []) {
    return {
      bind: (...args) => prepare(query, args),
      first: async () => sql.prepare(query).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(query).all(...values) }),
      run: () => sql.prepare(query).run(...values),
    };
  }
  const pathFor = key => join(blobs, Buffer.from(key).toString('base64url'));
  const archiveFile = sql.prepare(
    'SELECT a.path, a.kind, f.archive_relative FROM files f JOIN archives a ON a.id=f.archive_id WHERE f.owner=? AND f.id=?',
  );
  return {
    close: () => sql.close(),
    legacyBlobPath: (owner, id) => pathFor(encodeURIComponent(owner) + '/' + id),
    DB: {
      prepare,
      async batch(statements) {
        sql.exec('BEGIN IMMEDIATE');
        try {
          for (const statement of statements) statement.run();
          sql.exec('COMMIT');
        } catch (error) {
          sql.exec('ROLLBACK');
          throw error;
        }
      },
    },
    BUCKET: {
      async put(key, file) {
        const target = pathFor(key);
        const temporary = target + '.' + randomUUID() + '.tmp';
        try {
          await pipeline(Readable.fromWeb(file.stream()), createWriteStream(temporary, { flags: 'wx' }));
          await rename(temporary, target);
        } finally {
          await rm(temporary, { force: true });
        }
      },
      async get(key) {
        const slash = key.indexOf('/');
        const member = archiveFile.get(decodeURIComponent(key.slice(0, slash)), key.slice(slash + 1));
        let target = pathFor(key);
        try {
          if (member) {
            const expected = resolve(member.path, member.archive_relative);
            const rel = relative(member.path, expected);
            if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || (member.kind === 'folder' && !rel)) return null;
            target = await realpath(expected);
            if (relative(expected, target) || !(await stat(target)).isFile()) return null;
          } else await stat(target);
        }
        catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; }
        return { body: Readable.toWeb(createReadStream(target)) };
      },
      delete: key => rm(pathFor(key), { force: true }),
    },
  };
}
