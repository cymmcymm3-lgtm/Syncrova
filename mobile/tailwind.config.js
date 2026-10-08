/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        syncrova: {
          blue: '#0A7CFF',
          ink: '#0F172A',
          muted: '#64748B',
          line: '#E2E8F0',
          surface: '#F8FAFC'
        }
      }
    }
  },
  plugins: []
};
