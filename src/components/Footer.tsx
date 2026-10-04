import { useRestaurant } from './RestaurantProvider';

export function Footer() {
  const restaurant = useRestaurant();

  const storefront = restaurant.storefront;

  if (!storefront.footer.enabled) return null;

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

      {restaurant.socialLinks && restaurant.socialLinks.length > 0 ? (
        <nav aria-label="Social links">
          {restaurant.socialLinks.map((link) => (
            <a key={`${link.href}-${link.label}`} href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}

      <small>{storefront.footer.text || `© ${new Date().getFullYear()} ${restaurant.name}. All rights reserved.`}</small>
    </footer>
  );
}
