const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results');
fs.mkdirSync(results, { recursive: true });
const profile = path.join(results, `desktop-profile-${Date.now()}`);
const env = { ...process.env, FOCUSLENS_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const outbound = [];
const nativeErrors = [];

async function launch() {
  const options = { env, timeout: 60000, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--enable-logging=stderr'] };
  if (process.env.FOCUSLENS_PACKAGED_EXE) options.executablePath = process.env.FOCUSLENS_PACKAGED_EXE;
  else options.args.unshift(root);
  app = await electron.launch(options);
  app.process().stderr.on('data', chunk => nativeErrors.push(String(chunk)));
  await app.evaluate(({ app }) => { app.on('child-process-gone', (_event, details) => console.error('CHILD_PROCESS_GONE', JSON.stringify(details))); });
  assert.equal(await app.evaluate(({ app }) => app.commandLine.hasSwitch('use-fake-device-for-media-stream')), true, 'Never open physical camera hardware in automated tests');
  const page = await app.firstWindow();
  // Exercise the installed app's normal visible window behavior for media and screenshots.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.showInactive()));
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) outbound.push(request.url()); });
  await page.locator('.timer-digits').waitFor();
  await page.evaluate(() => {
    window.testMediaEvents = [];
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.testMediaEvents.push({ event: 'requested', time: Date.now() });
      try {
        const stream = await getUserMedia(constraints);
        window.testMediaEvents.push({ event: 'opened', time: Date.now() });
        stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => window.testMediaEvents.push({ event: 'ended', time: Date.now() })));
        return stream;
      } catch (error) {
        window.testMediaEvents.push({ event: error.name, time: Date.now() });
        throw error;
      }
    };
  });
  return page;
}

