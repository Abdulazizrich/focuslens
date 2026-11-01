import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateKey, getDailyStats, getRangeStats, getStreak } from '../lib/analytics';
import { evaluateAchievements, longestFocusRun } from '../lib/achievements';
import { db, freshSettings, parseBackup, validateSettings } from '../lib/db';
import { nextPhase, phaseDuration, remainingAt, useFocusStore } from '../lib/store';
import type { FocusSegment, FocusSession, FocusState } from '../lib/types';

const base = new Date(2025, 4, 19, 10, 0, 0).getTime(); // Monday, local time.
function segment(start: number, minutes: number, state: FocusState = 'focus', sessionId = 's1'): FocusSegment {
  return { id: `${start}-${state}`, sessionId, startTs: start, endTs: start + minutes * 60_000, state, source: 'cv' };
}
function session(id = 's1', startTs = base, endTs: number | null = base + 60 * 60_000): FocusSession {
  return { id, startTs, endTs, goalMin: 60, type: 'deep', phase: 'focus', completed: endTs !== null, interrupted: false };
}
function backup(sessions: FocusSession[], segments: FocusSegment[], settings = freshSettings()) {
  return JSON.stringify({ app: 'FocusLens', version: 1, settings, sessions, segments, achievements: [] });
}

test('wall-clock countdown catches up after missed ticks and never becomes negative', () => {
  const deadline = base + 25 * 60_000;
  assert.equal(remainingAt(deadline, base + 137_500, 1500), 1362.5);
  assert.equal(remainingAt(deadline, deadline + 900_000, 1500), 0);
  assert.equal(remainingAt(deadline, base - 10_000, 1500), 1500);
});

test('Pomodoro selects long breaks on the configured cycle, with mode-specific duration', () => {
  assert.deepEqual(nextPhase('focus', 2, 4), { phase: 'shortBreak', completedCycles: 3 });
  assert.deepEqual(nextPhase('focus', 3, 4), { phase: 'longBreak', completedCycles: 4 });
  assert.deepEqual(nextPhase('longBreak', 4, 4), { phase: 'focus', completedCycles: 4 });
  assert.equal(phaseDuration('deep', 'focus', freshSettings(), 45), 3600);
  assert.equal(phaseDuration('custom', 'focus', freshSettings(), 73), 4380);
  assert.equal(phaseDuration('pomodoro', 'longBreak', freshSettings(), 45), 900);
});

test('score is weighted by elapsed duration, micro-focus gets half credit, breaks are excluded', () => {
  const items = [segment(base, 30), segment(base + 30 * 60_000, 10, 'micro'), segment(base + 40 * 60_000, 10, 'distract'), segment(base + 50 * 60_000, 10, 'away'), segment(base + 60 * 60_000, 5, 'break')];
  const stats = getDailyStats(items, [], dateKey(base));
  assert.equal(stats.focusMin, 30);
  assert.equal(stats.trackedMin, 60);
  assert.equal(stats.score, 58);
  assert.equal(stats.distractCount, 1);
  assert.equal(stats.awayMin, 10);
});

test('midnight clips duration into both days, without counting a distraction twice', () => {
  const start = new Date(2025, 4, 19, 23, 55).getTime();
  const items = [segment(start, 10, 'distract')];
  assert.equal(getDailyStats(items, [], '2025-05-19').distractMin, 5);
  assert.equal(getDailyStats(items, [], '2025-05-19').distractCount, 1);
  assert.equal(getDailyStats(items, [], '2025-05-20').distractMin, 5);
  assert.equal(getDailyStats(items, [], '2025-05-20').distractCount, 0);
});

test('contiguous persisted chunks count one distraction and retain source attribution', () => {
  const items = [segment(base, 2, 'distract'), { ...segment(base + 2 * 60_000, 3, 'distract'), source: 'activity' as const }];
  const stats = getDailyStats(items, [], dateKey(base));
  assert.equal(stats.distractCount, 1);
  assert.equal(stats.activityMin, 3);
  assert.equal(stats.cameraMin, 2);
});

