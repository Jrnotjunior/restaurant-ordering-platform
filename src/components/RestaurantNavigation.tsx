import { useEffect, useState } from 'react';

type NavigationItem = {
  label: string;
  href: string;
  icon: 'dashboard' | 'orders' | 'products' | 'riders' | 'shipping' | 'sales';
};

const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', href: '#restaurant/dashboard', icon: 'dashboard' },
  { label: 'Orders', href: '#restaurant/orders', icon: 'orders' },
  { label: 'Products', href: '#restaurant/menu', icon: 'products' },
  { label: 'Riders', href: '#restaurant/riders', icon: 'riders' },
  { label: 'Shipping Fee', href: '#restaurant/shipping-fee', icon: 'shipping' },
  { label: 'Sales', href: '#restaurant/sales', icon: 'sales' },
];

function NavigationIcon({ type }: { type: NavigationItem['icon'] }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (type === 'dashboard') {
    return <svg {...common}><path d="M4 10.5 12 4l8 6.5" /><path d="M6.5 9.5V20h11V9.5" /><path d="M9.5 20v-6h5v6" /></svg>;
  }

  if (type === 'orders') {
    return <svg {...common}><path d="M6 3.5h9l3 3V20.5H6z" /><path d="M14 3.5v4h4" /><path d="M9 12h6M9 15.5h6" /></svg>;
  }

  if (type === 'products') {
    return <svg {...common}><path d="m12 3 7 4v10l-7 4-7-4V7z" /><path d="m5 7 7 4 7-4M12 11v10" /></svg>;
  }

  if (type === 'riders') {
    return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.7-3.2 2.5-5 5.5-5s4.8 1.8 5.5 5" /><path d="M16 6.5h4M18 4.5v4" /></svg>;
  }

  if (type === 'shipping') {
    return <svg {...common}><path d="M3.5 6.5h10v10h-10zM13.5 10h4l3 3v3.5h-7z" /><circle cx="7.5" cy="18" r="2" /><circle cx="17.5" cy="18" r="2" /></svg>;
  }

  return <svg {...common}><path d="M4 19.5V10M10 19.5V6M16 19.5v-9M22 19.5V3" /><path d="M2.5 19.5h20" /></svg>;
}

function getCurrentRoute() {
  return window.location.hash || '#restaurant/dashboard';
}

export function RestaurantNavigation() {
  const [currentRoute, setCurrentRoute] = useState(getCurrentRoute);

  useEffect(() => {
    const handleHashChange = () => setCurrentRoute(getCurrentRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <nav className="restaurant-navigation" aria-label="Restaurant operations navigation">
      {navigationItems.map((item) => {
        const active = currentRoute === item.href;
        return (
          <a
            key={item.href}
            className={`restaurant-navigation-item${active ? ' is-active' : ''}`}
            href={item.href}
            aria-current={active ? 'page' : undefined}
          >
            <span className="restaurant-navigation-icon"><NavigationIcon type={item.icon} /></span>
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