(async () => {
  let page = await launch();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined', 'Renderer must not expose Node');
  assert.equal(await page.evaluate(() => window.focuslens.desktop), true);
  assert.equal((await page.evaluate(() => window.focuslens.aiStatus())).configured, false);
  console.log('PASS: secure desktop bridge');

  await page.getByRole('link', { name: 'Sozlamalar', exact: true }).click();
  await page.getByRole('combobox').first().selectOption('en');
  await page.locator('.duration-fields input').nth(0).fill('1');
  await page.locator('.duration-fields input').nth(1).fill('1');
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click();
  await page.getByText('Your focus. Your rules.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Focus', exact: true }).click();
  assert.equal(await page.locator('.timer-digits').innerText(), '01:00');
  console.log('PASS: settings and language saved');

  // Synthetic camera only: no physical webcam is opened by this test.
  if (!process.env.FOCUSLENS_SKIP_CAMERA_TEST) {
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.notice.error') || [...document.querySelectorAll('button')].some(button => button.textContent.includes('Turn camera off')), null, { timeout: 120000 });
  assert.equal(await page.locator('.notice.error').count(), 0, 'Camera startup must succeed');
  await page.getByRole('button', { name: 'Turn camera off', exact: true }).waitFor({ timeout: 120000 });
  await page.locator('.signal-row').waitFor({ timeout: 30000 });
  const firstFrame = await page.locator('video').evaluate(v => v.currentTime);
  await page.waitForFunction(time => {
    const video = document.querySelector('video');
    return video?.srcObject?.getVideoTracks()[0]?.readyState === 'live' && video.currentTime >= time + 8;
  }, firstFrame, { timeout: 20000 });
  assert.equal(await page.getByRole('button', { name: 'Turn camera off', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  assert.equal(await page.locator('video').evaluate(v => v.srcObject), null);
  assert.equal(await page.locator('.notice.error').count(), 0, 'Camera must stop cleanly');
  await page.getByRole('button', { name: 'Enable camera', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.notice.error') || [...document.querySelectorAll('button')].some(button => button.textContent.includes('Turn camera off')), null, { timeout: 120000 });
  assert.equal(await page.locator('.notice.error').count(), 0, 'Camera must reopen after stopping');
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video?.srcObject?.getVideoTracks()[0]?.readyState === 'live' && video.currentTime >= 3 && document.querySelector('.signal-row');
  }, null, { timeout: 20000 });
  await page.getByRole('button', { name: 'Turn camera off', exact: true }).click();
  assert.equal(await page.locator('video').evaluate(v => v.srcObject), null);
  assert.equal(await page.locator('.notice.error').count(), 0);
  console.log('PASS: synthetic camera inference');
  }

  // Advance wall-clock time while keeping browser rendering and media clocks running.
  const timerStart = Date.now();
  await page.clock.setFixedTime(timerStart);
  await page.getByRole('button', { name: 'Start focus', exact: true }).click();
  await page.clock.setFixedTime(timerStart + 7000);
  await page.waitForFunction(() => document.querySelector('.timer-digits')?.textContent === '00:53');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await page.locator('.timer-digits').innerText();
  assert.equal(paused, '00:53');
  await page.clock.setFixedTime(timerStart + 10000);
  assert.equal(await page.locator('.timer-digits').innerText(), paused);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.clock.setFixedTime(timerStart + 64000);
  // Give the real interval a turn to observe the advanced wall clock.
  await page.getByText('TIME FOR A BREAK', { exact: true }).waitFor();
  assert.equal(await page.locator('.timer-content .eyebrow').innerText(), 'TIME FOR A BREAK');
  assert.equal(await page.locator('.timer-digits').innerText(), '01:00');
  assert.equal(await page.locator('.notice.error').count(), 0, 'Camera must remain stopped without errors during a session');
  await page.screenshot({ path: path.join(results, 'desktop-focus.png'), fullPage: true, animations: 'disabled', timeout: 60000 });
  console.log('PASS: pause, resume and focus-to-break transition');

  await page.getByRole('link', { name: 'Statistics', exact: true }).click();
  await page.getByText('See your focus take shape.', { exact: true }).waitFor();
  assert.match(await page.locator('.stats-mini').innerText(), /Total sessions\s*1/);
  await page.getByRole('button', { name: 'Open AI assistant', exact: true }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.locator('.ai-response').waitFor();
  assert.match(await page.locator('.ai-response').innerText(), /Local insight/);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: path.join(results, 'desktop-stats.png'), fullPage: true, animations: 'disabled', timeout: 60000 });
  console.log('PASS: statistics and local AI');

  for (const [label, file] of [['Dashboard', 'dashboard'], ['Achievements', 'achievements'], ['Settings', 'settings']]) {
    await page.getByRole('link', { name: label, exact: true }).click();
    await page.locator('h1').waitFor();
    await page.screenshot({ path: path.join(results, `desktop-${file}.png`), fullPage: true, animations: 'disabled', timeout: 60000 });
  }

  const fakeKey = 'sk-focuslens-integration-test-key';
  await page.evaluate(key => window.focuslens.setApiKey(key), fakeKey);
  assert.equal((await page.evaluate(() => window.focuslens.aiStatus())).configured, true);
  const encrypted = fs.readFileSync(path.join(profile, 'deepseek-key.bin'));
  assert.equal(encrypted.includes(Buffer.from(fakeKey)), false, 'Saved key must be encrypted');
  await page.evaluate(() => window.focuslens.setApiKey(''));
  assert.equal((await page.evaluate(() => window.focuslens.aiStatus())).configured, false);

  await page.getByRole('link', { name: 'Focus', exact: true }).click();
  await app.close(); app = null;
  page = await launch();
  assert.equal(await page.locator('.timer-digits').innerText(), '01:00');
  assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).count(), 0, 'Reload must not auto-resume');
  await page.getByRole('link', { name: 'Statistics', exact: true }).click();
  assert.match(await page.locator('.stats-mini').innerText(), /Total sessions\s*1/);
  assert.deepEqual(outbound, [], 'No remote requests without an explicit configured AI request');
  assert.deepEqual(errors, [], 'No renderer exceptions');
  assert.doesNotMatch(nativeErrors.join(''), /violates the following Content Security Policy|CHILD_PROCESS_GONE.*"reason":"crashed"/, 'No blocked local assets or native service crashes');
  fs.writeFileSync(path.join(results, 'desktop-smoke.json'), JSON.stringify({ passed: true, packaged: Boolean(process.env.FOCUSLENS_PACKAGED_EXE), checks: ['sandboxed renderer', 'bilingual settings', 'fake-camera local inference', 'pause/resume', 'focus to break', 'analytics', 'local AI', 'encrypted key storage', 'restart persistence', 'no remote requests'] }, null, 2));
  console.log('PASS: Desktop integration, camera, timer, analytics, privacy and restart persistence.');
})().catch(async error => { console.error(error); console.error('Native errors:', nativeErrors.join('').slice(-6000)); console.error('Renderer errors:', errors); const p = app?.windows()[0]; if(p) { console.error('Camera events:', await p.evaluate(() => window.testMediaEvents)); console.error('Page:', p.url(), (await p.locator('body').innerText()).slice(0,8000)); await p.screenshot({ path:path.join(results,'desktop-failure.png'), fullPage:true }); } process.exitCode = 1; }).finally(async () => { await app?.close(); });
