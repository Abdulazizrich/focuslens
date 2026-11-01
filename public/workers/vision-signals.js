/* Pure, testable interpretation of local vision measurements. No camera frames leave this module. */
(function (root) {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

  function extractMetrics(result, brightness) {
    const points = result.faceLandmarks && result.faceLandmarks[0];
    if (!points || points.length < 264) {
      return { facePresent: false, yaw: 0, pitch: 0, eyeOpen: 0, brightness, confidence: 0 };
    }
    const matrix = result.facialTransformationMatrixes && result.facialTransformationMatrixes[0];
    let yaw = 0;
    let pitch = 0;
    if (matrix && matrix.data && matrix.data.length === 16) {
      // MediaPipe's column-major face transform, interpreted as Rz * Ry * Rx.
      const m = matrix.data;
      yaw = Math.atan2(-m[2], Math.hypot(m[0], m[1])) * 180 / Math.PI;
      pitch = Math.atan2(m[6], m[10]) * 180 / Math.PI;
    } else {
      const left = points[33], right = points[263], nose = points[1];
      const midX = (left.x + right.x) / 2;
      const eyeWidth = Math.max(0.01, Math.abs(left.x - right.x));
      yaw = Math.atan2(nose.x - midX, eyeWidth * 0.65) * 180 / Math.PI;
      const mouth = points[13], eyeY = (left.y + right.y) / 2;
      pitch = ((nose.y - eyeY) / Math.max(0.01, mouth.y - eyeY) - 0.55) * 70;
    }

    const shapes = result.faceBlendshapes && result.faceBlendshapes[0];
    const categories = shapes && shapes.categories || [];
    const leftBlink = categories.find((shape) => shape.categoryName === "eyeBlinkLeft");
    const rightBlink = categories.find((shape) => shape.categoryName === "eyeBlinkRight");
    let eyeOpen;
    if (leftBlink && rightBlink) {
      eyeOpen = 1 - (leftBlink.score + rightBlink.score) / 2;
    } else {
      const distance = (a, b) => Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
      const leftEar = (distance(160, 144) + distance(158, 153)) / (2 * Math.max(0.001, distance(33, 133)));
      const rightEar = (distance(385, 380) + distance(387, 373)) / (2 * Math.max(0.001, distance(362, 263)));
      eyeOpen = clamp(((leftEar + rightEar) / 2 - 0.06) / 0.22, 0, 1);
    }

    // The API does not expose detector probability. This is an explicit measurement-quality
    // score based on illumination, face size, and availability of a pose matrix.
    const xs = points.map((point) => point.x);
    const faceWidth = Math.max(...xs) - Math.min(...xs);
    const illumination = clamp((brightness - 12) / 55, 0, 1) * clamp((255 - brightness) / 35, 0, 1);
    const sizeQuality = clamp(faceWidth / 0.2, 0, 1);
    const confidence = clamp(illumination * sizeQuality * (matrix ? 0.95 : 0.7), 0, 0.95);
    return {
      facePresent: true,
      yaw: clamp(finite(yaw), -90, 90),
      pitch: clamp(finite(pitch), -90, 90),
      eyeOpen: clamp(finite(eyeOpen), 0, 1),
      brightness: clamp(finite(brightness), 0, 255),
      confidence,
    };
  }

  class StateEstimator {
    constructor(options = {}) {
      this.calibration = options.calibration || { yaw: 0, pitch: 0, eyeOpen: 0.9 };
      this.sensitivity = clamp(finite(options.sensitivity, 50), 0, 100);
      this.graceMs = clamp(finite(options.graceMs, 3000), 1000, 10000);
      this.reset();
    }

    reset() {
      this.smoothed = null;
      this.absentSince = null;
      this.turnedSince = null;
      this.closedSince = null;
      this.lastTime = null;
      this.closedWindow = [];
    }

    configure(options) {
      if ("calibration" in options) {
        this.calibration = options.calibration || { yaw: 0, pitch: 0, eyeOpen: 0.9 };
        this.reset();
      }
      if ("sensitivity" in options) this.sensitivity = clamp(finite(options.sensitivity, 50), 0, 100);
      if ("graceMs" in options) this.graceMs = clamp(finite(options.graceMs, 3000), 1000, 10000);
    }

    update(raw, time) {
      if (this.lastTime !== null && (time - this.lastTime > 2500 || time < this.lastTime)) this.reset();
      const interval = this.lastTime === null ? 0 : clamp(time - this.lastTime, 0, 1000);
      this.lastTime = time;
      let state = "focus";
      const lightOkay = raw.brightness >= 25 && raw.brightness <= 245;

      if (!raw.facePresent) {
        if (this.absentSince === null) this.absentSince = time;
        this.turnedSince = null;
        this.closedSince = null;
        this.smoothed = null;
        state = time - this.absentSince >= this.graceMs ? "away" : "micro";
      } else {
        this.absentSince = null;
        const previous = this.smoothed || raw;
        this.smoothed = {
          yaw: previous.yaw * 0.55 + raw.yaw * 0.45,
          pitch: previous.pitch * 0.55 + raw.pitch * 0.45,
          eyeOpen: previous.eyeOpen * 0.3 + raw.eyeOpen * 0.7,
        };
        const yawThreshold = 36 - this.sensitivity * 0.2;
        const pitchThreshold = 30 - this.sensitivity * 0.14;
        const turned = Math.abs(this.smoothed.yaw - this.calibration.yaw) > yawThreshold ||
          Math.abs(this.smoothed.pitch - this.calibration.pitch) > pitchThreshold;
        const closed = this.smoothed.eyeOpen < Math.max(0.18, this.calibration.eyeOpen * 0.38);
        if (turned) {
          if (this.turnedSince === null) this.turnedSince = time;
        } else this.turnedSince = null;
        if (closed) {
          if (this.closedSince === null) this.closedSince = time;
        } else this.closedSince = null;

        this.closedWindow.push({ time, duration: interval, closed });
        this.closedWindow = this.closedWindow.filter((entry) => entry.time >= time - 60000);
        if (this.turnedSince !== null) state = time - this.turnedSince >= this.graceMs ? "distract" : "micro";
        // Ordinary blinks do not count as distractions.
        if (this.closedSince !== null && time - this.closedSince >= 1000) {
          state = time - this.closedSince >= Math.max(2000, this.graceMs) ? "distract" : "micro";
        }
        // Low illumination is uncertainty, not evidence of attention.
        if (!lightOkay || raw.confidence < 0.3) state = "micro";
      }

      this.closedWindow = this.closedWindow.filter((entry) => entry.time >= time - 60000);
      const observedMs = this.closedWindow.reduce((total, entry) => total + entry.duration, 0);
      const closedMs = this.closedWindow.reduce((total, entry) => total + (entry.closed ? entry.duration : 0), 0);
      // Eye-closure fraction is an approximate rest cue, never a medical diagnosis.
      const fatigue = observedMs >= 10000 ? clamp(closedMs / observedMs, 0, 1) : 0;
      return { ...raw, state, fatigue, time, quality: lightOkay ? "normal" : "lighting" };
    }
  }

  const api = { extractMetrics, StateEstimator };
  root.FocusVisionSignals = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
