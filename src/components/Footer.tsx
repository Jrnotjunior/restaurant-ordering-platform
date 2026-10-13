import { useRestaurant } from './RestaurantProvider';
import './Footer.css';

export function Footer() {
  const restaurant = useRestaurant();
  const socialLinks = restaurant.storefront.socialLinks;

  return (
    <footer className="site-footer">
      <section className="site-footer-social-section" aria-label="Follow the restaurant">
        <h2 className="site-footer-heading">Follow Us</h2>
        <nav className="site-footer-socials" aria-label="Social media links">
          {[
            { name: 'Facebook', url: socialLinks?.facebook, icon: '/restaurant-ordering-platform/social-facebook.svg' },
            { name: 'Instagram', url: socialLinks?.instagram, icon: '/restaurant-ordering-platform/social-instagram.svg' },
            { name: 'TikTok', url: socialLinks?.tiktok, icon: '/restaurant-ordering-platform/social-tiktok.svg' },
          ].map(({ name, url, icon }) =>
            url ? (
              <a key={name} className="site-footer-social-link" href={url} target="_blank" rel="noreferrer" aria-label={name}>
                <img src={icon} alt="" className="site-footer-social-logo" />
              </a>
            ) : (
              <span key={name} className="site-footer-social-link is-disabled" aria-label={`${name} not configured`} aria-disabled="true">
                <img src={icon} alt="" className="site-footer-social-logo" />
              </span>
            ),
          )}
        </nav>
      </section>

      <nav className="site-footer-legal" aria-label="Customer legal information">
        <a className="site-footer-legal-item" href="#privacy">
          <svg className="site-footer-legal-icon" viewBox="0 0 32 36" aria-hidden="true"><path d="M16 2 29 7v9c0 8-5.5 14-13 18C8.5 30 3 24 3 16V7L16 2Z" /></svg>
          <span className="site-footer-legal-title">Privacy Notice</span>
        </a>
        <a className="site-footer-legal-item" href="#terms">
          <svg className="site-footer-legal-icon" viewBox="0 0 32 36" aria-hidden="true"><path d="M6 2h14l8 8v24H6Z" /><path d="M20 2v9h8M11 18h12M11 24h12" /></svg>
          <span className="site-footer-legal-title">Terms &amp; Conditions</span>
        </a>
        <a className="site-footer-legal-item" href="#refunds">
          <svg className="site-footer-legal-icon" viewBox="0 0 36 36" aria-hidden="true"><path d="M29 13A13 13 0 0 0 6 10L3 14M3 6v8h8M7 23a13 13 0 0 0 23 3l3-4m0 8v-8h-8" /></svg>
          <span className="site-footer-legal-title">Refund &amp; Cancellation Policy</span>
        </a>
      </nav>

      <div className="site-footer-bottom">
        <div className="site-footer-copyright">
          <small>{`© ${new Date().getFullYear()} All rights reserved.`}</small>
        </div>
        <a className="site-footer-powered-by" href="https://web2table.io" target="_blank" rel="noreferrer" aria-label="Powered by Web2Table">
          <span>Powered by</span>
          <img src="https://raw.githubusercontent.com/Jrnotjunior/web2table.io/main/web2table.png" alt="Web2Table" className="site-footer-web2table-logo" />
        </a>
      </div>
    </footer>
  );
}
