import { useRestaurant } from './RestaurantProvider';

function withBasePath(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  if (path === '/menu') return `${base}/#menu`;
  if (path === '/cart') return `${base}/#cart`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function Header() {
  const restaurant = useRestaurant();

  return (
    <header className="site-header">
      <a className="brand" href={withBasePath('/')} aria-label={`${restaurant.name} home`}>
        {restaurant.logoUrl ? (
          <img src={restaurant.logoUrl} alt="" className="brand-logo" />
        ) : null}
        <span>{restaurant.name}</span>
      </a>

      <nav aria-label="Primary navigation">
        {restaurant.navigation.map((item) => (
          <a key={`${item.href}-${item.label}`} href={withBasePath(item.href)}>
            {item.label}
          </a>
        ))}
      </nav>

      <a
        className="header-cart"
        href={withBasePath('/cart')}
        aria-label="View cart"
        title="Cart"
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
      </a>
    </header>
  );
}
