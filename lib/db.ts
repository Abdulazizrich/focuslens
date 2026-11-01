import Dexie, { type Table } from 'dexie';
import { evaluateAchievements } from './achievements';
import { DEFAULT_SETTINGS, type Achievement, type FocusSegment, type FocusSession, type Settings, type TimerSnapshot } from './types';

interface SettingsRow { id: 'default'; value: Settings }

class FocusDatabase extends Dexie {
  sessions!: Table<FocusSession, string>;
  segments!: Table<FocusSegment, string>;
  achievements!: Table<Achievement, string>;
  settings!: Table<SettingsRow, string>;
  runtime!: Table<TimerSnapshot, string>;

  constructor() {
    super('FocusLensLocal');
    this.version(1).stores({
      sessions: 'id,startTs,endTs,type',
      segments: 'id,sessionId,startTs,endTs,state',
      achievements: 'key,unlockedAt',
      settings: 'id',
      runtime: 'id',
    });
  }
}

export const db = new FocusDatabase();
const allowedStates = new Set(['focus', 'micro', 'distract', 'away', 'break']);
const allowedModes = new Set(['pomodoro', 'deep', 'custom']);
const allowedPhases = new Set(['focus', 'shortBreak', 'longBreak']);
const allowedSources = new Set(['cv', 'activity', 'ext', 'user']);

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid data object');
  return value as Record<string, unknown>;
}

function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid numeric value');
  return value;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid text value');
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid boolean value');
  return value;
}

/** Whitelisting prevents credentials and unknown fields entering backups or IndexedDB. */
export function validateSettings(input: unknown): Settings {
  const value = object(input);
  const pomodoro = object(value.pomodoro);
  const name = text(value.name, 60).trim();
  if (!name || !['uz', 'en'].includes(String(value.locale))) throw new Error('Invalid name or language');
  if (!Array.isArray(value.blocklist) || value.blocklist.length > 100) throw new Error('Invalid blocklist');
  const blocklist = [...new Set(value.blocklist.map(item => {
    const host = text(item, 253).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) throw new Error('Blocklist entries must be domain names');
    return host;
  }))];
  const result: Settings = {
    name, locale: value.locale as Settings['locale'],
    sensitivity: number(value.sensitivity, 0, 100), graceMs: number(value.graceMs, 2000, 5000),
    showPreview: boolean(value.showPreview), notifications: boolean(value.notifications), onboarded: boolean(value.onboarded),
    pomodoro: {
      focus: number(pomodoro.focus, 1, 180), shortBreak: number(pomodoro.shortBreak, 1, 60),
      longBreak: number(pomodoro.longBreak, 1, 120), cycles: number(pomodoro.cycles, 1, 12),
      autoContinue: boolean(pomodoro.autoContinue),
    },
    blocklist,
  };
  if (!Number.isInteger(result.pomodoro.cycles)) throw new Error('Cycles must be a whole number');
  if (value.calibration !== undefined && value.calibration !== null) {
    const calibration = object(value.calibration);
    result.calibration = {
      yaw: number(calibration.yaw, -180, 180), pitch: number(calibration.pitch, -180, 180),
      eyeOpen: number(calibration.eyeOpen, 0, 1), calibratedAt: number(calibration.calibratedAt, 0, Date.now() + 300_000),
    };
  }
  return result;
}

export interface FocusBackup {
  app: 'FocusLens';
  version: 1;
  exportedAt: string;
  settings: Settings;
  sessions: FocusSession[];
  segments: FocusSegment[];
  achievements: Achievement[];
}

export function parseBackup(json: string): FocusBackup {
  if (json.length > 20_000_000) throw new Error('Backup exceeds the 20 MB limit');
  const data = object(JSON.parse(json));
  if (data.app !== 'FocusLens' || data.version !== 1) throw new Error('Unsupported FocusLens backup');
  if (!Array.isArray(data.sessions) || data.sessions.length > 20_000 || !Array.isArray(data.segments) || data.segments.length > 100_000) {
    throw new Error('Backup has too many records or an invalid structure');
  }
  const minTs = new Date(2000, 0, 1).getTime();
  const maxTs = Date.now() + 300_000;
  const sessionIds = new Set<string>();
  const sessions: FocusSession[] = data.sessions.map(item => {
    const s = object(item);
    const id = text(s.id, 100);
    if (!id || sessionIds.has(id)) throw new Error('Duplicate session identifier');
    sessionIds.add(id);
    if (!allowedModes.has(String(s.type)) || !allowedPhases.has(String(s.phase))) throw new Error('Unknown session type');
    const startTs = number(s.startTs, minTs, maxTs);
    const endTs = s.endTs === null ? null : number(s.endTs, startTs, maxTs);
    return {
      id, startTs, endTs, type: s.type as FocusSession['type'], phase: s.phase as FocusSession['phase'],
      goalMin: number(s.goalMin, 0, 180), completed: boolean(s.completed), interrupted: boolean(s.interrupted),
    };
  });
  const segmentIds = new Set<string>();
  const sessionsById = new Map(sessions.map(s => [s.id, s]));
  const segments: FocusSegment[] = data.segments.map(item => {
    const s = object(item);
    const id = text(s.id, 100);
    const sessionId = text(s.sessionId, 100);
    if (!id || segmentIds.has(id) || !sessionIds.has(sessionId)) throw new Error('Invalid segment identifier');
    segmentIds.add(id);
    if (!allowedStates.has(String(s.state)) || !allowedSources.has(String(s.source))) throw new Error('Unknown activity state');
    const startTs = number(s.startTs, minTs, maxTs);
    const endTs = number(s.endTs, startTs, Math.min(maxTs, startTs + 24 * 60 * 60_000));
    const session = sessionsById.get(sessionId)!;
    if (startTs < session.startTs || (session.endTs !== null && endTs > session.endTs)) throw new Error('Segment outside its session');
    if ((session.phase === 'focus') === (s.state === 'break')) throw new Error('Segment phase does not match its session');
    return { id, sessionId, startTs, endTs, state: s.state as FocusSegment['state'], source: s.source as FocusSegment['source'] };
  });
  segments.sort((a, b) => a.startTs - b.startTs);
  for (let i = 1; i < segments.length; i++) {
    if (segments[i].startTs < segments[i - 1].endTs) throw new Error('Overlapping activity intervals are not valid');
  }
  // Imported running sessions become interrupted at their final recorded interval.
  const finalInterval = new Map<string, number>();
  for (const segment of segments) finalInterval.set(segment.sessionId, Math.max(finalInterval.get(segment.sessionId) ?? 0, segment.endTs));
  for (const session of sessions) {
    if (session.endTs === null) {
      session.endTs = Math.max(session.startTs, finalInterval.get(session.id) ?? session.startTs);
      session.interrupted = true;
      session.completed = false;
    }
  }
  return {
    app: 'FocusLens', version: 1, exportedAt: new Date().toISOString(),
    settings: validateSettings(data.settings), sessions, segments,
    achievements: evaluateAchievements(segments, sessions),
  };
}

export function freshSettings(): Settings {
  return { ...DEFAULT_SETTINGS, pomodoro: { ...DEFAULT_SETTINGS.pomodoro }, blocklist: [...DEFAULT_SETTINGS.blocklist] };
}
