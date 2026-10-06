import { useRestaurant } from './RestaurantProvider';

export function Footer() {
  const restaurant = useRestaurant();
  const storefront = restaurant.storefront;

  if (!storefront.footer.enabled) return null;

  const socialLinks = storefront.socialLinks;

  return (
    <footer className="site-footer">
      <nav className="site-footer-socials" aria-label="Social media links">
        {socialLinks?.facebook ? (
          <a href={socialLinks.facebook} target="_blank" rel="noreferrer" aria-label="Facebook">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="20" fill="#1877F2" />
              <path fill="#fff" d="M22.5 29v-7h2.4l.4-2.8h-2.8v-1.8c0-.8.3-1.4 1.5-1.4h1.5v-2.5c-.3 0-1.1-.1-2.1-.1-2.1 0-3.6 1.3-3.6 3.7v2.1h-2.4V22h2.4v7h2.7Z" />
            </svg>
          </a>
        ) : (
          <span className="site-footer-social-icon is-disabled" aria-label="Facebook">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="20" fill="#1877F2" />
              <path fill="#fff" d="M22.5 29v-7h2.4l.4-2.8h-2.8v-1.8c0-.8.3-1.4 1.5-1.4h1.5v-2.5c-.3 0-1.1-.1-2.1-.1-2.1 0-3.6 1.3-3.6 3.7v2.1h-2.4V22h2.4v7h2.7Z" />
            </svg>
          </span>
        )}

        {socialLinks?.instagram ? (
          <a href={socialLinks.instagram} target="_blank" rel="noreferrer" aria-label="Instagram">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <defs>
                <radialGradient id="instagramGradient" cx="30%" cy="107%" r="150%">
                  <stop offset="0%" stopColor="#FDF497" />
                  <stop offset="5%" stopColor="#FDF497" />
                  <stop offset="45%" stopColor="#FD5949" />
                  <stop offset="60%" stopColor="#D6249F" />
                  <stop offset="90%" stopColor="#285AEB" />
                </radialGradient>
              </defs>
              <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#instagramGradient)" />
              <rect x="11" y="11" width="18" height="18" rx="5" fill="none" stroke="#fff" strokeWidth="2.4" />
              <circle cx="20" cy="20" r="4.2" fill="none" stroke="#fff" strokeWidth="2.4" />
              <circle cx="26.5" cy="13.5" r="1.5" fill="#fff" />
            </svg>
          </a>
        ) : (
          <span className="site-footer-social-icon is-disabled" aria-label="Instagram">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <defs>
                <radialGradient id="instagramGradientDisabled" cx="30%" cy="107%" r="150%">
                  <stop offset="0%" stopColor="#FDF497" />
                  <stop offset="45%" stopColor="#FD5949" />
                  <stop offset="60%" stopColor="#D6249F" />
                  <stop offset="90%" stopColor="#285AEB" />
                </radialGradient>
              </defs>
              <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#instagramGradientDisabled)" />
              <rect x="11" y="11" width="18" height="18" rx="5" fill="none" stroke="#fff" strokeWidth="2.4" />
              <circle cx="20" cy="20" r="4.2" fill="none" stroke="#fff" strokeWidth="2.4" />
              <circle cx="26.5" cy="13.5" r="1.5" fill="#fff" />
            </svg>
          </span>
        )}

        {socialLinks?.tiktok ? (
          <a href={socialLinks.tiktok} target="_blank" rel="noreferrer" aria-label="TikTok">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path fill="#25F4EE" d="M24 8c1.2 3.1 3.1 5.1 6 5.9v4.2c-2.2-.1-4.2-.8-6-2v8.1c0 5.1-3.9 8.8-8.8 8.8-4.6 0-8.2-3.5-8.2-7.9 0-4.7 4-8.1 9-7.9v4.5c-2.3-.2-4.5 1.2-4.5 3.4 0 1.9 1.6 3.4 3.6 3.4 2.2 0 3.9-1.7 3.9-4.2V8H24Z" />
              <path fill="#FE2C55" d="M22 8c1.2 3.1 3.1 5.1 6 5.9v4.2c-2.2-.1-4.2-.8-6-2v8.1c0 5.1-3.9 8.8-8.8 8.8-4.6 0-8.2-3.5-8.2-7.9 0-4.7 4-8.1 9-7.9v4.5c-2.3-.2-4.5 1.2-4.5 3.4 0 1.9 1.6 3.4 3.6 3.4 2.2 0 3.9-1.7 3.9-4.2V8H22Z" opacity=".9" />
              <path fill="#000" d="M23 8c1.2 3.1 3.1 5.1 6 5.9v4.2c-2.2-.1-4.2-.8-6-2v8.1c0 5.1-3.9 8.8-8.8 8.8-4.6 0-8.2-3.5-8.2-7.9 0-4.7 4-8.1 9-7.9v4.5c-2.3-.2-4.5 1.2-4.5 3.4 0 1.9 1.6 3.4 3.6 3.4 2.2 0 3.9-1.7 3.9-4.2V8H23Z" />
            </svg>
          </a>
        ) : (
          <span className="site-footer-social-icon is-disabled" aria-label="TikTok">
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path fill="#25F4EE" d="M24 8c1.2 3.1 3.1 5.1 6 5.9v4.2c-2.2-.1-4.2-.8-6-2v8.1c0 5.1-3.9 8.8-8.8 8.8-4.6 0-8.2-3.5-8.2-7.9 0-4.7 4-8.1 9-7.9v4.5c-2.3-.2-4.5 1.2-4.5 3.4 0 1.9 1.6 3.4 3.6 3.4 2.2 0 3.9-1.7 3.9-4.2V8H24Z" />
              <path fill="#FE2C55" d="M22 8c1.2 3.1 3.1 5.1 6 5.9v4.2c-2.2-.1-4.2-.8-6-2v8.1c0 5.1-3.9 8.8-8.8 8.8-4.6 0-8.2-3.5-8.2-7.9 0-4.7 4-8.1 9-7.9v4.5c-2.3-.2-4.5 1.2-4.5 3.4 0 1.9 1.6 3.4 3.6 3.4 2.2 0 3.9-1.7 3.9-4.2V8H22Z" opacity=".9" />
              <path fill="#000" d="M23 8c1.2 3.1 3.1 5.1 6 5.9v4.2c-2.2-.1-4.2-.8-6-2v8.1c0 5.1-3.9 8.8-8.8 8.8-4.6 0-8.2-3.5-8.2-7.9 0-4.7 4-8.1 9-7.9v4.5c-2.3-.2-4.5 1.2-4.5 3.4 0 1.9 1.6 3.4 3.6 3.4 2.2 0 3.9-1.7 3.9-4.2V8H23Z" />
            </svg>
          </span>
        )}
      </nav>

      <small>{storefront.footer.text || `© ${new Date().getFullYear()} All rights reserved.`}</small>

      <a className="site-footer-powered-by" href="https://web2table.com" target="_blank" rel="noreferrer" aria-label="Powered by Web2Table">
        <span>Powered by</span>
        <img src="https://raw.githubusercontent.com/Jrnotjunior/restaurant-ordering-platform/main/web2table.png" alt="Web2Table" className="site-footer-web2table-logo" />
      </a>
    </footer>
  );
}
