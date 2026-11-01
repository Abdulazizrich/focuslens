/* Offline integration: actual WASM engines process blank and public-domain portrait frames. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const publicDirectory = path.resolve(__dirname, "../public");
const mime = { ".js": "text/javascript", ".wasm": "application/wasm", ".task": "application/octet-stream", ".json": "application/json", ".png": "image/png" };

(async () => {
  let browser;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Vision integration test</title><p>Local vision integration test</p>");
      return;
    }
    if (url.pathname === "/fixture-astronaut.png") {
      response.setHeader("Content-Type", "image/png");
      fs.createReadStream(path.join(__dirname, "vision-fixtures/astronaut.png")).pipe(response);
      return;
    }
    const file = path.resolve(publicDirectory, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(publicDirectory + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404); response.end(); return;
    }
    response.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const systemBrowsers = [
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      chromium.executablePath(),
    ];
    const executablePath = systemBrowsers.find((candidate) => candidate && fs.existsSync(candidate));
    if (!executablePath) throw new Error("No Chromium browser is installed for the vision runtime smoke test.");
    browser = await chromium.launch({ executablePath, headless: true, args: ["--enable-unsafe-swiftshader"] });
    const context = await browser.newContext();
    const outbound = [];
    await context.route("**/*", (route) => {
      if (route.request().url().startsWith("http://127.0.0.1:")) return route.continue();
      outbound.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(() => new Promise((resolve, reject) => {
      const worker = new Worker("/workers/vision-worker.js");
      const timer = setTimeout(() => { worker.terminate(); reject(new Error("Vision worker timed out")); }, 90000);
      let ready = false;
      const samples = [];
      let timestamp = 0;
      const sendBlank = () => {
        const canvas = new OffscreenCanvas(640, 480);
        const context = canvas.getContext("2d");
        context.fillStyle = "#808080";
        context.fillRect(0, 0, 640, 480);
        const bitmap = canvas.transferToImageBitmap();
        worker.postMessage({ type: "frame", bitmap, timestamp: timestamp += 200 }, [bitmap]);
      };
      worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.onmessage = async (event) => {
        if (event.data.type === "error") {
          clearTimeout(timer); worker.terminate(); reject(new Error(event.data.message));
        } else if (event.data.type === "ready") {
          ready = true;
          sendBlank();
        } else if (event.data.type === "sample") {
          samples.push(event.data.sample);
          if (samples.length === 1) {
            try {
              const response = await fetch("/fixture-astronaut.png");
              if (!response.ok) throw new Error("Public-domain face test fixture is missing");
              const bitmap = await createImageBitmap(await response.blob());
              worker.postMessage({ type: "frame", bitmap, timestamp: timestamp += 200 }, [bitmap]);
            } catch (error) {
              clearTimeout(timer); worker.terminate(); reject(error);
            }
            return;
          }
          // Exercise tracking loss and the full away grace period after a detected face.
          if (samples.length < 19) { sendBlank(); return; }
          clearTimeout(timer);
          worker.terminate();
          resolve({ ready, blank: samples[0], portrait: samples[1], last: samples.at(-1), frames: samples.length });
        }
      };
      worker.postMessage({ type: "init", options: { graceMs: 3000, sensitivity: 50 } });
    }));
    assert.equal(result.ready, true);
    assert.equal(result.blank.facePresent, false);
    assert.equal(result.blank.state, "micro");
    assert.ok(Math.abs(result.blank.brightness - 128) <= 1);
    assert.equal(result.portrait.facePresent, true, "The actual face model should detect the public-domain portrait");
    assert.ok(result.portrait.confidence >= 0.55, "Detected face should have sufficient measurement quality to calibrate");
    assert.ok(["yaw", "pitch", "eyeOpen", "brightness", "fatigue"].every((key) => Number.isFinite(result.portrait[key])));
    assert.equal(result.last.facePresent, false);
    assert.equal(result.last.state, "away");
    assert.equal(outbound.length, 0, "Vision initialization and inference must be entirely local");
    console.log("PASS: offline OpenCV + MediaPipe detected a public-domain portrait, rejected gray frames, and transitioned to away after grace.");
    console.log(JSON.stringify(result));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
