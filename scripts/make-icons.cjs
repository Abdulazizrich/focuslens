const fs = require('node:fs');
const sharp = require('sharp');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0f172a"/><g fill="none" stroke="#14b8a6" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"><path d="M176 112h-40q-24 0-24 24v40m224-64h40q24 0 24 24v40M112 336v40q0 24 24 24h40m160 0h40q24 0 24-24v-40"/><circle cx="256" cy="256" r="70"/></g><circle cx="256" cy="256" r="15" fill="#14b8a6"/></svg>`;
(async()=>{
  fs.mkdirSync('build',{recursive:true}); fs.mkdirSync('public/icons',{recursive:true});
  fs.writeFileSync('public/icons/logo.svg',svg);
  for(const size of [192,512]) await sharp(Buffer.from(svg)).resize(size,size).png().toFile(`public/icons/icon-${size}.png`);
  const png = await sharp(Buffer.from(svg)).resize(256,256).png().toBuffer();
  const header=Buffer.alloc(22); header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(png.length,14);header.writeUInt32LE(22,18);
  fs.writeFileSync('build/icon.ico',Buffer.concat([header,png]));
})();
