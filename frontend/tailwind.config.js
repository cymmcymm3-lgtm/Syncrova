/**
 * Semantic color utilities resolve through the CSS variables in `src/index.css`.
 * Keeping the alpha placeholder means utilities such as `bg-ui-surface/80` and
 * `ring-ui-accent/25` work exactly like Tailwind's built-in colors.
 */
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Remap blue-tinted dark palette to pure dark/black tones
      // This ensures ALL dark:bg-slate-*, dark:bg-blue-*, dark:bg-gray-* classes
      // render as pure black/dark gray instead of dark blue
      colors: {
        ui: {
          canvas: token('--ui-background-rgb'),
          sidebar: token('--ui-sidebar-rgb'),
          surface: token('--ui-surface-rgb'),
          elevated: token('--ui-surface-elevated-rgb'),
          hover: token('--ui-surface-hover-rgb'),
          active: token('--ui-surface-active-rgb'),
          input: token('--ui-input-rgb'),
          border: token('--ui-border-rgb'),
          text: token('--ui-text-primary-rgb'),
          muted: token('--ui-text-muted-rgb'),
          accent: token('--ui-accent-rgb'),
          accentHover: token('--ui-accent-hover-rgb'),
          success: token('--ui-success-rgb'),
          warning: token('--ui-warning-rgb'),
          danger: token('--ui-danger-rgb'),
        },
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e1f23',       // was #1e293b (blue-tinted) -> pure dark gray
          900: '#111114',       // was #0f172a (blue-tinted) -> pure near-black
          950: '#0c0c0f',       // was #020617 (blue-tinted) -> pure near-black
        },
        blue: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#1d4ed8',
          700: '#1e40af',
          800: '#1e3a8a',
          900: '#1e3a5f',
          950: '#111114',       // was #172554 (blue-tinted) -> pure near-black
        },
        gray: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f1f23',       // was #1f2937 -> pure dark gray
          900: '#111114',       // was #111827 -> pure near-black
          950: '#0c0c0f',       // was #030712 -> pure near-black
        },
      },
    },
  },
  plugins: [],
}
