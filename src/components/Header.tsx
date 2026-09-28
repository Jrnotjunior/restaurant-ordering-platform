import { useRestaurant } from './RestaurantProvider';

export function Header() {
  const restaurant = useRestaurant();

  return (
    <header className="site-header">
      <a className="brand" href="/" aria-label={`${restaurant.name} home`}>
        {restaurant.logoUrl ? (
          <img src={restaurant.logoUrl} alt="" className="brand-logo" />
        ) : null}
        <span>{restaurant.name}</span>
      </a>

      <nav aria-label="Primary navigation">
        {restaurant.navigation.map((item) => (
          <a key={`${item.href}-${item.label}`} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>

      <a className="header-cart" href="/cart">Cart</a>
    </header>
  );
}