test('hour buckets split intervals; range score is weighted, not average daily percentages', () => {
  const day2 = addDays(new Date(base), 1).getTime();
  const items = [segment(base + 45 * 60_000, 30), segment(day2, 90, 'away')];
  const stats = getDailyStats(items, [], dateKey(base));
  assert.equal(stats.hourly[10], 15);
  assert.equal(stats.hourly[11], 15);
  const range = getRangeStats(items, [], 7, new Date(day2));
  assert.equal(range.score, 25);
  assert.equal(range.peakHour, 10);
  assert.equal(range.changePercent, null);
  assert.equal(range.days.length, 7);
});

test('continuous focus permits short interruptions, but rejects long or cross-session runs', () => {
  const short = [segment(base, 30), segment(base + 30 * 60_000, 0.5, 'away'), segment(base + 30.5 * 60_000, 30)];
  assert.equal(longestFocusRun(short), 60);
  assert.ok(evaluateAchievements(short, []).find(a => a.key === '60m_Continuous')?.unlocked);
  const long = [segment(base, 30), segment(base + 30 * 60_000, 0.6, 'away'), segment(base + 30.6 * 60_000, 0.6, 'away'), segment(base + 31.2 * 60_000, 30)];
  assert.equal(longestFocusRun(long), 30);
  assert.equal(longestFocusRun([segment(base, 30), segment(base + 30 * 60_000, 30, 'focus', 's2')]), 30);
  assert.equal(longestFocusRun([segment(base, 30), segment(base + 32 * 60_000, 30)]), 30);
});

test('weekly record requires a real previous calendar week, not an empty first baseline', () => {
  const first = [segment(base, 90)];
  assert.equal(evaluateAchievements(first, []).find(a => a.key === 'Weekly_Record')?.unlocked, false);
  const items = [...first, segment(addDays(new Date(base), 7).getTime(), 91, 'focus', 's2')];
  assert.equal(evaluateAchievements(items, []).find(a => a.key === 'Weekly_Record')?.unlocked, true);
});

test('seven-day streak needs at least thirty minutes every day and survives unfinished today', () => {
  const items = Array.from({ length: 7 }, (_, i) => segment(addDays(new Date(base), i).getTime(), 30, 'focus', `s${i}`));
  assert.equal(getStreak(items, addDays(new Date(base), 7)), 7);
  assert.equal(evaluateAchievements(items, []).find(a => a.key === 'Streak_7')?.unlocked, true);
  items[3].endTs -= 60_000;
  assert.equal(getStreak(items, addDays(new Date(base), 7)), 3);
  assert.equal(evaluateAchievements(items, []).find(a => a.key === 'Streak_7')?.unlocked, false);
});

test('import strips unknown settings fields, rejects overlap and broken references', () => {
  const settingsWithSecret = { ...freshSettings(), apiKey: 'must-never-be-exported' };
  assert.equal('apiKey' in validateSettings(settingsWithSecret), false);
  const parsed = parseBackup(backup([session()], [segment(base, 60)], settingsWithSecret));
  assert.equal(JSON.stringify(parsed).includes('must-never-be-exported'), false);
  assert.throws(() => parseBackup(backup([session()], [segment(base, 30), segment(base + 15 * 60_000, 30)])), /Overlapping/);
  assert.throws(() => parseBackup(backup([session()], [segment(base, 10, 'focus', 'missing')])), /identifier/);
  assert.throws(() => parseBackup('{"app":"FocusLens","version":99}'), /Unsupported/);
});

test('import safely ends a running session at last saved data, never at import time', () => {
  const result = parseBackup(backup([session('s1', base, null)], [segment(base, 12)]));
  assert.equal(result.sessions[0].endTs, base + 12 * 60_000);
  assert.equal(result.sessions[0].interrupted, true);
  assert.equal(result.sessions[0].completed, false);
});

test('invalid settings cannot silently create zero-length timers or external URLs', () => {
  assert.throws(() => validateSettings({ ...freshSettings(), pomodoro: { ...freshSettings().pomodoro, focus: 0 } }));
  assert.throws(() => validateSettings({ ...freshSettings(), blocklist: ['javascript:alert(1)'] }));
  assert.throws(() => validateSettings({ ...freshSettings(), calibration: { yaw: 0, pitch: 0, eyeOpen: Infinity, calibratedAt: base } }));
});

