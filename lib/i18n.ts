import type { Locale } from './types';

export const messages = {
  uz: {
    focus: 'Diqqat', dashboard: 'Bosh sahifa', stats: 'Statistika', achievements: 'Yutuqlar', settings: 'Sozlamalar',
    start: 'Boshlash', pause: 'Pauza', reset: 'Qayta boshlash', save: 'Saqlash',
    focusing: 'DIQQAT JAMLANGAN', distracted: "CHALG'ISH", away: 'JOYIDA EMAS', break: 'TANAFFUS',
    activityOnly: 'Faollik asosida taxmin', cameraLocal: 'Kamera tahlili qurilmangizda', privacy: 'Video saqlanmaydi va yuborilmaydi.',
    breakStarted: 'Tanaffus vaqti', breakBody: "Bir oz dam oling. Ko'zlaringizni ekrandan uzoqlashtiring.",
    breakEnded: 'Tanaffus tugadi', focusBody: 'Keyingi diqqat sessiyasiga tayyormisiz?', unlocked: 'Yangi yutuq!',
    empty: "Hali ma'lumot yo'q. Birinchi sessiyani boshlang.",
  },
  en: {
    focus: 'Focus', dashboard: 'Dashboard', stats: 'Statistics', achievements: 'Achievements', settings: 'Settings',
    start: 'Start', pause: 'Pause', reset: 'Reset', save: 'Save changes',
    focusing: 'FOCUSING', distracted: 'DISTRACTED', away: 'AWAY', break: 'BREAK',
    activityOnly: 'Activity-based estimate', cameraLocal: 'Camera analysis on your device', privacy: 'Video is never saved or uploaded.',
    breakStarted: 'Time for a break', breakBody: 'Rest a little and look away from your screen.',
    breakEnded: 'Break finished', focusBody: 'Ready for your next focus session?', unlocked: 'Achievement unlocked!',
    empty: 'No data yet. Start your first session.',
  },
} as const;

export type MessageKey = keyof typeof messages.en;
export function translate(locale: Locale, key: MessageKey): string { return messages[locale][key]; }
export const t = translate;
