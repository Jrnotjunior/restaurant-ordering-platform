import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';
import type { RestaurantConfig, RestaurantTheme } from '../types/restaurant';

type ThemeContextValue = RestaurantTheme;

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: RestaurantTheme) {
  const root = document.documentElement;

  root.style.setProperty('--font-heading', theme.fontHeading);
  root.style.setProperty('--font-body', theme.fontBody);
  root.style.setProperty('--font-ui', theme.fontUi);

  root.style.setProperty('--color-primary', theme.colors.primary);
  root.style.setProperty('--color-primary-hover', theme.colors.primaryHover);
  root.style.setProperty('--color-primary-text', theme.colors.primaryText);
  root.style.setProperty('--color-secondary', theme.colors.secondary);
  root.style.setProperty('--color-secondary-text', theme.colors.secondaryText);
  root.style.setProperty('--color-background', theme.colors.background);
  root.style.setProperty('--color-surface', theme.colors.surface);
  root.style.setProperty('--color-text', theme.colors.text);
  root.style.setProperty('--color-muted', theme.colors.muted);
  root.style.setProperty('--color-border', theme.colors.border);
  root.style.setProperty('--color-success', theme.colors.success);
  root.style.setProperty('--color-warning', theme.colors.warning);
  root.style.setProperty('--color-error', theme.colors.error);
}

type ThemeProviderProps = {
  restaurant: RestaurantConfig;
  children: ReactNode;
};

export function ThemeProvider({ restaurant, children }: ThemeProviderProps) {
  const theme = useMemo(() => restaurant.theme, [restaurant.theme]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const theme = useContext(ThemeContext);

  if (!theme) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return theme;
}
