const path = require('node:path');

function isAppURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'focuslens:' && url.hostname === 'app' && !url.port && !url.username && !url.password;
  } catch { return false; }
}

function isAppOrigin(value) {
  if (!isAppURL(value)) return false;
  const url = new URL(value);
  return (url.pathname === '' || url.pathname === '/') && !url.search && !url.hash;
}

function resolveAsset(root, url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'focuslens:' || parsed.hostname !== 'app') throw new Error('Invalid origin');
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
  if (pathname.endsWith('/')) pathname += 'index.html';
  else if (!path.extname(pathname)) pathname += '/index.html';
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Path outside application');
  return file;
}

function validateChat(input) {
  if (!input || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 4000) throw new Error('Savol 1–4000 belgidan iborat bo‘lishi kerak.');
  const summary = {};
  // Only numerical aggregates cross the network; never frames, events, names or keys.
  for (const key of ['focusMin', 'awayMin', 'distractCount', 'score', 'sessions', 'peakHour']) {
    if (Number.isFinite(input.summary?.[key])) summary[key] = Math.max(0, Math.min(1e9, input.summary[key]));
  }
  return { message: input.message.trim(), summary, locale: input.locale === 'en' ? 'en' : 'uz' };
}

function localAdvice(summary, locale) {
  if (locale === 'en') return `Local suggestion: choose one clear task and start a 25-minute session. Take a 5-minute break afterward. ${summary.focusMin ? `You have recorded ${Math.round(summary.focusMin)} focused minutes in the selected period. ` : 'Complete your first session to build a useful picture of your habits. '}Camera signals are estimates of visible attention, not a measure of your thoughts. Add a DeepSeek API key in Settings for conversational AI.`;
  return `Mahalliy tavsiya: bitta aniq vazifani tanlang va 25 daqiqalik sessiyani boshlang. Keyin 5 daqiqa dam oling. ${summary.focusMin ? `Tanlangan davrda ${Math.round(summary.focusMin)} daqiqa diqqat qayd etilgan. ` : 'Odatlaringizni tahlil qilish uchun birinchi sessiyani yakunlang. '}Kamera faqat ko‘rinadigan belgilarni taxmin qiladi. Suhbatlashuvchi AI uchun Sozlamalarda DeepSeek API kalitini kiriting.`;
}
module.exports = { resolveAsset, validateChat, localAdvice, isAppURL, isAppOrigin };
