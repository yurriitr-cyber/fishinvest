import { useEffect, useRef } from 'react';

let cached: boolean | null = null;

export function isLowPower(): boolean {
  if (cached != null) return cached;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cached = true;
    return true;
  }
  if (nav.connection?.saveData) {
    cached = true;
    return true;
  }
  const slowNet = nav.connection?.effectiveType;
  if (slowNet === 'slow-2g' || slowNet === '2g') {
    cached = true;
    return true;
  }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) {
    cached = true;
    return true;
  }
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4) {
    cached = true;
    return true;
  }
  cached = false;
  return false;
}

export function applyLowPowerClass() {
  if (isLowPower()) {
    document.documentElement.classList.add('low-power');
  }
}

/** Interval that sleeps while the Mini App is in the background. */
export function useVisibleInterval(
  callback: () => void,
  ms: number,
  enabled = true,
) {
  const cb = useRef(callback);
  cb.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const tick = () => cb.current();
    const start = () => {
      if (id != null) return;
      id = setInterval(tick, ms);
    };
    const stop = () => {
      if (id == null) return;
      clearInterval(id);
      id = null;
    };
    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [ms, enabled]);
}
