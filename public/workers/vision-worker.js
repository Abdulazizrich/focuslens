/* Camera processing runs in this dedicated worker. Pixels are discarded after each inference. */
"use strict";

let detector;
let cvRuntime;
let frameCanvas;
let frameContext;
let estimator;
let initialized = false;
let initializing = false;

function reportError(error) {
  self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
}

async function initialize(options) {
  if (initialized || initializing) return;
  initializing = true;
  try {
    importScripts("./vision-signals.js", "../vision/opencv.js");
    const cvModule = self.cv;
    if (!cvModule) throw new Error("OpenCV runtime is missing.");
    // Older OpenCV builds expose a self-resolving `.then` method, not a Promise.
    // Awaiting that thenable creates an infinite microtask loop, so check the actual type.
    if (cvModule instanceof Promise) cvRuntime = await cvModule;
    else if (cvModule.Mat) cvRuntime = cvModule;
    else {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("OpenCV initialization timed out.")), 30000);
        cvModule.onRuntimeInitialized = () => { clearTimeout(timer); resolve(); };
        cvModule.onAbort = (reason) => { clearTimeout(timer); reject(new Error(String(reason))); };
      });
      cvRuntime = cvModule;
    }
    importScripts("../vision/vision_bundle.js");
    if (!self.vision || !self.vision.FaceLandmarker) throw new Error("MediaPipe runtime is missing.");
    const assetRoot = new URL("../vision/", self.location.href).href;
    const fileset = await self.vision.FilesetResolver.forVisionTasks(assetRoot + "wasm");
    detector = await self.vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: assetRoot + "face_landmarker.task", delegate: "CPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    estimator = new self.FocusVisionSignals.StateEstimator(options || {});
    initialized = true;
    self.postMessage({ type: "ready", engine: "OpenCV + MediaPipe (local)" });
  } catch (error) {
    reportError(error);
  } finally {
    initializing = false;
  }
}

function analyze(bitmap, timestamp) {
  if (!initialized) { bitmap.close(); return; }
  let rgba;
  let gray;
  let faceRegion;
  try {
    if (!frameCanvas || frameCanvas.width !== bitmap.width || frameCanvas.height !== bitmap.height) {
      frameCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      frameContext = frameCanvas.getContext("2d", { willReadFrequently: true });
      if (!frameContext) throw new Error("Local image processing canvas is unavailable.");
    }
    frameContext.drawImage(bitmap, 0, 0);
    const pixels = frameContext.getImageData(0, 0, bitmap.width, bitmap.height);
    rgba = cvRuntime.matFromImageData(pixels);
    gray = new cvRuntime.Mat();
    cvRuntime.cvtColor(rgba, gray, cvRuntime.COLOR_RGBA2GRAY);
    // OpenCV estimates light around the face, avoiding bright backgrounds skewing the signal.
    const result = detector.detectForVideo(bitmap, timestamp);
    const points = result.faceLandmarks[0];
    let brightness;
    if (points && points.length) {
      const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) * gray.cols));
      const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) * gray.rows));
      const maxX = Math.min(gray.cols, Math.ceil(Math.max(...points.map((point) => point.x)) * gray.cols));
      const maxY = Math.min(gray.rows, Math.ceil(Math.max(...points.map((point) => point.y)) * gray.rows));
      if (maxX > minX && maxY > minY) faceRegion = gray.roi(new cvRuntime.Rect(minX, minY, maxX - minX, maxY - minY));
    }
    brightness = cvRuntime.mean(faceRegion || gray)[0];
    const metrics = self.FocusVisionSignals.extractMetrics(result, brightness);
    const sample = estimator.update(metrics, timestamp);
    self.postMessage({ type: "sample", sample });
  } catch (error) {
    reportError(error);
  } finally {
    if (faceRegion) faceRegion.delete();
    if (gray) gray.delete();
    if (rgba) rgba.delete();
    if (frameContext) frameContext.clearRect(0, 0, frameCanvas.width, frameCanvas.height);
    bitmap.close();
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "init") void initialize(message.options);
  else if (message.type === "configure" && estimator) estimator.configure(message.options);
  else if (message.type === "frame") analyze(message.bitmap, message.timestamp);
  else if (message.type === "stop") {
    if (detector) detector.close();
    detector = null;
    initialized = false;
    self.close();
  }
};