test('store excludes paused time, completes each phase once, and honors explicit stop actions at a boundary', async t => {
  let clock = base;
  t.mock.method(Date, 'now', () => clock);
  // Only persistence is replaced; exercise the production store and its clock accounting.
  t.mock.method(db, 'transaction', async () => undefined);
  const initial = useFocusStore.getState();
  const settings = freshSettings();
  settings.pomodoro = { focus: 1, shortBreak: 1, longBreak: 2, cycles: 2, autoContinue: true };
  useFocusStore.setState({ hydrated: true, settings });
  const store = () => useFocusStore.getState();
  const trackedMs = () => store().segments.reduce((sum, item) => sum + item.endTs - item.startTs, 0);
  try {
    store().reset();
    store().start();
    await assert.rejects(store().importData('{"app":"FocusLens","version":99}'), /Unsupported/);
    assert.equal(store().running, true);
    const sessionId = store().activeSessionId;
    clock += 20_000;
    store().pause();
    assert.equal(store().remainingSec, 40);
    assert.equal(trackedMs(), 20_000);
    clock += 120_000;
    store().tick();
    assert.equal(store().remainingSec, 40);
    assert.equal(trackedMs(), 20_000);
    store().start();
    assert.equal(store().activeSessionId, sessionId);
    clock += 40_000;
    store().tick();
    assert.equal(trackedMs(), 60_000);
    assert.equal(store().sessions.length, 2);
    assert.equal(store().sessions[0].completed, true);
    assert.equal(store().phase, 'shortBreak');
    assert.equal(store().running, true);
    // An explicit pause at the next boundary must not auto-start a focus session.
    clock += 60_000;
    store().pause();
    assert.equal(store().phase, 'focus');
    assert.equal(store().running, false);
    assert.equal(store().activeSessionId, null);
    assert.equal(store().sessions.length, 2);
    assert.equal(store().completedCycles, 1);
    store().start();
    clock += 60_000;
    store().reset();
    assert.equal(store().sessions.length, 3);
    assert.equal(store().activeSessionId, null);
    assert.equal(store().running, false);
    store().start();
    clock += 60_000;
    store().setMode('custom', 10);
    assert.equal(store().sessions.length, 4);
    assert.equal(store().activeSessionId, null);
    assert.equal(store().totalSec, 600);
    store().setMode('custom', Number.NaN);
    assert.equal(store().totalSec, 600);
    const exported = await store().exportData();
    const restored = parseBackup(exported);
    assert.equal(restored.sessions.length, 4);
    assert.equal(restored.segments.reduce((sum, item) => sum + item.endTs - item.startTs, 0), 240_000);
    assert.equal(restored.achievements.every(a => !a.unlocked), true);
  } finally {
    await store().exportData();
    useFocusStore.setState(initial, true);
  }
});

test('restart recovers only saved intervals and requires a new start without counting offline time', async t => {
  let clock = base + 10 * 24 * 60 * 60_000;
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(db, 'transaction', async () => undefined);
  t.mock.method(db.settings, 'get', async () => ({ id: 'default', value: freshSettings() }));
  t.mock.method(db.sessions, 'orderBy', () => ({ toArray: async () => [session('recovered', base, null)] }));
  t.mock.method(db.segments, 'orderBy', () => ({ toArray: async () => [segment(base, 12, 'focus', 'recovered')] }));
  t.mock.method(db.achievements, 'toArray', async () => []);
  t.mock.method(db.runtime, 'get', async () => ({ id: 'timer', mode: 'pomodoro', customMin: 45, phase: 'focus', totalSec: 1500, remainingSec: 780, completedCycles: 0, activeSessionId: 'recovered', running: true, savedAt: base + 12 * 60_000 }));
  const initial = useFocusStore.getState();
  const store = () => useFocusStore.getState();
  try {
    await store().hydrate();
    assert.equal(store().running, false);
    assert.equal(store().activeSessionId, null);
    assert.equal(store().remainingSec, 780);
    assert.equal(store().sessions[0].endTs, base + 12 * 60_000);
    assert.equal(store().sessions[0].interrupted, true);
    assert.equal(store().sessions[0].completed, false);
    assert.equal(store().segments.length, 1);
    store().start();
    assert.notEqual(store().activeSessionId, 'recovered');
    clock += 30_000;
    store().pause();
    const exported = parseBackup(await store().exportData());
    assert.equal(exported.segments.reduce((sum, item) => sum + item.endTs - item.startTs, 0), 12.5 * 60_000);
    assert.equal(store().remainingSec, 750);
  } finally {
    await store().exportData();
    useFocusStore.setState(initial, true);
  }
});
