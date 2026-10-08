import React from 'react';
import type { ElementType, ReactNode } from 'react';

const toneClasses = {
  blue: 'bg-ui-accent/10 text-ui-accent dark:bg-ui-accent/15 dark:text-ui-accentHover',
  slate: 'bg-ui-hover text-slate-700 dark:bg-ui-hover dark:text-ui-text',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-200'
};

type PrimitiveTone = keyof typeof toneClasses;

type PanelProps = {
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
};

export function Panel({ as: Component = 'section', className = '', children, ...props }: PanelProps) {
  return (
    <Component
      className={`rounded-2xl border border-ui-border bg-ui-surface shadow-sm dark:border-ui-border dark:bg-ui-surface ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}

type IconBadgeProps = {
  icon: ElementType;
  tone?: PrimitiveTone;
  className?: string;
  size?: number;
};

export function IconBadge({ icon: Icon, tone = 'blue', className = '', size = 21 }: IconBadgeProps) {
  return (
    <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${toneClasses[tone] || toneClasses.blue} ${className}`}>
      <Icon size={size} />
    </span>
  );
}

type PrimaryButtonProps = {
  as?: ElementType;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
};

export function PrimaryButton({ as: Component = 'button', className = '', children, ...props }: PrimaryButtonProps) {
  return (
    <Component
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-ui-accent px-4 py-2.5 text-sm font-black text-white transition hover:bg-ui-accentHover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}
