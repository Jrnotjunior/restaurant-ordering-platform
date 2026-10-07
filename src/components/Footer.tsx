import { useRestaurant } from './RestaurantProvider';

export function Footer() {
  const restaurant = useRestaurant();
  const storefront = restaurant.storefront;

  const socialLinks = storefront.socialLinks;

  return (
    <footer className="site-footer">
      <nav className="site-footer-socials" aria-label="Social media links">
        {socialLinks?.facebook ? (
          <a href={socialLinks.facebook} target="_blank" rel="noreferrer" aria-label="Facebook">
            <img src="/restaurant-ordering-platform/social-facebook.svg" alt="Facebook" className="site-footer-social-logo" />
          </a>
        ) : (
          <span className="site-footer-social-icon is-disabled" aria-label="Facebook">
            <img src="/restaurant-ordering-platform/social-facebook.svg" alt="" className="site-footer-social-logo" />
          </span>
        )}

        {socialLinks?.instagram ? (
          <a href={socialLinks.instagram} target="_blank" rel="noreferrer" aria-label="Instagram">
            <img src="/restaurant-ordering-platform/social-instagram.svg" alt="Instagram" className="site-footer-social-logo" />
          </a>
        ) : (
          <span className="site-footer-social-icon is-disabled" aria-label="Instagram">
            <img src="/restaurant-ordering-platform/social-instagram.svg" alt="" className="site-footer-social-logo" />
          </span>
        )}

        {socialLinks?.tiktok ? (
          <a href={socialLinks.tiktok} target="_blank" rel="noreferrer" aria-label="TikTok">
            <img src="/restaurant-ordering-platform/social-tiktok.svg" alt="TikTok" className="site-footer-social-logo" />
          </a>
        ) : (
          <span className="site-footer-social-icon is-disabled" aria-label="TikTok">
            <img src="/restaurant-ordering-platform/social-tiktok.svg" alt="" className="site-footer-social-logo" />
          </span>
        )}
      </nav>

      <small>{`© ${new Date().getFullYear()} All rights reserved.`}</small>

      <a className="site-footer-powered-by" href="https://web2table.com" target="_blank" rel="noreferrer" aria-label="Powered by Web2Table">
        <span>Powered by</span>
        <img src="https://raw.githubusercontent.com/Jrnotjunior/restaurant-ordering-platform/main/web2table.png" alt="Web2Table" className="site-footer-web2table-logo" />
      </a>
    </footer>
  );
}
