'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Camera, CameraOff, Play, Pause, RotateCcw, ArrowRight, ShieldCheck, Sparkles, Crosshair, Coffee, Monitor } from 'lucide-react';
import { useFocusStore } from '@/lib/store';
import { formatTimer, getDailyStats } from '@/lib/analytics';
import { Card, Eyebrow, Notice, PageTitle, useT } from './ui';
import { useCamera } from './use-camera';

export function FocusPage() {
  const t = useT(); const s = useFocusStore(); const cam = useCamera(); const [custom, setCustom] = useState(s.customMin || 45);
  const today = getDailyStats(s.segments, s.sessions); const progress = s.totalSec ? 1 - s.remainingSec / s.totalSec : 0;
  const nextFocusMin = s.mode === 'deep' ? 60 : s.mode === 'custom' ? s.customMin : s.settings.pomodoro.focus;
  const nextBreakMin = (s.completedCycles + 1) % s.settings.pomodoro.cycles === 0 ? s.settings.pomodoro.longBreak : s.settings.pomodoro.shortBreak;
  const isBreak = s.phase !== 'focus'; const label = !cam.active ? t('KAMERA O‘CHIQ', 'CAMERA OFF') : !cam.sample ? t('TAHLIL QILINMOQDA', 'ANALYZING') : ({ focus: t('DIQQAT MARKAZDA', 'FOCUSING'), micro: t('QISQA CHALG‘ISH', 'BRIEF DISTRACTION'), distract: t('CHALG‘ISH', 'DISTRACTED'), away: t('JOYLASHUV ANIQLANMADI', 'AWAY') })[cam.sample.state];
  return <>
    <PageTitle title={t('Chuqur ishlash uchun vaqt.', 'Make room for deep work.')} subtitle={t('Bitta sessiya. Bitta vazifa. Diqqatingiz himoyada.', 'One session. One thing. Your attention, protected.')}/>
    {!s.settings.onboarded && <Link className="setup-banner" href="/onboarding"><span className="setup-icon"><ScanIcon/></span><span><strong>{t('FocusLens’ga xush kelibsiz', 'Welcome to FocusLens')}</strong><small>{t('Ish maydoningiz va kamerani bir daqiqada tayyorlang.', 'Set up your workspace and camera in a minute.')}</small></span><span className="setup-action">{t('Boshlash', 'Get started')}<ArrowRight size={16}/></span></Link>}
    <div className="focus-layout"><section className="timer-workspace">
      <div className="segmented mode-tabs" aria-label={t('Sessiya turi', 'Session mode')}>
        {(['pomodoro', 'deep', 'custom'] as const).map(mode => <button key={mode} disabled={s.running} className={s.mode === mode ? 'selected' : ''} onClick={() => s.setMode(mode, custom)}>{mode === 'pomodoro' ? 'Pomodoro' : mode === 'deep' ? t('Chuqur ish', 'Deep Work') : t('Maxsus', 'Custom')}</button>)}
      </div>
      {s.mode === 'custom' && <label className="custom-duration">{t('Davomiylik', 'Duration')}<input type="number" min="1" max="180" value={custom} disabled={s.running} onChange={e => { const val = Math.max(1, Math.min(180, Number(e.target.value) || 1)); setCustom(val); s.setMode('custom', val); }}/><span>{t('daqiqa', 'minutes')}</span></label>}
      <div className={`timer-circle ${s.running ? 'is-running' : ''}`}>
        <svg viewBox="0 0 360 360" aria-hidden="true"><circle className="timer-track" cx="180" cy="180" r="171"/><circle className="timer-progress" cx="180" cy="180" r="171" strokeDasharray="1074.42" strokeDashoffset={1074.42 * (1 - Math.max(progress, 0.015))}/></svg>
        <div className="timer-content"><Eyebrow>{isBreak ? t('DAM OLISH VAQTI', 'TIME FOR A BREAK') : t('FOKUS SESSIYASI', 'FOCUS SESSION')}</Eyebrow><div className="timer-digits" aria-live="off" role="timer" aria-label={t('Qolgan vaqt', 'Time remaining')}>{formatTimer(s.remainingSec)}</div><p>{s.running ? t('Har bir daqiqa muhim.', 'Every minute counts.') : s.remainingSec < s.totalSec ? t('Pauzada. Tayyor bo‘lsangiz davom eting.', 'Paused. Continue when you’re ready.') : t('Tayyor bo‘lsangiz, boshlaymiz.', 'Ready when you are.')}</p></div>
      </div>
      <div className="timer-controls"><button className="button primary timer-primary" onClick={() => s.running ? s.pause() : s.start()}>{s.running ? <Pause size={16}/> : <Play size={16}/>} {s.running ? t('Pauza', 'Pause') : s.remainingSec < s.totalSec ? t('Davom etish', 'Continue') : isBreak ? t('Tanaffusni boshlash', 'Start break') : t('Boshlash', 'Start focus')}</button><button className="button ghost" onClick={() => s.reset()} aria-label={t('Taymerni qayta boshlash', 'Reset timer')}><RotateCcw size={15}/>{t('Qayta', 'Reset')}</button></div>
      <p className="timer-encouragement">{isBreak ? t('Bir oz dam. Keyin yangicha kuch.', 'A little rest goes a long way.') : t('Shu lahzada bo‘ling. Siz uddalaysiz.', 'Stay present. You’re doing great.')}</p>
      <div className="focus-method"><span className="tiny-dot"/>{cam.active ? t('Kamera bilan kuzatuv', 'Camera-assisted tracking') : t('Qo‘lda rejim · taymer va ilova faolligi', 'Manual mode · timer & app activity')}</div>
    </section>
    <aside className="focus-side"><Card className="live-card"><Eyebrow>{t('JONLI HOLAT', 'LIVE STATUS')}</Eyebrow><div className={`camera-state state-${cam.sample?.state || 'off'}`}><span/>{label}</div>
      <div className={`camera-preview ${cam.active && s.settings.showPreview ? 'show-video' : ''}`}><video ref={cam.videoRef} muted playsInline autoPlay className="camera-video"/>{(!cam.active || !s.settings.showPreview) && <div className="preview-placeholder">{cam.active ? <ShieldCheck size={27}/> : <Camera size={27}/>}<span>{cam.active ? t('Tasvir yashirilgan', 'Preview hidden') : t('Lokal kamera ko‘rinishi', 'Local camera preview')}</span></div>}{cam.starting && <div className="camera-loading"><span className="spinner"/>{t('Kamera tayyorlanmoqda…', 'Preparing camera…')}</div>}{cam.active && <div className="preview-corner">LOCAL</div>}</div>
      <button className={`button ${cam.active ? 'subtle' : 'outline'} full-width`} disabled={cam.starting} onClick={() => cam.active ? cam.stop() : void cam.start()}>{cam.active ? <CameraOff size={15}/> : <Camera size={15}/>} {cam.starting ? t('Yuklanmoqda…', 'Loading…') : cam.active ? t('Kamerani o‘chirish', 'Turn camera off') : t('Kamerani yoqish', 'Enable camera')}</button>
      {cam.error && <Notice kind="error">{cam.error}</Notice>}
      <div className="live-metrics"><p>{t('Bugungi chalg‘ishlar', 'Today’s distractions')}<strong>{today.distractCount}</strong></p><p>{t('Tanaffusdagi vaqt', 'Away time')}<strong>{Math.round(today.awayMin)}m</strong></p></div>
      {cam.sample && <div className="signal-row"><span>{t('Yuz', 'Face')}: {cam.sample.facePresent ? t('aniqlandi', 'detected') : '—'}</span><span>{Math.round(cam.sample.confidence * 100)}%</span></div>}
      <small className="privacy-caption">{t('Video saqlanmaydi va yuborilmaydi.', 'Video is never saved or uploaded.')}</small>
    </Card><Card className="up-next"><Eyebrow>{t('KEYINGISI', 'UP NEXT')}</Eyebrow><div className="next-title"><h2>{isBreak ? `${nextFocusMin} ${t('daq. fokus', 'min Focus')}` : `${nextBreakMin} ${t('daq. dam', 'min Break')}`}</h2><Coffee size={22}/></div><p>{t('Kichik tanaffus katta farq qiladi.', 'A little rest goes a long way.')}</p></Card>
    <Link href="/stats" className="subtle-link"><Sparkles size={16}/>{t('AI bilan kuningizni tahlil qiling', 'Reflect on your day with AI')}<ArrowRight size={14}/></Link></aside></div>
    <div className="detection-note"><Monitor size={15}/><span>{t('Kamera yuz va bosh yo‘nalishi bo‘yicha taxminiy holatni aniqlaydi. Bu diqqat yoki sog‘liqning tibbiy o‘lchovi emas.', 'Camera estimates presence and head direction. It is not a medical or precise attention measurement.')}</span></div>
  </>;
}
function ScanIcon() { return <Crosshair size={21}/>; }
