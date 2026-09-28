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
  colors: {
    primary: string;
    primaryHover: string;
    secondary: string;
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

export type RestaurantConfig = {
  name: string;
  tagline: string;
  logoUrl?: string;
  contactNumber?: string;
  email?: string;
  locationText?: string;
  navigation: RestaurantNavigationItem[];
  footerLinks: RestaurantFooterLink[];
  socialLinks?: {
    label: string;
    href: string;
  }[];
  theme: RestaurantTheme;
};
