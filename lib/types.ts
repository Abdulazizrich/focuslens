export type Locale = 'uz' | 'en';
export type FocusState = 'focus' | 'micro' | 'distract' | 'away' | 'break';
export type DetectionSource = 'cv' | 'activity' | 'ext' | 'user';
export type SessionMode = 'pomodoro' | 'deep' | 'custom';
export type Phase = 'focus' | 'shortBreak' | 'longBreak';

export interface CameraCalibration {
  yaw: number;
  pitch: number;
  eyeOpen: number;
  calibratedAt: number;
}

export interface Settings {
  name: string;
  locale: Locale;
  sensitivity: number;
  graceMs: number;
  showPreview: boolean;
  notifications: boolean;
  onboarded: boolean;
  pomodoro: {
    focus: number;
    shortBreak: number;
    longBreak: number;
    cycles: number;
    autoContinue: boolean;
  };
  blocklist: string[];
  calibration?: CameraCalibration;
}

export interface FocusSession {
  id: string;
  startTs: number;
  endTs: number | null;
  type: SessionMode;
  phase: Phase;
  goalMin: number;
  completed: boolean;
  interrupted: boolean;
}

/** Duration intervals are half-open: [startTs, endTs). Frames are never stored. */
export interface FocusSegment {
  id: string;
  sessionId: string;
  startTs: number;
  endTs: number;
  state: FocusState;
  source: DetectionSource;
}

export interface Achievement {
  key: string;
  titleUz: string;
  titleEn: string;
  descriptionUz: string;
  descriptionEn: string;
  icon: 'target' | 'trophy' | 'flame' | 'sun' | 'shield' | 'clock';
  xp: number;
  unlocked: boolean;
  unlockedAt?: number;
}

export interface TimerSnapshot {
  id: 'timer';
  mode: SessionMode;
  customMin: number;
  phase: Phase;
  totalSec: number;
  remainingSec: number;
  completedCycles: number;
  activeSessionId: string | null;
  running: boolean;
  savedAt: number;
}

export interface DailyStats {
  date: string;
  focusMin: number;
  microMin: number;
  distractMin: number;
  awayMin: number;
  trackedMin: number;
  distractCount: number;
  score: number;
  sessions: number;
  activityMin: number;
  cameraMin: number;
  hourly: number[];
}

export interface RangeStats {
  days: DailyStats[];
  focusMin: number;
  awayMin: number;
  distractCount: number;
  score: number;
  changePercent: number | null;
  previousFocusMin: number;
  hourly: number[];
  heatmap: number[][];
  peakHour: number | null;
  startDate: string;
  endDate: string;
}

export const DEFAULT_SETTINGS: Settings = {
  name: 'Abdulaziz',
  locale: 'uz',
  sensitivity: 55,
  graceMs: 3000,
  showPreview: true,
  notifications: false,
  onboarded: false,
  pomodoro: { focus: 25, shortBreak: 5, longBreak: 15, cycles: 4, autoContinue: false },
  blocklist: ['youtube.com', 'instagram.com', 'tiktok.com'],
};
