import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const types = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', svg: 'image/svg+xml',
};

export async function loadAssets(root) {
  const assets = Object.create(null);
  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const url = prefix + '/' + entry.name;
      if (entry.isDirectory()) {
        await walk(path, url);
      } else if (entry.isFile()) {
        const extension = entry.name.split('.').at(-1);
        const binary = ['bcmap', 'ttf', 'pfb'].includes(extension);
        const type = types[extension] || (binary ? 'application/octet-stream' : 'text/plain; charset=utf-8');
        assets[url] = [type, await readFile(path, binary ? 'base64' : 'utf8'), binary];
      }
    }
  }
  await walk(root, '');
  return assets;
}
