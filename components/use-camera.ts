'use client';
import { useEffect, useRef, useState } from 'react';
import { CameraController, type VisionSample } from '@/lib/camera';
import { useFocusStore } from '@/lib/store';

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null); const controller = useRef<CameraController | null>(null);
  const mounted = useRef(true);
  const [active, setActive] = useState(false); const [starting, setStarting] = useState(false); const [error, setError] = useState(''); const [sample, setSample] = useState<VisionSample | null>(null); const [calibrationProgress, setCalibrationProgress] = useState(0);
  const settings = useFocusStore(s => s.settings);
  useEffect(() => { controller.current?.setSensitivity(settings.sensitivity); controller.current?.setGraceMs(settings.graceMs); controller.current?.setCalibration(settings.calibration || null); }, [settings.sensitivity, settings.graceMs, settings.calibration]);
  const stop = () => { controller.current?.stop(); controller.current = null; setActive(false); setStarting(false); setSample(null); setCalibrationProgress(0); useFocusStore.getState().setCameraActive(false); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.stop(); controller.current = null; useFocusStore.getState().setCameraActive(false); }; }, []);
  const start = async () => {
    if (!videoRef.current || starting || active || controller.current) return;
    setStarting(true); setError('');
    const c = new CameraController(); controller.current = c;
    try {
      c.setSensitivity(settings.sensitivity); c.setGraceMs(settings.graceMs); c.setCalibration(settings.calibration || null);
      await c.start(videoRef.current, next => { if (!mounted.current || controller.current !== c) return; setSample(next); setCalibrationProgress(c.calibrationProgress); const s = useFocusStore.getState(); if (s.running) s.recordState(next.state, 'cv'); }, message => { if (!mounted.current || controller.current !== c) return; setError(message); setActive(false); setSample(null); controller.current = null; useFocusStore.getState().setCameraActive(false); });
      if (mounted.current && controller.current === c && c.isRunning) { setActive(true); useFocusStore.getState().setCameraActive(true); }
    } catch (e) { if (mounted.current && (!controller.current || controller.current === c)) { setError(e instanceof Error ? e.message : 'Kamerani ishga tushirib bo‘lmadi.'); stop(); } }
    finally { if (mounted.current && (!controller.current || controller.current === c)) setStarting(false); }
  };
  const calibrate = async () => { if (!controller.current) throw new Error('Avval kamerani yoqing.'); return controller.current.calibrate(); };
  return { videoRef, active, starting, error, sample, calibrationProgress, start, stop, calibrate };
}
