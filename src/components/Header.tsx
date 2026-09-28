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

      <a className="header-cart" href={withBasePath('/cart')}>Cart</a>
    </header>
  );
}
