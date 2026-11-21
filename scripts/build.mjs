import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import { loadAssets } from '../src/assets.mjs';
const assets = await loadAssets('public');
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
const server=await readFile('src/server.mjs','utf8');
await writeFile('dist/server/index.js',server+'\nconst assets = '+JSON.stringify(assets)+';\nexport default {fetch: (request, env) => handle(request, env, assets)};\n');
try {
  await copyFile('.openai/hosting.json','dist/.openai/hosting.json');
} catch (error) {
  // Hosting settings are optional for local builds and are kept out of Git.
  if (error.code !== 'ENOENT') throw error;
}
console.log('Worker build ready: dist/server/index.js');
