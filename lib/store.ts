'use client';

import { create } from 'zustand';
import { db, freshSettings, parseBackup, validateSettings, type FocusBackup } from './db';
import { evaluateAchievements } from './achievements';
import { messages } from './i18n';
import { notify } from './notifs';
import type { Achievement, DetectionSource, FocusSegment, FocusSession, FocusState, Phase, SessionMode, Settings, TimerSnapshot } from './types';

interface FocusStore {
  hydrated: boolean;
  persistenceError: string | null;
  settings: Settings;
  mode: SessionMode;
  customMin: number;
  phase: Phase;
  running: boolean;
  totalSec: number;
  remainingSec: number;
  completedCycles: number;
  currentState: FocusState;
  currentSource: DetectionSource;
  cameraActive: boolean;
  activeSessionId: string | null;
  sessions: FocusSession[];
  segments: FocusSegment[];
  achievements: Achievement[];
  hydrate: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  setMode: (mode: SessionMode, customMin?: number) => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
  tick: () => void;
  recordState: (state: FocusState, source?: DetectionSource) => void;
  setCameraActive: (active: boolean) => void;
  exportData: () => Promise<string>;
  importData: (json: string) => Promise<void>;
}

let deadline = 0;
let accountedUntil = 0;
let lastPersist = 0;
let hydration: Promise<void> | null = null;
let persistTask: Promise<void> | null = null;
const dirtySessions = new Map<string, FocusSession>();
const dirtySegments = new Map<string, FocusSegment>();

const uid = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function phaseDuration(mode: SessionMode, phase: Phase, settings: Settings, customMin: number): number {
  if (phase === 'shortBreak') return settings.pomodoro.shortBreak * 60;
  if (phase === 'longBreak') return settings.pomodoro.longBreak * 60;
  return (mode === 'deep' ? 60 : mode === 'custom' ? customMin : settings.pomodoro.focus) * 60;
}

export function remainingAt(deadlineTs: number, now: number, totalSec: number): number {
  return Math.min(totalSec, Math.max(0, (deadlineTs - now) / 1000));
}

export function nextPhase(phase: Phase, completedCycles: number, cycles: number): { phase: Phase; completedCycles: number } {
  if (phase !== 'focus') return { phase: 'focus', completedCycles };
  const nextCycle = completedCycles + 1;
  return { phase: nextCycle % cycles === 0 ? 'longBreak' : 'shortBreak', completedCycles: nextCycle };
}

function snapshot(): TimerSnapshot {
  const s = useFocusStore.getState();
  return {
    id: 'timer', mode: s.mode, customMin: s.customMin, phase: s.phase,
    totalSec: s.totalSec, remainingSec: s.remainingSec, completedCycles: s.completedCycles,
    activeSessionId: s.activeSessionId, running: s.running, savedAt: Date.now(),
  };
}

function recordInterval(end: number): void {
  const state = useFocusStore.getState();
  if (!state.running || !state.activeSessionId || end <= accountedUntil) return;
  const status = state.phase === 'focus' ? state.currentState : 'break';
  const source = state.phase === 'focus' ? state.currentSource : 'user';
  const last = state.segments[state.segments.length - 1];
  const merge = last && last.sessionId === state.activeSessionId && last.state === status && last.source === source && last.endTs === accountedUntil;
  const segment: FocusSegment = merge
    ? { ...last, endTs: end }
    : { id: uid(), sessionId: state.activeSessionId, startTs: accountedUntil, endTs: end, state: status, source };
  dirtySegments.set(segment.id, segment);
  useFocusStore.setState({ segments: merge ? [...state.segments.slice(0, -1), segment] : [...state.segments, segment] });
  accountedUntil = end;
}

function refreshAchievements(): void {
  const s = useFocusStore.getState();
  const achievements = evaluateAchievements(s.segments, s.sessions, s.achievements);
  const unlocked = achievements.filter(a => a.unlocked && !s.achievements.find(old => old.key === a.key)?.unlocked);
  useFocusStore.setState({ achievements });
  if (s.settings.notifications && unlocked.length) {
    const badge = unlocked[0];
    notify(messages[s.settings.locale].unlocked, s.settings.locale === 'uz' ? badge.titleUz : badge.titleEn);
  }
}

