import type { RestaurantConfig } from '../types/restaurant';

export const defaultRestaurant: RestaurantConfig = {
  name: '',
  tagline: '',
  navigation: [
    { label: 'Home', href: '/' },
    { label: 'Menu', href: '/menu' },
    { label: 'About', href: '/about' }
  ],
  footerLinks: [
    { label: 'Home', href: '/' },
    { label: 'Menu', href: '/menu' },
    { label: 'About', href: '/about' },
    { label: 'Contact', href: '/contact' }
  ],
  socialLinks: [],
  theme: {
    fontHeading: 'Manrope',
    fontBody: 'Inter',
    fontUi: 'Inter',
    colors: {
      primary: '#111827',
      primaryHover: '#1f2937',
      primaryText: '#ffffff',
      secondary: '#f3f4f6',
      secondaryText: '#111827',
      background: '#ffffff',
      surface: '#ffffff',
      text: '#111827',
      muted: '#6b7280',
      border: '#e5e7eb',
      success: '#15803d',
      warning: '#b45309',
      error: '#b91c1c'
    }
  }
};
