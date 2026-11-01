export type VisionState = "focus" | "micro" | "distract" | "away";

export interface CameraCalibration {
  yaw: number;
  pitch: number;
  eyeOpen: number;
  calibratedAt: number;
}

export interface VisionSample {
  state: VisionState;
  facePresent: boolean;
  yaw: number;
  pitch: number;
  eyeOpen: number;
  brightness: number;
  /** Recent fraction of observed time with closed eyes; a rest cue, not a diagnosis. */
  fatigue: number;
  /** Measurement quality, not a detector probability or certainty of mental focus. */
  confidence: number;
  quality: "normal" | "lighting";
  time: number;
}

interface CameraOptions {
  sensitivity: number;
  graceMs: number;
  calibration: CameraCalibration | null;
}

interface CalibrationRun {
  resolve: (value: CameraCalibration) => void;
  reject: (reason: Error) => void;
  samples: VisionSample[];
  validMs: number;
  previousTime: number | null;
  timer: ReturnType<typeof setTimeout>;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function cameraMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Kameraga ruxsat berilmadi. Windows sozlamalarida ushbu ilova uchun kamera ruxsatini yoqing.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "Kamera topilmadi. Kamerani ulang va qayta urinib ko‘ring.";
  if (name === "NotReadableError" || name === "TrackStartError") return "Kamera boshqa dasturda band yoki ochilmadi. Boshqa kamera dasturini yoping.";
  if (name === "OverconstrainedError") return "Kamera kerakli video rejimini qo‘llamaydi. Boshqa kameradan foydalaning.";
  if (error instanceof Error && error.message.startsWith("Kamera")) return error.message;
  return "Kamera tahlili ishga tushmadi. Ilovani qayta oching yoki vaqtincha kamerasiz davom eting.";
}

/**
 * Opens a device-local camera and sends transient ImageBitmaps to a dedicated local worker.
 * No video, frames, landmarks, or biometrics are stored, logged, or sent to a server.
 */
export class CameraController {
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private frameWatchdog: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private busy = false;
  private active = false;
  private lastVideoTime = -1;
  private sampleHandler: ((sample: VisionSample) => void) | null = null;
  private errorHandler: ((message: string) => void) | null = null;
  private cancelInitialization: (() => void) | null = null;
  private calibrationRun: CalibrationRun | null = null;
  private options: CameraOptions = { sensitivity: 50, graceMs: 3000, calibration: null };

  get isRunning(): boolean { return this.active; }

  /** Progress reflects actual valid samples, so poor light or missing faces pause calibration. */
  get calibrationProgress(): number {
    return this.calibrationRun ? clamp(this.calibrationRun.validMs / 20000, 0, 1) : 0;
  }