async function persist(): Promise<void> {
  if (!useFocusStore.getState().hydrated) return;
  lastPersist = Date.now();
  const save = async () => {
    refreshAchievements();
    const sessionUpdates = [...dirtySessions.values()];
    const segmentUpdates = [...dirtySegments.values()];
    const timer = snapshot();
    const achievements = useFocusStore.getState().achievements;
    try {
      await db.transaction('rw', db.sessions, db.segments, db.runtime, db.achievements, async () => {
        if (sessionUpdates.length) await db.sessions.bulkPut(sessionUpdates);
        if (segmentUpdates.length) await db.segments.bulkPut(segmentUpdates);
        await db.runtime.put(timer);
        await db.achievements.bulkPut(achievements);
      });
      for (const value of sessionUpdates) if (dirtySessions.get(value.id) === value) dirtySessions.delete(value.id);
      for (const value of segmentUpdates) if (dirtySegments.get(value.id) === value) dirtySegments.delete(value.id);
      useFocusStore.setState({ persistenceError: null });
    } catch {
      useFocusStore.setState({ persistenceError: "Ma'lumotni qurilmaga saqlab bo'lmadi. Zaxira nusxasini eksport qiling. / Local save failed; please export a backup." });
    }
  };
  const queued = (persistTask ?? Promise.resolve()).then(save);
  persistTask = queued;
  await queued;
  if (persistTask === queued) persistTask = null;
}

function closeSession(now: number, completed: boolean): void {
  const s = useFocusStore.getState();
  if (!s.activeSessionId) return;
  const sessions = s.sessions.map(session => session.id === s.activeSessionId
    ? { ...session, endTs: now, completed, interrupted: !completed }
    : session);
  const closed = sessions.find(session => session.id === s.activeSessionId)!;
  dirtySessions.set(closed.id, closed);
  useFocusStore.setState({ sessions, activeSessionId: null });
}

