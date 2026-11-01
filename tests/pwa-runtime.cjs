/* Real Chromium integration: exported pages, cache completeness, and offline navigation. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const directory = path.resolve(__dirname, '../out');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };

(async () => {
  assert.ok(fs.existsSync(path.join(directory, 'precache-manifest.json')), 'Build the complete offline shell first');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'precache-manifest.json'), 'utf8'));
  let browser;
  const server = http.createServer((request, response) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end(); return; }
    if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (pathname.endsWith('/')) pathname += 'index.html';
    else if (!path.extname(pathname)) pathname += '/index.html';
    const file = path.resolve(directory, '.' + pathname);
    if (!file.startsWith(directory + path.sep)) { response.writeHead(403); response.end(); return; }
    fs.readFile(file, (error, bytes) => {
      if (error) console.error('Missing static path:', pathname);
      response.writeHead(error ? 404 : 200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(error ? 'Not found' : bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const runtimeErrors = [];
  const requestFailures = [];
  const headings = new Map();
  try {
    const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe', chromium.executablePath()].find(candidate => candidate && fs.existsSync(candidate));
    assert.ok(executablePath, 'A Chromium browser is required');
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'allow' });
    const page = await context.newPage();
    page.on('pageerror', error => runtimeErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`${message.text()} ${message.location().url}`); });
    page.on('requestfailed', request => {
      // Chromium may cancel speculative prefetches when navigating to another page.
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') requestFailures.push(`${request.method()} ${request.resourceType()} ${request.url()} ${request.failure()?.errorText} ${JSON.stringify(request.headers())}`);
    });
    await page.goto(`${base}/focus/`);
    await page.locator('h1').waitFor();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.waitForLoadState('networkidle');
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const entries = await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)));
      return { names, paths: entries.flat() };
    });
    assert.ok(cached.names.includes(`focuslens-${manifest.version}`));
    assert.equal(manifest.urls.filter(url => !cached.paths.includes(url)).length, 0, 'Every generated manifest URL must be cached');
    for (const route of ['/focus/', '/dashboard/', '/stats/', '/achievements/', '/settings/', '/onboarding/']) {
      await page.goto(base + route);
      await page.locator('h1').waitFor();
      await page.waitForLoadState('networkidle');
      assert.ok((await page.locator('h1').innerText()).trim(), `${route} should render a page title`);
      headings.set(route.replace(/\/$/, ''), await page.locator('h1').innerText());
    }
    assert.deepEqual(runtimeErrors, [], `Online rendering must be free of errors: ${runtimeErrors.join('\n')}`);
    console.log(`PASS: six exported pages render; all ${manifest.urls.length} shell, font, model, and worker assets are cached.`);
    await context.setOffline(true);
    for (const route of ['/focus/', '/dashboard/', '/stats/', '/achievements/', '/settings/', '/onboarding/']) {
      await page.goto(base + route);
      await page.locator('h1').waitFor();
      await page.waitForLoadState('networkidle');
      await page.reload();
      await page.locator('h1').waitFor();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('h1').innerText(), headings.get(route.replace(/\/$/, '')), `${route} must show its correct offline page`);
    }
    for (const route of ['/focus', '/dashboard', '/stats', '/achievements', '/settings']) {
      await page.locator(`.sidebar nav a[href^="${route}"]`).click();
      await page.waitForURL(url => url.pathname.replace(/\/$/, '') === route);
      await page.locator('h1').waitFor();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('h1').innerText(), headings.get(route), `${route} must navigate to its correct offline page`);
    }
    const offlineAsset = await page.evaluate(async () => {
      const [worker, model, manifest] = await Promise.all(['/workers/vision-worker.js', '/vision/face_landmarker.task', '/manifest.json'].map(url => fetch(url)));
      return [worker.ok, model.ok, manifest.ok];
    });
    assert.deepEqual(offlineAsset, [true, true, true], 'Offline camera and PWA resources must be readable');
    assert.deepEqual(runtimeErrors, [], `Offline navigation must be free of console errors: ${runtimeErrors.join('\n')}`);
    assert.deepEqual(requestFailures, [], `Requests must be served offline: ${requestFailures.join('\n')}`);
    console.log('PASS: offline reloads, all sidebar routes, and camera model fetches work without console exceptions or failed requests.');
  } finally {
    if (runtimeErrors.length) console.error('Browser errors:', runtimeErrors.slice(0, 4));
    if (requestFailures.length) console.error('Request failures:', requestFailures.slice(0, 4));
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
