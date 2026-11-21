import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, cp, link, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, statfs, utimes } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { categoryFor, insights, MAX_SIZE } from '../public/analyze.mjs';
import { localOwner } from '../src/local-store.mjs';

const run = promisify(execFile);
const categoryLabels = { doc: '文档', image: '照片', sheet: '表格', other: '其他' };

function contains(parent, child) {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
}

async function exists(path) {
  try { return await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function safeDirectory(path) {
  await mkdir(path, { recursive: true });
  if (relative(path, await realpath(path))) throw new Error('归档位置包含链接，已停止操作。');
  return path;
}

export async function selectArchiveRoot() {
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $_.DeviceID }"],
  { windowsHide: true, timeout: 15000 });
  const drives = stdout.split(/\s+/).filter(drive => /^[A-Z]:$/i.test(drive));
  const volumes = await Promise.allSettled(drives.map(async drive => {
    const volume = await statfs(drive + '\\', { bigint: true });
    return { drive, free: volume.bavail * volume.bsize };
  }));
  const available = volumes.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  available.sort((a, b) => a.free === b.free ? a.drive.localeCompare(b.drive) : a.free > b.free ? -1 : 1);
  if (!available.length) throw new Error('没有找到可访问的本机硬盘。原件仍在原位置。');
  return join(available[0].drive + '\\', '归序资料库');
}

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function snapshot(path) {
  if (relative(path, await realpath(path))) throw new Error('归档项包含链接。原件仍在原位置。');
  const files = [], directories = [];
  let size = 0;
  async function visit(current, name) {
    const entry = await lstat(current);
    if (entry.isDirectory()) {
      if (name) directories.push(name);
      const children = (await readdir(current)).sort();
      for (const child of children) await visit(join(current, child), name ? name + '/' + child : child);
      return 'folder';
    }
    if (!entry.isFile()) throw new Error('含有链接或特殊文件，无法安全移动整项。原件仍在原位置。');
    const hash = await digest(current);
    files.push({ relative: name, size: entry.size, hash });
    size += entry.size;
    return 'file';
  }
  const kind = await visit(path, '');
  const fingerprint = createHash('sha256').update(JSON.stringify([kind, directories, files])).digest('hex');
  return { kind, files, directories, size, fingerprint };
}

async function destinationFor(root, name, original, id) {
  const subfolder = original.kind === 'folder' ? '整组归档' : join('散件', categoryLabels[categoryFor(name)]);
  let parent = await safeDirectory(join(root, subfolder));
  if (await exists(join(parent, name))) parent = await safeDirectory(join(root, '同名归档', id));
  return join(parent, name);
}

