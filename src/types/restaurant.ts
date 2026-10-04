export type RestaurantNavigationItem = {
  label: string;
  href: string;
};

export type RestaurantFooterLink = {
  label: string;
  href: string;
};

export type RestaurantTheme = {
  fontHeading: string;
  fontBody: string;
  fontUi: string;
  borderRadius?: 'small' | 'medium' | 'large';
  buttonStyle?: 'filled' | 'outline' | 'soft';
  colors: {
    primary: string;
    primaryHover: string;
    primaryText: string;
    secondary: string;
    secondaryText: string;
    background: string;
    surface: string;
    text: string;
    muted: string;
    border: string;
    success: string;
    warning: string;
    error: string;
  };
};

export type RestaurantDayHours = {
  isOpen: boolean;
  open: string;
  close: string;
};

export type RestaurantOperatingHours = Record<string, RestaurantDayHours>;

export type RestaurantConfig = {
  id?: string;
  name: string;
  tagline: string;
  logoUrl?: string;
  contactNumber?: string;
  email?: string;
  locationText?: string;
  operatingHours?: RestaurantOperatingHours;
  orderingEnabled?: boolean;
  navigation: RestaurantNavigationItem[];
  footerLinks: RestaurantFooterLink[];
  socialLinks?: {
    label: string;
    href: string;
  }[];
  theme: RestaurantTheme;
};
