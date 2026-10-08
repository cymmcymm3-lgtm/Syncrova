import React, { createContext, useContext, useEffect, ReactNode } from 'react';

export type ThemeKey = 'light';

export interface ThemeContextValue {
  /** Syncrova has one deliberately consistent light appearance. */
  theme: ThemeKey;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(() => {
    // Clear legacy preferences so an old dark-mode choice cannot reappear.
    localStorage.removeItem('theme');
    document.documentElement.classList.remove('dark');
    document.documentElement.dataset.theme = 'light';
    document.documentElement.dataset.mobileLightOnly = 'true';

    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    if (themeColor) themeColor.content = '#f0f2f5';
  }, []);

  return <ThemeContext.Provider value={{ theme: 'light' }}>{children}</ThemeContext.Provider>;
};

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a <ThemeProvider>.');
  return ctx;
};
