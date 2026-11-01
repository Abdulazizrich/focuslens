const test = require("node:test");
const assert = require("node:assert/strict");
const { StateEstimator, extractMetrics } = require("../public/workers/vision-signals.js");

const normal = { facePresent: true, yaw: 0, pitch: 0, eyeOpen: 0.95, brightness: 110, confidence: 0.95 };

test("no detected face transitions through grace to away, and return restores focus", () => {
  const estimator = new StateEstimator({ graceMs: 3000 });
  assert.equal(estimator.update(normal, 0).state, "focus");
  const absent = { ...normal, facePresent: false, confidence: 0 };
  assert.equal(estimator.update(absent, 200).state, "micro");
  for (let time = 400; time < 3200; time += 200) estimator.update(absent, time);
  assert.equal(estimator.update(absent, 3200).state, "away");
  assert.equal(estimator.update(normal, 3400).state, "focus");
});

test("ordinary blinking does not create a distraction; prolonged eye closure does", () => {
  const estimator = new StateEstimator({ graceMs: 3000 });
  estimator.update(normal, 0);
  assert.equal(estimator.update({ ...normal, eyeOpen: 0 }, 200).state, "focus");
  assert.equal(estimator.update(normal, 400).state, "focus");
  for (let time = 600; time <= 4000; time += 200) estimator.update({ ...normal, eyeOpen: 0 }, time);
  assert.equal(estimator.update({ ...normal, eyeOpen: 0 }, 4200).state, "distract");
});

test("head turns count only after grace and calibration offsets neutral pose", () => {
  const estimator = new StateEstimator({ graceMs: 2000, calibration: { yaw: 25, pitch: 10, eyeOpen: 0.9 } });
  assert.equal(estimator.update({ ...normal, yaw: 25, pitch: 10 }, 0).state, "focus");
  let sample;
  for (let time = 200; time <= 4000; time += 200) sample = estimator.update({ ...normal, yaw: -30, pitch: 10 }, time);
  assert.equal(sample.state, "distract");
});

test("poor lighting is uncertain and cannot falsely produce focused time", () => {
  const estimator = new StateEstimator();
  const sample = estimator.update({ ...normal, brightness: 10, confidence: 0.1 }, 0);
  assert.equal(sample.state, "micro");
  assert.equal(sample.quality, "lighting");
});

test("a long stopped-camera gap resets absence grace", () => {
  const estimator = new StateEstimator({ graceMs: 1000 });
  const absent = { ...normal, facePresent: false };
  estimator.update(absent, 0);
  estimator.update(absent, 500);
  assert.equal(estimator.update(absent, 1200).state, "away");
  assert.equal(estimator.update(absent, 10000).state, "micro");
});

test("fatigue cue requires observation and measures closed-eye fraction", () => {
  const estimator = new StateEstimator();
  assert.equal(estimator.update(normal, 0).fatigue, 0);
  let sample;
  for (let time = 200; time <= 12000; time += 200) sample = estimator.update({ ...normal, eyeOpen: 0 }, time);
  assert.ok(sample.fatigue > 0.8 && sample.fatigue <= 1);
});

test("face transform and blink scores produce finite physical measurements", () => {
  const points = Array.from({ length: 478 }, (_, index) => ({ x: 0.35 + (index % 2) * 0.3, y: 0.5, z: 0 }));
  const radians = 30 * Math.PI / 180;
  const metrics = extractMetrics({
    faceLandmarks: [points],
    faceBlendshapes: [{ categories: [{ categoryName: "eyeBlinkLeft", score: 0.1 }, { categoryName: "eyeBlinkRight", score: 0.3 }] }],
    facialTransformationMatrixes: [{ data: [Math.cos(radians), 0, -Math.sin(radians), 0, 0, 1, 0, 0, Math.sin(radians), 0, Math.cos(radians), 0, 0, 0, 0, 1] }],
  }, 120);
  assert.ok(Math.abs(metrics.yaw - 30) < 0.001);
  assert.equal(metrics.pitch, 0);
  assert.equal(metrics.eyeOpen, 0.8);
  assert.ok(metrics.confidence > 0.9);
  assert.equal(extractMetrics({ faceLandmarks: [] }, 50).facePresent, false);
});
