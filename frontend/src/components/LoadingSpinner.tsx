import React from 'react';

export default function LoadingSpinner({ label = 'Loading Syncrova', fullScreen = false, compact = false }) {
  const rootHeight = fullScreen ? 'min-h-screen' : compact ? 'min-h-[160px]' : 'min-h-[320px]';

  return (
    <div className={`relative flex ${rootHeight} w-full items-center justify-center px-4 py-8`} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className={`messenger-loader ${compact ? 'messenger-loader-compact' : ''}`} aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
