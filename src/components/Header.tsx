import { useEffect, useState } from 'react';
import { useRestaurant } from './RestaurantProvider';
import '../styles/cart-badge.css';
import '../styles/header-actions.css';

function withBasePath(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  if (path === '/menu') return `${base}/#menu`;
  if (path === '/cart') return `${base}/#cart`;
  if (path === '/account') return `${base}/#account`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

type HeaderProps = {
  cartCount?: number;
};

export function Header({ cartCount = 0 }: HeaderProps) {
  const restaurant = useRestaurant();
  const [activeOrderNumber, setActiveOrderNumber] = useState(() => window.localStorage.getItem(ACTIVE_ORDER_KEY));

  useEffect(() => {
    const refreshActiveOrder = () => setActiveOrderNumber(window.localStorage.getItem(ACTIVE_ORDER_KEY));
    window.addEventListener('storage', refreshActiveOrder);
    window.addEventListener('restaurant-ordering-active-order-change', refreshActiveOrder);
    return () => {
      window.removeEventListener('storage', refreshActiveOrder);
      window.removeEventListener('restaurant-ordering-active-order-change', refreshActiveOrder);
    };
  }, []);

  return (
    <header className="site-header">
      <a className="brand" href={withBasePath('/')} aria-label={`${restaurant.name} home`}>
        {restaurant.logoUrl ? <img src={restaurant.logoUrl} alt="" className="brand-logo" /> : null}
        <span>{restaurant.name}</span>
      </a>

      <div className="header-actions">
        <a
          className="header-cart"
          href={withBasePath('/cart')}
          aria-label={cartCount > 0 ? `View cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'View cart'}
          title={cartCount > 0 ? `${cartCount} item${cartCount === 1 ? '' : 's'} in cart` : 'Cart'}
        >
          <svg className="header-cart-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <path d="M3 4h2l2.1 10.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20.5 7H6.2M9 19.5h.01M17 19.5h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {cartCount > 0 ? <span className="header-cart-badge" aria-hidden="true">{cartCount > 99 ? '99+' : cartCount}</span> : null}
        </a>

        {activeOrderNumber ? (
          <a
            className="header-track-order"
            href={withBasePath('/menu') + '?trackOrder=' + encodeURIComponent(activeOrderNumber)}
            aria-label={"Track order " + activeOrderNumber}
            title="Track my order"
          >
            <svg className="header-track-order-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path d="M4 5.5h16v13H4z" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 9h8M8 13h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </a>
        ) : null}

        <a className="header-account" href={withBasePath('/account')} aria-label="Account login" title="Account">
          <svg className="header-account-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M5 20c.8-3.5 3.1-5.5 7-5.5s6.2 2 7 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </a>
      </div>
    </header>
  );
}
