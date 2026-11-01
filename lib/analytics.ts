import type { DailyStats, FocusSegment, FocusSession, RangeStats } from './types';

const MINUTE = 60_000;

export function dateKey(date: Date | number = new Date()): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
}

export function getDailyStats(
  segments: FocusSegment[],
  sessions: FocusSession[] = [],
  date = dateKey(),
): DailyStats {
  const start = parseDate(date).getTime();
  const end = addDays(new Date(start), 1).getTime();
  const result: DailyStats = {
    date, focusMin: 0, microMin: 0, distractMin: 0, awayMin: 0,
    trackedMin: 0, distractCount: 0, score: 0, sessions: 0,
    activityMin: 0, cameraMin: 0, hourly: Array<number>(24).fill(0),
  };
  const ordered = segments.filter(s => s.state !== 'break').sort((a, b) => a.startTs - b.startTs);
  const previousBySession = new Map<string, FocusSegment>();
  for (const segment of ordered) {
    const previous = previousBySession.get(segment.sessionId);
    previousBySession.set(segment.sessionId, segment);
    const left = Math.max(start, segment.startTs);
    const right = Math.min(end, segment.endTs);
    if (right <= left) continue;
    const minutes = (right - left) / MINUTE;
    result.trackedMin += minutes;
    if (segment.source === 'cv') result.cameraMin += minutes;
    else result.activityMin += minutes;
    if (segment.state === 'focus') result.focusMin += minutes;
    if (segment.state === 'micro') result.microMin += minutes;
    if (segment.state === 'distract') result.distractMin += minutes;
    if (segment.state === 'away') result.awayMin += minutes;
    // Persisted chunks and midnight crossings do not create extra distractions.
    if (segment.state === 'distract' && segment.startTs >= start &&
        (!previous || previous.state !== 'distract' || previous.endTs !== segment.startTs)) {
      result.distractCount++;
    }
    if (segment.state === 'focus') {
      let cursor = left;
      while (cursor < right) {
        const d = new Date(cursor);
        const next = new Date(d);
        next.setMinutes(60, 0, 0);
        const boundary = Math.min(right, Math.max(cursor + 1, next.getTime()));
        result.hourly[d.getHours()] += (boundary - cursor) / MINUTE;
        cursor = boundary;
      }
    }
  }
  result.score = result.trackedMin > 0
    ? Math.round(100 * (result.focusMin + result.microMin * 0.5) / result.trackedMin)
    : 0;
  result.sessions = sessions.filter(s => s.phase === 'focus' && s.completed && s.endTs !== null && s.endTs >= start && s.endTs < end).length;
  return result;
}

export function getRangeStats(
  segments: FocusSegment[], sessions: FocusSession[] = [], count: number = 7, anchor = new Date(),
): RangeStats {
  const end = parseDate(dateKey(anchor));
  const start = addDays(end, 1 - count);
  const days = Array.from({ length: count }, (_, i) => getDailyStats(segments, sessions, dateKey(addDays(start, i))));
  const previousFocusMin = Array.from({ length: count }, (_, i) => getDailyStats(segments, sessions, dateKey(addDays(start, i - count))))
    .reduce((sum, day) => sum + day.focusMin, 0);
  const focusMin = days.reduce((sum, day) => sum + day.focusMin, 0);
  const tracked = days.reduce((sum, day) => sum + day.trackedMin, 0);
  const micro = days.reduce((sum, day) => sum + day.microMin, 0);
  const hourly = Array.from({ length: 24 }, (_, hour) => days.reduce((sum, day) => sum + day.hourly[hour], 0));
  let peakHour: number | null = null;
  let peakValue = 0;
  for (let hour = 0; hour < 23; hour++) {
    const value = hourly[hour] + hourly[hour + 1];
    if (value > peakValue) { peakValue = value; peakHour = hour; }
  }
  return {
    days, focusMin, previousFocusMin,
    awayMin: days.reduce((sum, day) => sum + day.awayMin, 0),
    distractCount: days.reduce((sum, day) => sum + day.distractCount, 0),
    score: tracked ? Math.round(100 * (focusMin + micro * 0.5) / tracked) : 0,
    changePercent: previousFocusMin > 0 ? Math.round(100 * (focusMin - previousFocusMin) / previousFocusMin) : null,
    hourly, heatmap: days.map(day => day.hourly), peakHour,
    startDate: dateKey(start), endDate: dateKey(end),
  };
}

/** An unfinished today does not erase a streak already earned through yesterday. */
export function getStreak(segments: FocusSegment[], now = new Date()): number {
  let day = parseDate(dateKey(now));
  if (getDailyStats(segments, [], dateKey(day)).focusMin < 30) day = addDays(day, -1);
  let streak = 0;
  for (let i = 0; i < 36600; i++) {
    if (getDailyStats(segments, [], dateKey(day)).focusMin < 30) break;
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

export function formatMinutes(minutes: number, locale: 'en' | 'uz' = 'uz'): string {
  const rounded = Math.max(0, Math.floor(minutes));
  if (rounded < 60) return `${rounded} ${locale === 'uz' ? 'daq' : 'min'}`;
  return `${Math.floor(rounded / 60)}${locale === 'uz' ? 's' : 'h'} ${rounded % 60}${locale === 'uz' ? 'd' : 'm'}`;
}

export function formatTimer(seconds: number): string {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}