  async start(
    video: HTMLVideoElement,
    onSample: (sample: VisionSample) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.video = video;
    this.sampleHandler = onSample;
    this.errorHandler = onError;

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof Worker === "undefined" || typeof createImageBitmap === "undefined") {
        throw new Error("Kamera uchun ushbu muhit qo‘llab-quvvatlanmaydi. FocusLens ish stoli ilovasidan foydalaning.");
      }
      const worker = new Worker(new URL("/workers/vision-worker.js", window.location.href));
      this.worker = worker;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(new Error("Kamera tahlili juda uzoq yuklanmoqda. Ilovani qayta ishga tushiring.")), 75000);
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.cancelInitialization = null;
          if (error) reject(error); else resolve();
        };
        this.cancelInitialization = () => finish(new DOMException("Camera initialization cancelled", "AbortError"));
        worker.onmessage = (event: MessageEvent) => {
          if (generation !== this.generation) return;
          const message = event.data;
          if (message.type === "ready") finish();
          else if (message.type === "sample") {
            this.busy = false;
            if (this.frameWatchdog) clearTimeout(this.frameWatchdog);
            this.frameWatchdog = null;
            const sample: VisionSample = { ...message.sample, time: Date.now() };
            this.collectCalibration(sample);
            this.sampleHandler?.(sample);
          } else if (message.type === "error") {
            if (!settled) finish(new Error(String(message.message)));
            else this.fail("Kamera tahlili to‘xtadi. Kamerani qayta yoqing yoki kamerasiz davom eting.");
          }
        };
        worker.onerror = () => {
          if (generation !== this.generation) return;
          if (!settled) finish(new Error("Local vision worker failed to load."));
          else this.fail("Kamera tahlili to‘xtadi. Kamerani qayta yoqing.");
        };
        worker.onmessageerror = () => {
          if (generation !== this.generation) return;
          if (!settled) finish(new Error("Local vision worker communication failed."));
          else this.fail("Kamera tahlili bilan aloqa uzildi. Kamerani qayta yoqing.");
        };
        worker.postMessage({ type: "init", options: this.options });
      });
      if (generation !== this.generation) return;
      // Settings may change while WASM is loading; the worker cannot apply them until ready.
      this.configure(this.options);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 }, facingMode: "user" },
        audio: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.onended = () => {
          if (generation === this.generation) this.fail("Kamera uzildi. Kamerani tekshiring va qayta yoqing.");
        };
      }
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (generation !== this.generation) return;
      this.active = true;
      this.lastVideoTime = -1;
      this.capture(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      const message = cameraMessage(error);
      this.fail(message);
      throw new Error(message);
    }
  }

  stop(): void {
    this.generation += 1;
    this.active = false;
    this.cancelInitialization?.();
    this.cancelInitialization = null;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    if (this.frameWatchdog) clearTimeout(this.frameWatchdog);
    this.frameTimer = null;
    this.frameWatchdog = null;
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
    this.busy = false;
    this.sampleHandler = null;
    this.errorHandler = null;
    this.cancelCalibration("Kalibrlash to‘xtatildi.");
  }

  setSensitivity(value: number): void {
    this.options.sensitivity = clamp(Number.isFinite(value) ? value : 50, 0, 100);
    this.configure({ sensitivity: this.options.sensitivity });
  }

  setGraceMs(value: number): void {
    this.options.graceMs = clamp(Number.isFinite(value) ? value : 3000, 1000, 10000);
    this.configure({ graceMs: this.options.graceMs });
  }

  setCalibration(value: CameraCalibration | null = null): void {
    this.options.calibration = value && [value.yaw, value.pitch, value.eyeOpen, value.calibratedAt].every(Number.isFinite)
      ? { yaw: clamp(value.yaw, -90, 90), pitch: clamp(value.pitch, -90, 90), eyeOpen: clamp(value.eyeOpen, 0, 1), calibratedAt: value.calibratedAt }
      : null;
    this.configure({ calibration: this.options.calibration });
  }

  /** Collects 20 seconds of actual, well-lit face samples; rejects instead of inventing a baseline. */
  calibrate(): Promise<CameraCalibration> {
    if (!this.active) return Promise.reject(new Error("Avval kamerani yoqing."));
    this.cancelCalibration("Yangi kalibrlash boshlandi.");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.cancelCalibration("Kalibrlash uchun yetarli aniq tasvir olinmadi. Yorug‘likni yaxshilang, ekranga qarang va qayta urinib ko‘ring."), 45000);
      this.calibrationRun = { resolve, reject, samples: [], validMs: 0, previousTime: null, timer };
    });
  }

  cancelCalibration(message = "Kalibrlash bekor qilindi."): void {
    if (!this.calibrationRun) return;
    const run = this.calibrationRun;
    this.calibrationRun = null;
    clearTimeout(run.timer);
    run.reject(new Error(message));
  }

  private configure(options: Partial<CameraOptions>): void {
    // Only update requested options to avoid resetting grace periods on every UI setting change.
    this.worker?.postMessage({ type: "configure", options });
  }

  private fail(message: string): void {
    const handler = this.errorHandler;
    this.stop();
    handler?.(message);
  }

  private capture(generation: number): void {
    if (!this.active || generation !== this.generation) return;
    this.frameTimer = setTimeout(() => this.capture(generation), 180);
    const video = this.video;
    const worker = this.worker;
    if (!video || !worker || this.busy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime === this.lastVideoTime) return;
    this.busy = true;
    this.lastVideoTime = video.currentTime;
    const width = Math.min(640, video.videoWidth || 640);
    const height = Math.max(1, Math.round(width * (video.videoHeight || 480) / (video.videoWidth || 640)));
    void createImageBitmap(video, { resizeWidth: width, resizeHeight: height }).then((bitmap) => {
      if (!this.active || generation !== this.generation || this.worker !== worker) {
        bitmap.close();
        return;
      }
      this.frameWatchdog = setTimeout(() => {
        if (generation === this.generation) this.fail("Kamera tahlili javob bermadi. Kamerani qayta yoqing.");
      }, 15000);
      try {
        worker.postMessage({ type: "frame", bitmap, timestamp: performance.now() }, [bitmap]);
      } catch (error) {
        bitmap.close();
        throw error;
      }
    }).catch(() => {
      if (generation === this.generation) this.fail("Kameradan tasvir olinmadi. Kamerani qayta yoqing.");
    });
  }

  private collectCalibration(sample: VisionSample): void {
    const run = this.calibrationRun;
    if (!run) return;
    if (!sample.facePresent || sample.confidence < 0.55 || sample.brightness < 35 || sample.brightness > 235 || sample.eyeOpen < 0.45) {
      run.previousTime = null;
      return;
    }
    if (run.previousTime !== null) run.validMs += clamp(sample.time - run.previousTime, 0, 500);
    run.previousTime = sample.time;
    run.samples.push(sample);
    if (run.samples.length > 120) run.samples.shift();
    if (run.validMs < 20000 || run.samples.length < 60) return;
    const mean = (key: "yaw" | "pitch" | "eyeOpen") => run.samples.reduce((sum, item) => sum + item[key], 0) / run.samples.length;
    const yaw = mean("yaw"), pitch = mean("pitch"), eyeOpen = mean("eyeOpen");
    const deviation = (key: "yaw" | "pitch", average: number) => Math.sqrt(run.samples.reduce((sum, item) => sum + (item[key] - average) ** 2, 0) / run.samples.length);
    if (deviation("yaw", yaw) > 8 || deviation("pitch", pitch) > 8) return;
    const calibration = { yaw, pitch, eyeOpen, calibratedAt: Date.now() };
    clearTimeout(run.timer);
    this.calibrationRun = null;
    this.setCalibration(calibration);
    run.resolve(calibration);
  }
}
