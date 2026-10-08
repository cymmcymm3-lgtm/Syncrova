import React, { createContext, useContext } from 'react';

export type MessengerThemeColors = {
  background: string;
  sidebar: string;
  surface: string;
  elevated: string;
  surfaceHover: string;
  surfaceActive: string;
  text: string;
  mutedText: string;
  border: string;
  input: string;
  primary: string;
  primaryHover: string;
  onPrimary: string;
  sentBubble: string;
  receivedBubble: string;
  online: string;
  danger: string;
  warning: string;
  overlay: string;
  focusRing: string;
};

type ThemeContextValue = {
  colors: MessengerThemeColors;
};

const lightColors: MessengerThemeColors = {
  background: '#F6F7F9',
  sidebar: '#FFFFFF',
  surface: '#FFFFFF',
  elevated: '#FFFFFF',
  surfaceHover: '#F0F2F5',
  surfaceActive: '#E7EAEE',
  text: '#1C1E21',
  mutedText: '#65676B',
  border: '#CED0D4',
  input: '#F0F2F5',
  primary: '#0A7CFF',
  primaryHover: '#0869D6',
  onPrimary: '#FFFFFF',
  sentBubble: '#0A7CFF',
  receivedBubble: '#E4E6EB',
  online: '#42B72A',
  danger: '#DC2626',
  warning: '#D97706',
  overlay: 'rgba(20, 21, 24, 0.48)',
  focusRing: 'rgba(10, 124, 255, 0.32)'
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const colors = lightColors;
  return <ThemeContext.Provider value={{ colors }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
};
