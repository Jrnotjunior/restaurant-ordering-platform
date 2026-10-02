import { ReactNode } from 'react';

export type RestaurantRole = 'owner' | 'cashier' | 'kitchen' | 'dispatcher';

type Props = {
  role: RestaurantRole;
  restaurantName?: string;
  children?: ReactNode;
};

const roleInfo = {
  owner: { eyebrow: 'Restaurant owner', title: 'Owner Dashboard', description: 'Manage your restaurant, team, products, orders, and operations.' },
  cashier: { eyebrow: 'Cashier', title: 'Cashier Dashboard', description: 'Handle customer orders, payments, receipts, and cashier tasks.' },
  kitchen: { eyebrow: 'Kitchen', title: 'Kitchen Dashboard', description: 'View confirmed orders and update the kitchen preparation status.' },
  dispatcher: { eyebrow: 'Dispatch', title: 'Dispatcher Dashboard', description: 'Manage ready orders, rider assignments, pickups, and courier handoffs.' },
} as const;

export function RestaurantRoleDashboardPage({ role, restaurantName, children }: Props) {
  const info = roleInfo[role];
  return (
    <section className="restaurant-role-dashboard">
      <div className="restaurant-role-dashboard-header">
        <div>
          <p className="eyebrow">{info.eyebrow}</p>
          <h1>{info.title}</h1>
          <p>{restaurantName ? restaurantName + ' · ' : ''}{info.description}</p>
        </div>
      </div>
      <div className="restaurant-role-dashboard-content">{children}</div>
    </section>
  );
}
