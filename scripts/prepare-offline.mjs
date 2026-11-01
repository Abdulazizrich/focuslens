import { readdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const files = [];
async function visit(dir) { for (const item of await readdir(dir, { withFileTypes:true })) { const file = path.join(dir,item.name); if(item.isDirectory()) await visit(file); else if(!file.endsWith('.map') && !file.endsWith('sw.js') && !file.endsWith('precache-manifest.json')) files.push(file.replaceAll('\\','/')); } }
await visit('out');
// Next's Windows static export can emit segment paths as directories while the
// client requests dot-separated names. Include both names in the offline shell.
for (const file of [...files]) {
  const normalized = file.replaceAll('\\', '/');
  const marker = normalized.indexOf('/__next.');
  if (marker < 0 || !normalized.endsWith('.txt')) continue;
  const tail = normalized.slice(marker + 1);
  if (!tail.includes('/')) continue;
  const alias = normalized.slice(0, marker + 1) + tail.replaceAll('/', '.');
  await copyFile(file, alias);
  if (!files.includes(alias)) files.push(alias);
}
files.sort();
const hash = createHash('sha256');
for (const file of files) hash.update(await readFile(file));
await writeFile('out/precache-manifest.json', JSON.stringify({ version:hash.digest('hex').slice(0,16), urls:files.map(f=>'/' + f.replaceAll('\\','/').replace(/^out\//,'')) }));
console.log(`Offline shell: ${files.length} bundled assets, including camera models.`);
