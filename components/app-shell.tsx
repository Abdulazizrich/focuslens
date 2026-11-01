'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ScanFace, Timer, Target, Zap, Trophy, Settings, ShieldCheck, Menu, X, ChevronRight } from 'lucide-react';
import { useFocusStore } from '@/lib/store';
import { useT } from './ui';
import { AchievementCelebration } from './achievement-celebration';

const links = [
  { href: '/focus', uz: 'Fokus', en: 'Focus', icon: Timer },
  { href: '/dashboard', uz: 'Umumiy ko‘rinish', en: 'Dashboard', icon: Target },
  { href: '/stats', uz: 'Statistika', en: 'Statistics', icon: Zap },
  { href: '/achievements', uz: 'Yutuqlar', en: 'Achievements', icon: Trophy },
  { href: '/settings', uz: 'Sozlamalar', en: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname(); const t = useT(); const [menu, setMenu] = useState(false);
  const { hydrate, tick, settings, hydrated, persistenceError } = useFocusStore();
  useEffect(() => { void hydrate(); const interval = setInterval(() => tick(), 500); return () => clearInterval(interval); }, [hydrate, tick]);
  useEffect(() => { document.documentElement.lang = settings.locale; }, [settings.locale]);
  useEffect(() => {
    const update = () => { const s = useFocusStore.getState(); if (s.running && !s.cameraActive) s.recordState(document.visibilityState === 'hidden' ? 'away' : 'focus', 'activity'); };
    const suspend = () => useFocusStore.getState().pause();
    document.addEventListener('visibilitychange', update); window.addEventListener('focuslens-suspend', suspend); return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('focuslens-suspend', suspend); };
  }, []);
  useEffect(() => { setMenu(false); }, [pathname]);
  useEffect(() => {
    if ('serviceWorker' in navigator && ['http:', 'https:'].includes(location.protocol) && !window.focuslens) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  const current = links.find(l => pathname.startsWith(l.href)) || links[0];
  return <div className="app-layout">
    {menu && <button className="sidebar-scrim" aria-label={t('Menyuni yopish', 'Close menu')} onClick={() => setMenu(false)}/>}
    <aside className={`sidebar ${menu ? 'open' : ''}`}>
      <Link className="brand" href="/focus"><ScanFace size={24}/><span>FocusLens</span></Link>
      <div className="workspace-label">{t('SHAXSIY ISH MAYDONI', 'YOUR WORKSPACE')}</div>
      <nav aria-label={t('Asosiy menyu', 'Main navigation')}>{links.map(({ href, uz, en, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${current.href === href ? 'active' : ''}`} aria-current={current.href === href ? 'page' : undefined}><Icon size={18}/><span>{t(uz, en)}</span></Link>)}</nav>
      <div className="sidebar-bottom"><div className="privacy-note"><ShieldCheck size={18}/><strong>{t('Maxfiylik — asosiy tamoyil', 'Private by design')}</strong><p>{t('Kamerangiz qurilmangizda qoladi.', 'Your camera stays on your device.')}</p></div><Link href="/settings" className="profile"><div className="avatar">{(settings.name || 'A').slice(0, 1).toUpperCase()}</div><div><strong>{settings.name || t('Mening makonim', 'My workspace')}</strong><span>{t('Shaxsiy ish maydoni', 'Personal workspace')}</span></div><ChevronRight size={14}/></Link></div>
    </aside>
    <div className="app-main"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMenu(!menu)} aria-label={t('Menyuni ochish', 'Open menu')}>{menu ? <X size={20}/> : <Menu size={20}/>}</button><span>{pathname === '/onboarding' ? t('Boshlash', 'Getting started') : t(current.uz, current.en)}</span></div><div className="local-status"><span className="status-light"/>{t('Kamera tahlili lokal', 'Camera analysis stays local')}<ShieldCheck size={14}/></div></header>
      {persistenceError && <div className="storage-error" role="alert">{persistenceError}</div>}
      <main className="page-content">{hydrated ? children : <div className="loading-state"><ScanFace size={32} className="teal"/><span>{t('Ish maydoningiz tayyorlanmoqda…', 'Preparing your workspace…')}</span></div>}</main>
    </div>
    <AchievementCelebration/>
  </div>;
}
