import { addDays, dateKey, parseDate } from './analytics';
import type { Achievement, FocusSegment, FocusSession } from './types';

type Definition = Omit<Achievement, 'unlocked' | 'unlockedAt'>;

export const ACHIEVEMENT_DEFINITIONS: Definition[] = [
  { key: '60m_Continuous', titleUz: '60 daqiqa diqqat', titleEn: '60m Continuous Focus', descriptionUz: 'Bir sessiyada 60 daqiqa diqqat; uzilishlar 1 daqiqadan oshmasin.', descriptionEn: '60 focused minutes in one session, with no interruption over a minute.', icon: 'target', xp: 150 },
  { key: '120m_Total_Day', titleUz: '2 soat chuqur ish', titleEn: '2H Deep Work', descriptionUz: 'Bir kunda jami 120 daqiqa diqqatni jamlang.', descriptionEn: 'Reach 120 focused minutes in a single day.', icon: 'clock', xp: 150 },
  { key: 'Weekly_Record', titleUz: 'Haftalik yangi rekord', titleEn: 'New Weekly Record', descriptionUz: 'Avvalgi faol haftangiz natijasini yangilang.', descriptionEn: 'Beat the previous calendar week after establishing a baseline.', icon: 'trophy', xp: 150 },
  { key: 'Streak_7', titleUz: '7 kunlik davomiylik', titleEn: '7-Day Streak', descriptionUz: 'Ketma-ket 7 kun, har kuni kamida 30 daqiqa.', descriptionEn: 'Focus at least 30 minutes a day for seven consecutive days.', icon: 'flame', xp: 200 },
  { key: 'Early_Bird', titleUz: 'Erta qush', titleEn: 'Early Bird', descriptionUz: 'Ertalabki sessiyani soat 08:00 gacha yakunlang.', descriptionEn: 'Finish a morning focus session before 8am.', icon: 'sun', xp: 100 },
  { key: 'Distraction_Free', titleUz: "Chalg'imasdan", titleEn: 'Distraction Free', descriptionUz: "Chalg'ishsiz 5 ta sessiyani yakunlang.", descriptionEn: 'Complete five sessions without a distraction or absence.', icon: 'shield', xp: 200 },
  { key: '100_Hours', titleUz: '100 soat klubi', titleEn: '100 Hour Club', descriptionUz: 'Jami 100 soat diqqatni jamlang.', descriptionEn: 'Reach 100 total focused hours.', icon: 'clock', xp: 500 },
];

export function focusByDay(segments: FocusSegment[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const segment of segments) {
    if (segment.state !== 'focus') continue;
    let cursor = segment.startTs;
    while (cursor < segment.endTs) {
      const key = dateKey(cursor);
      const end = Math.min(segment.endTs, addDays(parseDate(key), 1).getTime());
      totals.set(key, (totals.get(key) ?? 0) + (end - cursor) / 60_000);
      cursor = end;
    }
  }
  return totals;
}

export function longestFocusRun(segments: FocusSegment[]): number {
  const ordered = [...segments].sort((a, b) => a.startTs - b.startTs);
  let focusedMs = 0;
  let interruptionMs = 0;
  let best = 0;
  let previous: FocusSegment | undefined;
  for (const segment of ordered) {
    if (!previous || previous.sessionId !== segment.sessionId || segment.startTs < previous.endTs) {
      focusedMs = 0;
      interruptionMs = 0;
    } else {
      interruptionMs += Math.max(0, segment.startTs - previous.endTs);
    }
    if (interruptionMs > 60_000 || segment.state === 'break') focusedMs = 0;
    if (segment.state === 'focus') {
      focusedMs += segment.endTs - segment.startTs;
      interruptionMs = 0;
      best = Math.max(best, focusedMs);
    } else {
      interruptionMs += segment.endTs - segment.startTs;
      if (interruptionMs > 60_000) focusedMs = 0;
    }
    previous = segment;
  }
  return best / 60_000;
}

function monday(date: string): string {
  const d = parseDate(date);
  return dateKey(addDays(d, -((d.getDay() + 6) % 7)));
}

export function evaluateAchievements(
  segments: FocusSegment[], sessions: FocusSession[], previous: Achievement[] = [], now = Date.now(),
): Achievement[] {
  const daily = focusByDay(segments);
  const weekly = new Map<string, number>();
  for (const [date, minutes] of daily) weekly.set(monday(date), (weekly.get(monday(date)) ?? 0) + minutes);
  let weeklyRecord = false;
  for (const [week, minutes] of weekly) {
    const previousWeek = weekly.get(dateKey(addDays(parseDate(week), -7))) ?? 0;
    if (previousWeek > 0 && minutes > previousWeek) weeklyRecord = true;
  }
  let streak = 0;
  let longestStreak = 0;
  let previousDate: string | null = null;
  for (const [date, minutes] of [...daily].sort(([a], [b]) => a.localeCompare(b))) {
    if (minutes < 30) { streak = 0; previousDate = date; continue; }
    streak = previousDate && dateKey(addDays(parseDate(previousDate), 1)) === date ? streak + 1 : 1;
    longestStreak = Math.max(longestStreak, streak);
    previousDate = date;
  }
  const completed = sessions.filter(session => session.phase === 'focus' && session.completed && session.endTs !== null);
  const sessionStates = new Map<string, { focus: boolean; interrupted: boolean }>();
  for (const segment of segments) {
    const state = sessionStates.get(segment.sessionId) ?? { focus: false, interrupted: false };
    state.focus ||= segment.state === 'focus';
    state.interrupted ||= ['away', 'distract', 'micro'].includes(segment.state);
    sessionStates.set(segment.sessionId, state);
  }
  const achieved: Record<string, boolean> = {
    '60m_Continuous': longestFocusRun(segments) >= 60,
    '120m_Total_Day': [...daily.values()].some(minutes => minutes >= 120),
    'Weekly_Record': weeklyRecord,
    'Streak_7': longestStreak >= 7,
    'Early_Bird': completed.some(s => dateKey(s.startTs) === dateKey(s.endTs!) && new Date(s.endTs!).getHours() < 8),
    'Distraction_Free': completed.filter(s => sessionStates.get(s.id)?.focus && !sessionStates.get(s.id)?.interrupted).length >= 5,
    '100_Hours': [...daily.values()].reduce((sum, minutes) => sum + minutes, 0) >= 6000,
  };
  return ACHIEVEMENT_DEFINITIONS.map(definition => {
    const old = previous.find(a => a.key === definition.key);
    const unlocked = Boolean(old?.unlocked || achieved[definition.key]);
    return { ...definition, unlocked, ...(unlocked ? { unlockedAt: old?.unlockedAt ?? now } : {}) };
  });
}

export function getAchievementProgress(segments: FocusSegment[], achievements: Achievement[]) {
  const focusMinutes = segments.filter(s => s.state === 'focus').reduce((sum, s) => sum + (s.endTs - s.startTs) / 60_000, 0);
  const xp = Math.floor(focusMinutes) + achievements.filter(a => a.unlocked).reduce((sum, a) => sum + a.xp, 0);
  return { xp, level: Math.floor(xp / 500) + 1, levelXp: xp % 500, nextLevelXp: 500, progress: (xp % 500) / 500 };
}
