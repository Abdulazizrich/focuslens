const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../out');
const types = { '.html':'text/html', '.js':'text/javascript', '.cjs':'text/javascript', '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
http.createServer((req, res) => {
  let name;
  try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end(); }
  if (name.endsWith('/')) name += 'index.html';
  else if (!path.extname(name)) name += '/index.html';
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, bytes) => { res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache' }); res.end(error ? 'Not found' : bytes); });
}).listen(4173, '127.0.0.1', () => console.log('FocusLens preview: http://127.0.0.1:4173'));
