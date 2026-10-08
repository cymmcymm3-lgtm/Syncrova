import React from 'react';

const markSizes = {
  xs: 'h-9 w-9 rounded-xl text-[0.8rem]',
  sm: 'h-11 w-11 rounded-2xl text-[0.95rem]',
  md: 'h-14 w-14 rounded-[1.35rem] text-[1.15rem]',
  lg: 'h-16 w-16 rounded-[1.55rem] text-[1.35rem]',
};

const wordSizes = {
  sm: 'text-2xl',
  md: 'text-3xl',
  lg: 'text-4xl',
};

export function AppLogoMark({ size = 'md', animated = false, className = '' }) {
  return (
    <span
      className={`${markSizes[size] || markSizes.md} app-logo-mark relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-white p-1 font-black text-white shadow-xl shadow-violet-500/20 ring-1 ring-violet-100 dark:bg-white dark:ring-white/10 ${animated ? 'app-logo-mark--float' : ''} ${className}`}
      aria-hidden="true"
    >
      <img src="/syncrova-app-logo.png" alt="" className="h-full w-full object-contain" />
    </span>
  );
}

export function AppWordmark({ size = 'md', subtitle = false, tone = 'default', className = '' }) {
  const titleTone = tone === 'inverse' ? 'text-white' : 'text-gray-950 dark:text-white';
  const subtitleTone = tone === 'inverse' ? 'text-white/45' : 'text-gray-500 dark:text-gray-400';

  return (
    <span className={`min-w-0 ${className}`}>
      <span className={`${wordSizes[size] || wordSizes.md} ${titleTone} block truncate font-black tracking-normal drop-shadow-sm`}>
        Sync<span className="bg-gradient-to-r from-[#0b57d0] via-[#2387a8] to-[#7c3aed] bg-clip-text text-transparent">rova</span>
      </span>
      {subtitle && (
        <span className={`${subtitleTone} mt-0.5 block truncate text-[10px] font-black uppercase tracking-normal`}>
          Connect - Collaborate - Create
        </span>
      )}
    </span>
  );
}

export default function AppLogo({ size = 'md', wordSize = 'md', subtitle = false, animated = false, tone = 'default', className = '' }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-3 ${className}`}>
      <AppLogoMark size={size} animated={animated} />
      <AppWordmark size={wordSize} subtitle={subtitle} tone={tone} />
    </span>
  );
}