async function registerArchive(store, id, name, target, original) {
  const { DB } = store;
  const now = Date.now(), redundant = [];
  const statements = [DB.prepare('INSERT INTO archives(id,owner,name,kind,path,directories,fingerprint,created) VALUES(?,?,?,?,?,?,?,?)')
    .bind(id, localOwner, name, original.kind, target, JSON.stringify(original.directories), original.fingerprint, now)];
  for (const file of original.files) {
    const fileName = file.relative ? basename(file.relative) : name;
    const sourcePath = file.relative ? name + '/' + file.relative : '';
    let reused = null;
    if (sourcePath) {
      const { results } = await DB.prepare('SELECT id FROM files WHERE owner=? AND archive_id IS NULL AND sample=0 AND source_path=? AND size=? ORDER BY created DESC')
        .bind(localOwner, sourcePath, file.size).all();
      for (const previous of results) {
        const blob = store.legacyBlobPath(localOwner, previous.id);
        if (await digest(blob).catch(() => null) !== file.hash) continue;
        if (!reused) {
          reused = previous.id;
          statements.push(DB.prepare('UPDATE files SET archive_id=?,archive_relative=? WHERE id=? AND owner=?')
            .bind(id, file.relative, reused, localOwner));
        }
        redundant.push(blob);
        // If there are several legacy copies, keep their records and preferences.
        if (previous.id !== reused) {
          statements.push(DB.prepare('UPDATE files SET archive_id=?,archive_relative=? WHERE id=? AND owner=?')
            .bind(id, file.relative, previous.id, localOwner));
        }
      }
    }
    if (reused) continue;
    const analysis = insights(fileName, '', '', '');
    const method = file.size <= MAX_SIZE ? 'pending' : 'format';
    const summary = original.kind === 'folder' ? '已按原文件夹结构归档。' : '已移动到归档盘。';
    statements.push(DB.prepare('INSERT INTO files(id,owner,name,mime,size,category,tags,summary,body,method,created,source_path,archive_id,archive_relative) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(randomUUID(),localOwner,fileName,'application/octet-stream',file.size,analysis.category,JSON.stringify(analysis.tags),summary,'',method,now,sourcePath,id,file.relative));
  }
  await DB.batch(statements);
  // These are private app-created copies whose bytes match the indexed archive.
  await Promise.allSettled(redundant.map(path => rm(path, { force: true })));
}

async function archiveItem(store, root, input, trashItem) {
  const source = resolve(input);
  const name = basename(source);
  if (!name || contains(root, source) || contains(source, root)) throw new Error('无法移动整块硬盘或归档库本身。');
  const { results: saved } = await store.DB.prepare('SELECT path FROM archives WHERE owner=?').bind(localOwner).all();
  if (saved.some(item => contains(item.path, source) || contains(source, item.path))) {
    throw new Error('此项已经在归档库内，请从归序打开它的存储位置。');
  }
  const original = await snapshot(source);
  const { results } = await store.DB.prepare('SELECT path FROM archives WHERE owner=? AND name=? AND fingerprint=?')
    .bind(localOwner, name, original.fingerprint).all();
  let target;
  for (const item of results) {
    if ((await snapshot(item.path).catch(() => null))?.fingerprint === original.fingerprint) {
      target = item.path;
      break;
    }
  }
  if (!target) {
    const volume = await statfs(root, { bigint: true });
    if (BigInt(original.size) > volume.bavail * volume.bsize) throw new Error('归档盘空间不足，原件仍在原位置。');
    const id = randomUUID();
    const temporary = await mkdtemp(join(root, '.待归档-'));
    const staged = join(temporary, name);
    try {
      await cp(source, staged, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      if ((await snapshot(staged)).fingerprint !== original.fingerprint) throw new Error('归档核对未通过，原件仍在原位置。');
      target = await destinationFor(root, name, original, id);
      if (original.kind === 'folder') await rename(staged, target);
      else {
        // Never replace a file that appears in the destination while the copy is running.
        try { await link(staged, target); }
        catch (error) {
          if (!['ENOTSUP', 'EPERM', 'EXDEV', 'ENOSYS'].includes(error.code)) throw error;
          await copyFile(staged, target, constants.COPYFILE_EXCL);
          const timestamps = await lstat(staged);
          await utimes(target, timestamps.atime, timestamps.mtime);
        }
        if ((await snapshot(target)).fingerprint !== original.fingerprint) throw new Error('归档核对未通过，原件仍在原位置。');
      }
      await registerArchive(store, id, name, target, original);
    } finally {
      if (contains(root, temporary) && temporary !== root) {
        await rm(temporary, { force: true, recursive: true }).catch(() => {});
      }
    }
  }
  // The database and verified archive already exist before the source is retired.
  // Recycle remains recoverable even if another program writes to the source late.
  if ((await snapshot(target)).fingerprint !== original.fingerprint) {
    return { name, ...original, warning: '归档位置发生了变化，原件保留在原位置。' };
  }
  if ((await snapshot(source)).fingerprint !== original.fingerprint) {
    return { name, ...original, warning: '归档副本已保存，但源文件发生了变化，原件保留在原位置。' };
  }
  try { await trashItem(source); }
  catch { return { name, ...original, warning: '归档副本已保存，但 Windows 未能移走原件，原件保留在原位置。' }; }
  return { name, ...original };
}

export async function archiveBatch(store, inputs, { root, trashItem, progress }) {
  const chosen = await safeDirectory(root ? resolve(root) : await selectArchiveRoot());
  const paths = [...new Set(inputs.filter(path => typeof path === 'string' && isAbsolute(path)).map(path => resolve(path)))]
    .sort((a, b) => a.length - b.length);
  const sources = paths.filter((path, index) => !paths.slice(0, index).some(parent => contains(parent, path)));
  let completed = 0, files = 0, folders = 0;
  const errors = [];
  for (const [index, path] of sources.entries()) {
    progress(index + 1, sources.length);
    try {
      const result = await archiveItem(store, chosen, path, trashItem);
      if (result.warning) { errors.push(result.name + ' · ' + result.warning); continue; }
      completed++;
      if (result.kind === 'folder') folders++;
      files += result.files.length;
    } catch (error) {
      const message = error.code ? '无法完成移动，原件仍在原位置。' : error.message;
      errors.push(basename(path) + ' · ' + message);
    }
  }
  return { root: chosen, completed, folders, files, errors };
}
