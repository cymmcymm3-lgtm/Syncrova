import { useEffect, useRef } from 'react';

const DEBUG_KEY = 'syncrova:render-debug';

type DebugDetails = Record<string, unknown> | null | undefined;
type DetailsGetter = DebugDetails | (() => DebugDetails);

const isEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.localStorage?.getItem(DEBUG_KEY) === '1';
};

export default function useRenderDebug(name: string, getDetails: DetailsGetter = null): void {
  const renderCountRef = useRef(0);
  const lastLogRef = useRef(0);

  useEffect(() => {
    if (!isEnabled()) return;
    renderCountRef.current += 1;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastLogRef.current < 500) return;
    lastLogRef.current = now;

    const details = typeof getDetails === 'function' ? getDetails() : getDetails;
    // Enable with: localStorage.setItem('syncrova:render-debug', '1')
    console.debug('[syncrova:render]', name, {
      renders: renderCountRef.current,
      ...(details || {})
    });
  });
}
