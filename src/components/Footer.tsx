import type { RestaurantConfig } from '../types/restaurant';

type FooterProps = {
  restaurant: RestaurantConfig;
};

export function Footer({ restaurant }: FooterProps) {
  return (
    <footer className="site-footer">
      <div>
        <strong>{restaurant.name}</strong>
        <p>{restaurant.tagline}</p>
      </div>
      <div>
        {restaurant.locationText ? <p>{restaurant.locationText}</p> : null}
        {restaurant.contactNumber ? <p>{restaurant.contactNumber}</p> : null}
      </div>
      <small>© {new Date().getFullYear()} {restaurant.name}. All rights reserved.</small>
    </footer>
  );
}
