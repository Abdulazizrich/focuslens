import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const sections = ['FocusLens third-party notices\n\nThe following libraries are used by the local application. These notices do not change their original licenses.'];
for (const [folder, entry] of Object.entries(lock.packages)) {
  if (!folder || entry.dev) continue;
  const name = folder.replace(/^.*node_modules\//, '');
  let body = '';
  for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'license.txt', 'COPYING']) {
    try { body = await readFile(path.join(folder, file), 'utf8'); break; } catch {}
  }
  sections.push(`\n${'='.repeat(70)}\n${name} ${entry.version}\nLicense: ${entry.license || 'See upstream package'}\n${body || 'See the license declared by the upstream project.'}`);
}
sections.push('\nMediaPipe tasks-vision, face-landmarker model and OpenCV core: Apache License 2.0.\nSources: https://github.com/google-ai-edge/mediapipe and https://github.com/opencv/opencv\nThe @techstark/opencv-js JavaScript packaging wrapper retains its own MIT notice above.\n');
sections.push(await readFile('node_modules/typescript/LICENSE.txt','utf8'));
await mkdir('public/licenses', { recursive: true });
await writeFile('public/licenses/THIRD-PARTY-NOTICES.txt', sections.join('\n'));
console.log('Bundled third-party license notices.');
