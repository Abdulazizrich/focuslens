'use client';

import { useFocusStore } from '@/lib/store';
import type { ReactNode } from 'react';
import { ArrowRight, Info, X } from 'lucide-react';

export function useT() { const locale = useFocusStore(s => s.settings.locale); return (uz: string, en: string) => locale === 'en' ? en : uz; }
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <section className={`card ${className}`}>{children}</section>; }
export function Eyebrow({ children }: { children: ReactNode }) { return <div className="eyebrow">{children}</div>; }
export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) { return <div className="page-heading"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) { return <div className="empty-state"><div className="empty-orbit"><span/><span/><span/></div><strong>{title}</strong>{description && <p>{description}</p>}{children}</div>; }
export function Notice({ children, kind = 'info', onClose }: { children: ReactNode; kind?: 'info'|'error'|'success'; onClose?: () => void }) { return <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}><Info size={16}/><span>{children}</span>{onClose && <button className="icon-button" onClick={onClose} aria-label="Close"><X size={16}/></button>}</div>; }
export function Toggle({ checked, onChange, label, description, disabled = false }: { checked: boolean; onChange?: (checked: boolean) => void; label: string; description?: string; disabled?: boolean }) { return <label className={`toggle-row ${disabled ? 'fixed-toggle' : ''}`}><span><strong>{label}</strong>{description && <small>{description}</small>}</span><input type="checkbox" role="switch" checked={checked} onChange={e => onChange?.(e.target.checked)} disabled={disabled}/><span className="toggle-track" aria-hidden="true"/></label>; }
export function FormatDuration(seconds: number) { const mins = Math.floor(seconds / 60); const hours = Math.floor(mins / 60); return hours ? `${hours}h ${mins % 60}m` : `${mins}m`; }
export function ArrowLabel({ children }: { children: ReactNode }) { return <span className="arrow-label">{children}<ArrowRight size={15}/></span>; }
