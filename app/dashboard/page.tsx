'use client';
import Link from 'next/link';
import { ArrowRight, Flame, Target, Trophy, Clock3 } from 'lucide-react';
import { useFocusStore } from '@/lib/store';
import { dateKey, formatMinutes, getDailyStats, getStreak } from '@/lib/analytics';
import { Card, EmptyState, Eyebrow, PageTitle, useT } from '@/components/ui';
import { HourChart } from '@/components/charts';

export default function Dashboard() {
  const t = useT(); const { settings, segments, sessions, achievements } = useFocusStore(); const today = getDailyStats(segments, sessions); const streak = getStreak(segments);
  const dayStart = new Date().setHours(0, 0, 0, 0); const dayEnd = new Date().setHours(24, 0, 0, 0);
  const dailySegments = segments.filter(s => s.endTs > dayStart && s.startTs < dayEnd && s.state !== 'break').map(s => ({ ...s, startTs: Math.max(dayStart, s.startTs), endTs: Math.min(dayEnd, s.endTs) })).sort((a,b) => a.startTs-b.startTs);
  const workdayStart = new Date().setHours(9, 0, 0, 0); const workdayEnd = new Date().setHours(18, 0, 0, 0);
  const start = Math.min(workdayStart, new Date(dailySegments[0]?.startTs ?? workdayStart).setMinutes(0, 0, 0));
  const end = Math.max(workdayEnd, dailySegments.length ? new Date(Math.max(...dailySegments.map(segment => segment.endTs)) - 1).setMinutes(60, 0, 0) : workdayEnd); const span = end - start;
  const unlocked = achievements.filter(a => a.unlocked).sort((a,b) => (b.unlockedAt || 0) - (a.unlockedAt || 0)).slice(0,3);
  const hour = new Date().getHours(); const greeting = hour < 12 ? t('Xayrli tong', 'Good morning') : hour < 18 ? t('Xayrli kun', 'Good afternoon') : t('Xayrli kech', 'Good evening');
  return <><PageTitle title={`${greeting}, ${settings.name || t('do‘stim', 'friend')}`} subtitle={new Date().toLocaleDateString(settings.locale === 'uz' ? 'uz-UZ' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} action={<div className="streak-pill">{streak} {t('kun', 'days')}<Flame size={17}/></div>}/>
    <div className="metric-grid">{[
      { title: t('FOKUS VAQTI', 'FOCUS TIME'), value: formatMinutes(today.focusMin, settings.locale), sub: `${today.sessions} ${t('tugallangan sessiya', 'completed sessions')}`, color: 'teal' },
      { title: t('CHALG‘ISHLAR', 'DISTRACTIONS'), value: today.distractCount, sub: t('Bugun qayd etilgan', 'Recorded today'), color: 'orange' },
      { title: t('JOYLASHUVDAN UZOQDA', 'AWAY TIME'), value: formatMinutes(today.awayMin, settings.locale), sub: t('Kuzatuv davomida', 'During tracked sessions'), color: '' },
      { title: t('FOKUS BAHOSI', 'FOCUS SCORE'), value: today.trackedMin > 0 ? `${today.score}%` : '—', sub: today.trackedMin > 0 ? t('Fokus vaqtining ulushi', 'Share of focused time') : t('Birinchi sessiyangizni boshlang', 'Start your first session'), color: 'purple' },
    ].map(m => <Card key={m.title} className="metric-card"><Eyebrow>{m.title}</Eyebrow><div className="metric-value">{m.value}</div><small className={m.color}>{m.sub}</small></Card>)}</div>
    <Card className="timeline-card"><Eyebrow>{t('KUNINGIZ — FOKUSDA', 'YOUR DAY IN FOCUS')}</Eyebrow>{dailySegments.length ? <><div className="timeline-times">{Array.from({ length: 10 }, (_,i) => <span key={i}>{new Date(start + span * i / 9).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>)}</div><div className="timeline-track">{dailySegments.map(s => <span key={s.id} className={`timeline-segment segment-${s.state}`} style={{ left: `${100 * (s.startTs-start)/span}%`, width: `${Math.max(.4, 100*(s.endTs-s.startTs)/span)}%` }} title={`${s.state}: ${Math.round((s.endTs-s.startTs)/1000)}s`}/>)}</div></> : <div className="timeline-empty"><div className="timeline-empty-track"/><p>{t('Birinchi sessiyangiz kun xaritasini boshlaydi.', 'Your first session starts your daily timeline.')}</p></div>}<div className="chart-legend"><span><i className="legend-focus"/>{t('Fokus', 'Focus')}</span><span><i className="legend-distract"/>{t('Chalg‘ish', 'Distracted')}</span><span><i className="legend-away"/>{t('Uzoqda', 'Away')}</span></div></Card>
    <div className="dashboard-bottom"><Card><Eyebrow>{t('ENG SAMARALI SOATLAR', 'PEAK HOURS')}</Eyebrow><p className="card-description">{today.focusMin > 0 ? t('Diqqatingizning bugungi taqsimoti.', 'How your focus is distributed today.') : t('Vaqt o‘tishi bilan o‘z ritmingizni kashf eting.', 'Discover your rhythm, one session at a time.')}</p><HourChart values={today.hourly.slice(8,17)}/></Card>
    <Card><div className="card-title-row"><Eyebrow>{t('SO‘NGGI YUTUQLAR', 'RECENT ACHIEVEMENTS')}</Eyebrow><Link href="/achievements" className="icon-button" aria-label={t('Barcha yutuqlar', 'All achievements')}><ArrowRight size={16}/></Link></div>{unlocked.length ? <div className="achievement-list">{unlocked.map((a,i) => <div key={a.key}><span className={`achievement-small-icon color-${i}`}>{i===0?<Target size={20}/>:i===1?<Trophy size={20}/>:<Flame size={20}/>}</span><strong>{t(a.titleUz,a.titleEn)}</strong><small>{a.unlockedAt ? new Date(a.unlockedAt).toLocaleDateString() : ''}</small></div>)}</div> : <div className="achievements-empty"><Target size={30}/><strong>{t('Har bir daqiqa — yangi qadam.', 'Every focused minute is a step forward.')}</strong><p>{t('Yutuqlaringiz shu yerda paydo bo‘ladi.', 'Your achievements will appear here.')}</p><Link href="/focus">{t('Birinchi sessiyani boshlash', 'Start your first session')}<ArrowRight size={14}/></Link></div>}</Card></div>
    <p className="data-source-note"><Clock3 size={13}/>{t('Faqat haqiqiy sessiyalaringiz ko‘rsatiladi. Qo‘lda va kamera kuzatuvi umumiy hisobga kiradi.', 'Only your real sessions are shown. Totals include manual and camera-assisted tracking.')}</p>
  </>;
}
