'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Trophy, X } from 'lucide-react';
import { useFocusStore } from '@/lib/store';
import type { Achievement } from '@/lib/types';
import confetti from '@/public/lottie/confetti.json';
import { useT } from './ui';

const Lottie = dynamic(() => import('lottie-react'), { ssr: false });

export function AchievementCelebration() {
  const { achievements, hydrated } = useFocusStore();
  const t = useT();
  const seen = useRef<Set<string> | null>(null);
  const [badge, setBadge] = useState<Achievement | null>(null);
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const unlocked = achievements.filter(item => item.unlocked);
    if (seen.current) {
      const latest = unlocked.find(item => !seen.current!.has(item.key) && (item.unlockedAt ?? 0) > Date.now() - 10000);
      if (latest) setBadge(latest);
    }
    seen.current = new Set(unlocked.map(item => item.key));
  }, [achievements, hydrated]);

  useEffect(() => {
    if (!badge) return;
    const timer = setTimeout(() => setBadge(null), 6500);
    return () => clearTimeout(timer);
  }, [badge]);

  if (!badge) return null;
  return <>
    {!reduceMotion && <div className="achievement-confetti" aria-hidden="true"><Lottie key={badge.key} animationData={confetti} loop={false}/></div>}
    <div className="achievement-toast" role="status"><Trophy size={23}/><div><small>{t('YANGI YUTUQ', 'ACHIEVEMENT UNLOCKED')}</small><strong>{t(badge.titleUz, badge.titleEn)}</strong><span>+{badge.xp} XP</span></div><button className="icon-button" onClick={() => setBadge(null)} aria-label={t('Yopish', 'Dismiss')}><X size={17}/></button></div>
  </>;
}
