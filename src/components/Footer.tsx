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
        {storefront.sections.location && restaurant.locationText ? <p>{restaurant.locationText}</p> : null}
        {storefront.sections.contact && restaurant.contactNumber ? <p>{restaurant.contactNumber}</p> : null}
        {storefront.sections.contact && restaurant.email ? <p>{restaurant.email}</p> : null}
      </div>

      {storefront.sections.social && restaurant.socialLinks && restaurant.socialLinks.length > 0 ? (
        <nav aria-label="Social links">
          {restaurant.socialLinks.map((link) => (
            <a key={`${link.href}-${link.label}`} href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}

      <small>{storefront.footer.text || `© ${new Date().getFullYear()} ${restaurant.name}. All rights reserved.`}</small>

      <a className="site-footer-powered-by" href="https://web2table.com" target="_blank" rel="noreferrer" aria-label="Powered by Web2Table">
        <span>Powered by</span>
        <span className="site-footer-web2table-logo" aria-hidden="true"><span className="site-footer-web2table-mark">W</span><strong>Web2Table</strong></span>
      </a>
    </footer>
  );
}
