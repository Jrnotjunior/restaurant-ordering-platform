import { useRestaurant } from './RestaurantProvider';

function withBasePath(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function Footer() {
  const restaurant = useRestaurant();

  return (
    <footer className="site-footer">
      <div>
        <strong>{restaurant.name}</strong>
        <p>{restaurant.tagline}</p>
      </div>

      <div>
        {restaurant.locationText ? <p>{restaurant.locationText}</p> : null}
        {restaurant.contactNumber ? <p>{restaurant.contactNumber}</p> : null}
        {restaurant.email ? <p>{restaurant.email}</p> : null}
      </div>

      {restaurant.footerLinks.length > 0 ? (
        <nav aria-label="Footer navigation">
          {restaurant.footerLinks.map((link) => (
            <a key={`${link.href}-${link.label}`} href={withBasePath(link.href)}>
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}

      {restaurant.socialLinks && restaurant.socialLinks.length > 0 ? (
        <nav aria-label="Social links">
          {restaurant.socialLinks.map((link) => (
            <a key={`${link.href}-${link.label}`} href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}

      <small>© {new Date().getFullYear()} {restaurant.name}. All rights reserved.</small>
    </footer>
  );
}
