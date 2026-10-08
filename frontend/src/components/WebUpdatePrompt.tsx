import React, { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';

export default function WebUpdatePrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || window.Capacitor?.isNativePlatform?.()) return undefined;

    const showPrompt = () => setVisible(true);
    window.addEventListener('syncrova:web-update-ready', showPrompt);
    return () => window.removeEventListener('syncrova:web-update-ready', showPrompt);
  }, []);

  if (!visible) return null;

  const applyUpdate = () => {
    window.dispatchEvent(new CustomEvent('syncrova:apply-web-update'));
  };

  return (
    <div className="fixed inset-x-3 bottom-4 z-[130] mx-auto max-w-md">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-950 shadow-2xl shadow-slate-950/18 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
        <div className="flex items-start gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b57d0] text-white">
            <RefreshCw size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black">New Syncrova web version</p>
            <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Refresh to load the newest web build.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Dismiss web update"
          >
            <X size={17} />
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-3 dark:border-slate-800">
          <button
            type="button"
            onClick={applyUpdate}
            className="h-10 rounded-xl bg-[#0b57d0] px-4 text-sm font-black text-white transition hover:bg-[#0847ab]"
          >
            Refresh now
          </button>
        </div>
      </div>
    </div>
  );
}
