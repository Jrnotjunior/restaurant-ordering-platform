import { useRestaurant } from './RestaurantProvider';
import './Footer.css';

export function Footer() {
  const restaurant = useRestaurant();
  const socialLinks = restaurant.storefront.socialLinks;
  const footerBackground = restaurant.theme.colors.footer ?? restaurant.theme.colors.background;
  const footerText = restaurant.theme.colors.footerText ?? restaurant.theme.colors.text;

  return (
    <footer className="site-footer" style={{ backgroundColor: footerBackground, color: footerText, borderTopColor: restaurant.theme.colors.border }}>
      <section className="site-footer-social-section" aria-label="Follow the restaurant">
        <h2 className="site-footer-heading" style={{ color: "inherit" }}>Follow Us</h2>
        <nav className="site-footer-socials" aria-label="Social media links">
          {[
            { name: 'Facebook', url: socialLinks?.facebook, icon: `${import.meta.env.BASE_URL}social-facebook.svg` },
            { name: 'Instagram', url: socialLinks?.instagram, icon: `${import.meta.env.BASE_URL}social-instagram.svg` },
            { name: 'TikTok', url: socialLinks?.tiktok, icon: `${import.meta.env.BASE_URL}social-tiktok.svg` },
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

      <div className="site-footer-bottom">
        <div className="site-footer-copyright">
          <small style={{ color: "inherit" }}>{`© ${new Date().getFullYear()} All rights reserved.`}</small>
        </div>
        <a className="site-footer-powered-by" style={{ color: "inherit" }} href="https://web2table.io" target="_blank" rel="noreferrer" aria-label="Powered by Web2Table">
          <span>Powered by</span>
          <img src="https://xaihajwrsvcdjisezmmc.supabase.co/storage/v1/object/public/web2table-assets/web2table1.png" alt="Web2Table" className="site-footer-web2table-logo" />
        </a>
      </div>
    </footer>
  );
}
