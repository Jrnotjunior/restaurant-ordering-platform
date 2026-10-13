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
          <span className="site-footer-legal-symbol" aria-hidden="true">◈</span>
          <span className="site-footer-legal-title">Privacy Notice</span>
          <span className="site-footer-legal-description">How we collect and use your information.</span>
        </a>
        <a className="site-footer-legal-item" href="#terms">
          <span className="site-footer-legal-symbol" aria-hidden="true">▤</span>
          <span className="site-footer-legal-title">Terms &amp; Conditions</span>
          <span className="site-footer-legal-description">Rules for using our ordering service.</span>
        </a>
        <a className="site-footer-legal-item" href="#refunds">
          <span className="site-footer-legal-symbol" aria-hidden="true">↻</span>
          <span className="site-footer-legal-title">Refund &amp; Cancellation Policy</span>
          <span className="site-footer-legal-description">Information about cancellations, refunds, and order issues.</span>
        </a>
      </nav>

      <div className="site-footer-bottom">
        <div className="site-footer-copyright">
          <small>{`© ${new Date().getFullYear()} All rights reserved.`}</small>
          <p>This site is operated by the restaurant and powered by Web2Table.</p>
        </div>
        <a className="site-footer-powered-by" href="https://web2table.com" target="_blank" rel="noreferrer" aria-label="Powered by Web2Table">
          <span>Powered by</span>
          <img src="https://raw.githubusercontent.com/Jrnotjunior/restaurant-ordering-platform/main/web2table.png" alt="Web2Table" className="site-footer-web2table-logo" />
        </a>
      </div>
    </footer>
  );
}