function advance(now = Date.now(), allowAutoContinue = true): void {
  const s = useFocusStore.getState();
  if (!s.running) return;
  const end = Math.min(now, deadline);
  recordInterval(end);
  const remainingSec = remainingAt(deadline, now, s.totalSec);
  useFocusStore.setState({ remainingSec });
  if (remainingSec > 0) return;
  closeSession(deadline, true);
  const next = nextPhase(s.phase, s.completedCycles, s.settings.pomodoro.cycles);
  const totalSec = phaseDuration(s.mode, next.phase, s.settings, s.customMin);
  useFocusStore.setState({ ...next, totalSec, remainingSec: totalSec, running: false, currentState: next.phase === 'focus' ? 'focus' : 'break', currentSource: s.cameraActive ? 'cv' : 'activity' });
  if (s.settings.notifications) {
    const m = messages[s.settings.locale];
    notify(next.phase === 'focus' ? m.breakEnded : m.breakStarted, next.phase === 'focus' ? m.focusBody : m.breakBody, true);
  }
  void persist();
  // Missed time during sleep never manufactures additional sessions.
  if (allowAutoContinue && s.settings.pomodoro.autoContinue) useFocusStore.getState().start();
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  hydrated: false, persistenceError: null, settings: freshSettings(), mode: 'pomodoro', customMin: 45,
  phase: 'focus', running: false, totalSec: 1500, remainingSec: 1500, completedCycles: 0,
  currentState: 'focus', currentSource: 'activity', cameraActive: false, activeSessionId: null,
  sessions: [], segments: [], achievements: evaluateAchievements([], []),

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydration) return hydration;
    hydration = (async () => {
      try {
        const [settingsRow, sessions, segments, achievements, timer] = await Promise.all([
          db.settings.get('default'), db.sessions.orderBy('startTs').toArray(), db.segments.orderBy('startTs').toArray(),
          db.achievements.toArray(), db.runtime.get('timer'),
        ]);
        const settings = settingsRow ? validateSettings(settingsRow.value) : freshSettings();
        const finalIntervals = new Map<string, number>();
        for (const segment of segments) finalIntervals.set(segment.sessionId, Math.max(finalIntervals.get(segment.sessionId) ?? 0, segment.endTs));
        const recovered = sessions.map(session => {
          if (session.endTs !== null) return session;
          const closed = { ...session, endTs: finalIntervals.get(session.id) ?? session.startTs, completed: false, interrupted: true };
          dirtySessions.set(closed.id, closed);
          return closed;
        });
        const mode = timer?.mode ?? 'pomodoro';
        const phase = timer?.phase ?? 'focus';
        const customMin = timer?.customMin ?? 45;
        const totalSec = timer?.totalSec ?? phaseDuration(mode, phase, settings, customMin);
        set({ hydrated: true, settings, sessions: recovered, segments,
          achievements: evaluateAchievements(segments, recovered, achievements), mode, phase, customMin, totalSec,
          remainingSec: Math.max(0, Math.min(totalSec, timer?.remainingSec ?? totalSec)),
          completedCycles: timer?.completedCycles ?? 0, running: false, activeSessionId: null,
          currentState: phase === 'focus' ? 'focus' : 'break',
        });
        await persist();
      } catch {
        set({ hydrated: true, persistenceError: "Mahalliy xotira ochilmadi. Ushbu sessiya faqat xotirada ishlaydi. / Local storage unavailable; export to preserve your session." });
      }
    })();
    return hydration;
  },

  saveSettings: async patch => {
    const previous = get();
    const settings = validateSettings({ ...previous.settings, ...patch, pomodoro: { ...previous.settings.pomodoro, ...patch.pomodoro } });
    set({ settings });
    if (!previous.running && !previous.activeSessionId && previous.remainingSec === previous.totalSec) {
      const duration = phaseDuration(previous.mode, previous.phase, settings, previous.customMin);
      set({ totalSec: duration, remainingSec: duration });
    }
    try {
      await db.settings.put({ id: 'default', value: settings });
      set({ persistenceError: null });
    } catch {
      set({ persistenceError: 'Sozlamalar saqlanmadi. / Settings could not be saved.' });
      throw new Error('Settings could not be saved');
    }
    await persist();
  },

  setMode: (mode, customMin) => {
    if (!['pomodoro', 'deep', 'custom'].includes(mode)) return;
    if (customMin !== undefined && !Number.isFinite(customMin)) return;
    advance(Date.now(), false);
    closeSession(Date.now(), false);
    const minutes = Math.max(1, Math.min(180, customMin ?? get().customMin));
    const totalSec = phaseDuration(mode, 'focus', get().settings, minutes);
    set({ mode, customMin: minutes, phase: 'focus', running: false, totalSec, remainingSec: totalSec, completedCycles: 0, currentState: 'focus' });
    void persist();
  },

  start: () => {
    const s = get();
    if (s.running || !s.hydrated) return;
    const now = Date.now();
    const remainingSec = s.remainingSec > 0 ? s.remainingSec : s.totalSec;
    deadline = now + remainingSec * 1000;
    accountedUntil = now;
    let activeSessionId = s.activeSessionId;
    let sessions = s.sessions;
    if (!activeSessionId) {
      const session: FocusSession = { id: uid(), startTs: now, endTs: null, type: s.mode, phase: s.phase, goalMin: remainingSec / 60, completed: false, interrupted: false };
      activeSessionId = session.id;
      sessions = [...sessions, session];
      dirtySessions.set(session.id, session);
    }
    const hidden = typeof document !== 'undefined' && document.hidden;
    set({ running: true, remainingSec, sessions, activeSessionId,
      currentState: s.phase !== 'focus' ? 'break' : hidden ? 'away' : s.currentState === 'break' ? 'focus' : s.currentState,
      currentSource: hidden ? 'activity' : s.cameraActive ? 'cv' : 'activity',
    });
    void persist();
  },

  pause: () => {
    advance(Date.now(), false);
    set({ running: false });
    void persist();
  },

  reset: () => {
    advance(Date.now(), false);
    closeSession(Date.now(), false);
    const s = get();
    const totalSec = phaseDuration(s.mode, 'focus', s.settings, s.customMin);
    set({ running: false, phase: 'focus', totalSec, remainingSec: totalSec, completedCycles: 0, currentState: 'focus' });
    void persist();
  },

  tick: () => {
    advance();
    if (get().running && Date.now() - lastPersist >= 5000) void persist();
  },

  recordState: (state, source = 'cv') => {
    if (!['focus', 'micro', 'distract', 'away'].includes(state)) return;
    const s = get();
    if (source === 'cv' && !s.cameraActive) return;
    if (source === 'activity' && s.cameraActive && state === 'focus') return;
    if (typeof document !== 'undefined' && document.hidden) { state = 'away'; source = 'activity'; }
    advance();
    if (get().phase === 'focus') set({ currentState: state, currentSource: source });
  },

  setCameraActive: active => {
    advance();
    set({ cameraActive: active, currentSource: active ? 'cv' : 'activity',
      currentState: get().phase === 'focus' ? 'focus' : 'break' });
  },

  exportData: async () => {
    advance();
    await persist();
    const s = get();
    const backup: FocusBackup = {
      app: 'FocusLens', version: 1, exportedAt: new Date().toISOString(), settings: validateSettings(s.settings),
      sessions: s.sessions, segments: s.segments, achievements: s.achievements,
    };
    return JSON.stringify(backup, null, 2);
  },

  importData: async json => {
    // Complete validation before changing the live timer or any stored record.
    const backup = parseBackup(json);
    get().pause();
    if (persistTask) await persistTask;
    await db.transaction('rw', db.sessions, db.segments, db.achievements, db.settings, db.runtime, async () => {
      await Promise.all([db.sessions.clear(), db.segments.clear(), db.achievements.clear(), db.settings.clear(), db.runtime.clear()]);
      await db.sessions.bulkPut(backup.sessions);
      await db.segments.bulkPut(backup.segments);
      await db.achievements.bulkPut(backup.achievements);
      await db.settings.put({ id: 'default', value: backup.settings });
    });
    dirtySegments.clear(); dirtySessions.clear();
    const totalSec = phaseDuration('pomodoro', 'focus', backup.settings, 45);
    set({ settings: backup.settings, sessions: backup.sessions, segments: backup.segments, achievements: backup.achievements,
      mode: 'pomodoro', phase: 'focus', customMin: 45, running: false, totalSec, remainingSec: totalSec,
      completedCycles: 0, activeSessionId: null, currentState: 'focus', persistenceError: null,
    });
    await persist();
  },
}));
