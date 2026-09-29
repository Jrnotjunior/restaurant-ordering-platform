import { useRestaurant } from './RestaurantProvider';
import '../styles/cart-badge.css';

function withBasePath(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  if (path === '/menu') return `${base}/#menu`;
  if (path === '/cart') return `${base}/#cart`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

type HeaderProps = {
  cartCount?: number;
};

export function Header({ cartCount = 0 }: HeaderProps) {
  const restaurant = useRestaurant();

  return (
    <header className="site-header">
      <a className="brand" href={withBasePath('/')} aria-label={`${restaurant.name} home`}>
        {restaurant.logoUrl ? (
          <img src={restaurant.logoUrl} alt="" className="brand-logo" />
        ) : null}
        <span>{restaurant.name}</span>
      </a>

      <a
        className="header-cart"
        href={withBasePath('/cart')}
        aria-label={cartCount > 0 ? `View cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'View cart'}
        title={cartCount > 0 ? `${cartCount} item${cartCount === 1 ? '' : 's'} in cart` : 'Cart'}
      >
        <svg
          className="header-cart-icon"
          viewBox="0 0 24 24"
          width="24"
          height="24"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M3 4h2l2.1 10.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20.5 7H6.2M9 19.5h.01M17 19.5h.01"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {cartCount > 0 ? <span className="header-cart-badge" aria-hidden="true">{cartCount > 99 ? '99+' : cartCount}</span> : null}
      </a>
    </header>
  );
}
