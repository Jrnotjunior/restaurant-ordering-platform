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

      {storefront.sections.social ? (
        <nav className="site-footer-socials" aria-label="Social media links">
          {storefront.socialLinks?.facebook ? (
            <a href={storefront.socialLinks.facebook} target="_blank" rel="noreferrer" aria-label="Facebook">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 8.5V7.2c0-.6.4-.9 1-.9h1.8V3.2h-2.6c-2.8 0-4.5 1.7-4.5 4.6v.7H6.4v3.2h2.8v9.1h3.7v-9.1h2.9l.5-3.2h-3z"/></svg>
            </a>
          ) : null}
          {storefront.socialLinks?.instagram ? (
            <a href={storefront.socialLinks.instagram} target="_blank" rel="noreferrer" aria-label="Instagram">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="3.2" width="17.6" height="17.6" rx="5"/><circle cx="12" cy="12" r="4.1"/><circle cx="17.4" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>
            </a>
          ) : null}
          {storefront.socialLinks?.tiktok ? (
            <a href={storefront.socialLinks.tiktok} target="_blank" rel="noreferrer" aria-label="TikTok">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.2 3.2h3.1c.3 1.8 1.3 3.1 3.1 3.8v3.2c-1.3-.1-2.4-.5-3.4-1.1v6.1c0 3.1-2.2 5.2-5.3 5.2-2.8 0-5-1.9-5-4.7 0-3 2.5-5 5.5-4.9v3.2c-1.1-.1-2.2.5-2.2 1.7 0 .9.7 1.6 1.6 1.6 1.1 0 1.8-.8 1.8-2V3.2h.8z"/></svg>
            </a>
          ) : null}
        </nav>
      ) : null}

      <small>{storefront.footer.text || `© ${new Date().getFullYear()} ${restaurant.name}. All rights reserved.`}</small>

      <a className="site-footer-powered-by" href="https://web2table.com" target="_blank" rel="noreferrer" aria-label="Powered by Web2Table">
        <span>Powered by</span>
        {restaurant.logoUrl ? <img src={restaurant.logoUrl} alt="Web2Table" className="site-footer-web2table-logo" /> : <strong>Web2Table</strong>}
      </a>
    </footer>
  );
}
