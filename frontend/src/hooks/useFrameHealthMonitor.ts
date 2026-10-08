import { useEffect, useRef } from 'react';
import { isMobilePerformanceRuntime } from '../utils/performance';

const DEBUG_KEY = 'syncrova:perf-debug';
const FRAME_BUDGET_MS = 16.7;
const SLOW_FRAME_MS = 34;
const SEVERE_FRAME_MS = 54;
const RECOVERY_MS = 850;

const isDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
};

interface FrameHealthMonitorOptions {
  enabled?: boolean;
}

export default function useFrameHealthMonitor({ enabled = true }: FrameHealthMonitorOptions = {}): void {
  const rafRef = useRef(0);
  const recoveryTimerRef = useRef(0);
  const lastDebugLogRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    if (!isMobilePerformanceRuntime()) return undefined;

    const root = document.documentElement;
    let lastFrameTime = 0;
    let slowFrameCount = 0;
    let sampleWindowStartedAt = 0;

    const clearRecoveryTimer = (): void => {
      if (recoveryTimerRef.current) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = 0;
      }
    };

    const markUnstable = (delta: number): void => {
      root.classList.add('syncrova-frame-unstable');
      root.style.setProperty('--syncrova-last-frame-ms', String(Math.round(delta)));
      window.dispatchEvent(new CustomEvent('syncrova:frame-health', {
        detail: {
          unstable: true,
          frameMs: Math.round(delta),
          budgetMs: FRAME_BUDGET_MS
        }
      }));

      clearRecoveryTimer();
      recoveryTimerRef.current = window.setTimeout(() => {
        root.classList.remove('syncrova-frame-unstable');
        root.style.removeProperty('--syncrova-last-frame-ms');
      }, RECOVERY_MS);

      if (isDebugEnabled()) {
        const now = performance.now();
        if (now - lastDebugLogRef.current > 900) {
          lastDebugLogRef.current = now;
          console.debug('[syncrova:frame-health]', {
            frameMs: Math.round(delta),
            slowFrameCount
          });
        }
      }
    };

    const sample = (timestamp: number): void => {
      rafRef.current = window.requestAnimationFrame(sample);

      if (document.hidden) {
        lastFrameTime = timestamp;
        slowFrameCount = 0;
        sampleWindowStartedAt = timestamp;
        return;
      }

      if (!lastFrameTime) {
        lastFrameTime = timestamp;
        sampleWindowStartedAt = timestamp;
        return;
      }

      const delta = timestamp - lastFrameTime;
      lastFrameTime = timestamp;

      if (timestamp - sampleWindowStartedAt > 1300) {
        slowFrameCount = 0;
        sampleWindowStartedAt = timestamp;
      }

      if (delta >= SLOW_FRAME_MS) {
        slowFrameCount += delta >= SEVERE_FRAME_MS ? 2 : 1;
      } else {
        slowFrameCount = Math.max(0, slowFrameCount - 1);
      }

      if (delta >= SEVERE_FRAME_MS || slowFrameCount >= 3) {
        markUnstable(delta);
        slowFrameCount = Math.max(1, slowFrameCount - 2);
      }
    };

    rafRef.current = window.requestAnimationFrame(sample);

    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      clearRecoveryTimer();
      root.classList.remove('syncrova-frame-unstable');
      root.style.removeProperty('--syncrova-last-frame-ms');
    };
  }, [enabled]);
}
