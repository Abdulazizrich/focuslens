import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { CameraController, type VisionSample } from "../lib/camera";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: { type: string; options?: Record<string, unknown> }[] = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: { type: string; options?: Record<string, unknown> }) { this.messages.push(structuredClone(message)); }
  terminate() { this.terminated = true; }
  emit(data: unknown) { this.onmessage?.({ data }); }
}

function setup(t: TestContext, getUserMedia?: () => Promise<MediaStream>) {
  FakeWorker.instances = [];
  const track = { onended: null as (() => void) | null, stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  let mediaCalls = 0;
  const globals: Record<string, unknown> = {
    Worker: FakeWorker,
    window: { location: { href: "http://127.0.0.1/" } },
    navigator: { mediaDevices: { getUserMedia: () => { mediaCalls++; return getUserMedia ? getUserMedia() : Promise.resolve(stream); } } },
    createImageBitmap: () => Promise.reject(new Error("No real camera is used in lifecycle tests")),
    HTMLMediaElement: { HAVE_CURRENT_DATA: 2 },
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const controller = new CameraController();
  t.after(() => {
    controller.stop();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const video = { muted: false, playsInline: false, srcObject: null, readyState: 0, pause() {}, play: async () => {} } as unknown as HTMLVideoElement;
  const errors: string[] = [];
  const samples: VisionSample[] = [];
  const start = () => controller.start(video, (sample) => samples.push(sample), (message) => errors.push(message));
  const ready = async () => { const pending = start(); FakeWorker.instances.at(-1)!.emit({ type: "ready" }); await pending; };
  return { controller, video, track, stream, errors, samples, start, ready, mediaCalls: () => mediaCalls, worker: () => FakeWorker.instances.at(-1)! };
}

const face: Omit<VisionSample, "time"> = { state: "focus", facePresent: true, yaw: 3, pitch: -2, eyeOpen: 0.95, brightness: 120, fatigue: 0, confidence: 0.95, quality: "normal" };

test("stopping during worker initialization cancels cleanly without opening a camera", async (t) => {
  const app = setup(t);
  const pending = app.start();
  app.controller.stop();
  await pending;
  assert.equal(app.mediaCalls(), 0);
  assert.equal(app.worker().terminated, true);
  assert.equal(app.controller.isRunning, false);
  assert.deepEqual(app.errors, []);
});

test("camera permission resolving after cancellation immediately releases the returned stream", async (t) => {
  let resolveMedia!: (stream: MediaStream) => void;
  const app = setup(t, () => new Promise((resolve) => { resolveMedia = resolve; }));
  const pending = app.start();
  app.worker().emit({ type: "ready" });
  await Promise.resolve();
  assert.equal(app.mediaCalls(), 1);
  app.controller.stop();
  resolveMedia(app.stream);
  await pending;
  assert.equal(app.track.stopped, true);
  assert.equal(app.video.srcObject, null);
  assert.equal(app.controller.isRunning, false);
});

test("settings changed during model loading are reapplied once the worker is ready", async (t) => {
  const app = setup(t);
  const pending = app.start();
  app.controller.setSensitivity(82);
  app.controller.setGraceMs(5000);
  app.worker().emit({ type: "ready" });
  await pending;
  const applied = app.worker().messages.at(-1)!;
  assert.equal(applied.type, "configure");
  assert.equal(applied.options?.sensitivity, 82);
  assert.equal(applied.options?.graceMs, 5000);
});

test("worker failure stops the camera and reports a recoverable localized error", async (t) => {
  const app = setup(t);
  await app.ready();
  assert.equal(app.controller.isRunning, true);
  app.worker().emit({ type: "error", message: "WASM failed" });
  assert.equal(app.controller.isRunning, false);
  assert.equal(app.track.stopped, true);
  assert.equal(app.video.srcObject, null);
  assert.match(app.errors[0], /Kamera tahlili to‘xtadi/);
});

test("calibration requires a running camera and rejects insufficient actual face samples", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const app = setup(t);
  await assert.rejects(app.controller.calibrate(), /Avval kamerani yoqing/);
  await app.ready();
  const result = assert.rejects(app.controller.calibrate(), /yetarli aniq tasvir olinmadi/);
  for (let index = 0; index < 100; index++) {
    t.mock.timers.tick(200);
    app.worker().emit({ type: "sample", sample: { ...face, facePresent: false } });
  }
  assert.equal(app.controller.calibrationProgress, 0);
  t.mock.timers.tick(25000);
  await result;
});

test("twenty seconds of stable valid face samples create a measured calibration", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const app = setup(t);
  await app.ready();
  const pending = app.controller.calibrate();
  for (let index = 0; index <= 100; index++) {
    t.mock.timers.tick(200);
    app.worker().emit({ type: "sample", sample: face });
  }
  const calibration = await pending;
  assert.equal(calibration.yaw, 3);
  assert.equal(calibration.pitch, -2);
  assert.ok(Math.abs(calibration.eyeOpen - 0.95) < 0.00001);
  assert.equal(calibration.calibratedAt, Date.now());
  assert.equal(app.worker().messages.at(-1)?.options?.calibration !== undefined, true);
});

test("stopping a camera rejects pending calibration and detaches the stream", async (t) => {
  const app = setup(t);
  await app.ready();
  const cancelled = assert.rejects(app.controller.calibrate(), /Kalibrlash to‘xtatildi/);
  app.controller.stop();
  await cancelled;
  assert.equal(app.video.srcObject, null);
  assert.equal(app.track.stopped, true);
});
