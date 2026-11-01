/* Diagnostic uses Chromium's synthetic camera only, never a physical webcam. */
const { _electron: electron } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const results = path.join(root, "test-results");
fs.mkdirSync(results, { recursive: true });
const env = { ...process.env, FOCUSLENS_TEST_DATA: path.join(results, `camera-profile-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
let app;
(async () => {
  const args = ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--enable-logging=stderr"];
  const options = { args, env, timeout: 60000 };
  if (process.env.FOCUSLENS_PACKAGED_EXE) options.executablePath = process.env.FOCUSLENS_PACKAGED_EXE;
  else args.unshift(root);
  app = await electron.launch(options);
  app.process().stderr.on("data", (chunk) => process.stderr.write(chunk));
  const switches = await app.evaluate(({ app }) => ({
    fakeDevice: app.commandLine.hasSwitch("use-fake-device-for-media-stream"),
    fakeUI: app.commandLine.hasSwitch("use-fake-ui-for-media-stream"),
  }));
  assert.equal(switches.fakeDevice, true, "Refuse camera test without a fake-device switch");
  assert.equal(switches.fakeUI, true);
  const page = await app.firstWindow();
  page.on("console", (message) => console.log("RENDERER", message.type(), message.text()));
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  await page.locator(".timer-digits").waitFor();
  const state = await page.evaluate(async () => {
    const log = [];
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true;
    document.body.append(video);
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 }, facingMode: "user" }, audio: false });
    const track = stream.getVideoTracks()[0];
    for (const event of ["ended", "mute", "unmute"]) track.addEventListener(event, () => log.push({ event, time: performance.now(), readyState: track.readyState }));
    for (const event of ["loadedmetadata", "playing", "pause", "error", "stalled"]) video.addEventListener(event, () => log.push({ videoEvent: event, time: performance.now(), readyState: video.readyState }));
    log.push({ initial: track.readyState, label: track.label, settings: track.getSettings() });
    video.srcObject = stream;
    const playResult = await Promise.race([video.play().then(() => "playing", (error) => error.message), new Promise(resolve => setTimeout(() => resolve("play timeout"), 5000))]);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const result = { log, playResult, readyState: track.readyState, currentTime: video.currentTime, videoReadyState: video.readyState };
    track.stop(); video.srcObject = null; video.remove();
    return result;
  });
  const permissions = 'Production permission handlers, without a test override';
  console.log(JSON.stringify({ switches, state, permissions }, null, 2));
  fs.writeFileSync(path.join(results, "native-camera.json"), JSON.stringify({ switches, state, permissions }, null, 2));
  assert.equal(state.readyState, "live");
  assert.equal(state.playResult, "playing");
  assert.ok(state.currentTime > 1, "Synthetic media must keep advancing");
  console.log("PASS: native synthetic camera continues delivering video.");
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await app?.close(); });
