import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from '../services/supabaseClient';

export type RestaurantRole = 'owner' | 'cashier' | 'kitchen' | 'dispatcher';

type Props = {
  role: RestaurantRole;
  restaurantName?: string;
  restaurantId?: string;
  children?: ReactNode;
};

type OwnerStats = {
  sales: number;
  orders: number;
  pendingOrders: number;
  products: number;
  employees: number;
  activeDeliveries: number;
};

const roleInfo = {
  owner: { eyebrow: 'Restaurant owner', title: 'Owner Dashboard', description: 'Manage your restaurant, team, products, orders, and operations.' },
  cashier: { eyebrow: 'Cashier', title: 'Cashier Dashboard', description: 'Handle customer orders, payments, receipts, and cashier tasks.' },
  kitchen: { eyebrow: 'Kitchen', title: 'Kitchen Dashboard', description: 'View confirmed orders and update the kitchen preparation status.' },
  dispatcher: { eyebrow: 'Dispatch', title: 'Dispatcher Dashboard', description: 'Manage ready orders, rider assignments, pickups, and courier handoffs.' },
} as const;

const ownerLinks = [
  { label: 'Orders', href: '#restaurant/orders', description: 'Review and manage customer orders.' },
  { label: 'Products', href: '#restaurant/menu', description: 'Manage your menu and product availability.' },
  { label: 'Employees', href: '#restaurant/employees', description: 'Manage cashiers, kitchen staff, dispatchers, and riders.' },
  { label: 'Dispatch', href: '#restaurant/delivery-dispatch', description: 'Handle ready deliveries, pickups, and dine-in service.' },
  { label: 'Shipping Fee', href: '#restaurant/shipping-fee', description: 'Configure delivery zones and fees.' },
  { label: 'Sales', href: '#restaurant/sales', description: 'Review sales activity and reports.' },
  { label: 'Store Settings', href: '#restaurant/settings', description: 'Manage restaurant settings and tax configuration.' },
];

async function loadOwnerStats(restaurantId: string): Promise<OwnerStats> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

  const [orders, products, employees, riders] = await Promise.all([
    supabase.from('orders').select('id,total,status,created_at,order_type,delivery_status').eq('restaurant_id', restaurantId).gte('created_at', start).lt('created_at', end),
    supabase.from('products').select('id').eq('restaurant_id', restaurantId).eq('is_active', true),
    supabase.from('restaurant_staff').select('id').eq('restaurant_id', restaurantId).eq('is_active', true),
    supabase.from('restaurant_riders').select('id').eq('restaurant_id', restaurantId).eq('is_active', true),
  ]);

  if (orders.error) throw orders.error;
  if (products.error) throw products.error;
  if (employees.error) throw employees.error;
  if (riders.error) throw riders.error;

  const orderRows = orders.data ?? [];
  const completedStatuses = new Set(['completed']);
  const sales = orderRows.reduce((sum, order) => completedStatuses.has(order.status) ? sum + Number(order.total ?? 0) : sum, 0);
  const pendingStatuses = new Set(['new', 'confirmed', 'preparing', 'ready']);
  const pendingOrders = orderRows.filter((order) => pendingStatuses.has(order.status)).length;
  const activeDeliveries = orderRows.filter((order) => order.order_type === 'delivery' && ['assigned', 'picked_up', 'out_for_delivery'].includes(order.delivery_status ?? '')).length;

  return {
    sales,
    orders: orderRows.length,
    pendingOrders,
    products: products.data?.length ?? 0,
    employees: (employees.data?.length ?? 0) + (riders.data?.length ?? 0),
    activeDeliveries,
  };
}

function OwnerDashboard({ restaurantName, restaurantId }: { restaurantName?: string; restaurantId?: string }) {
  const [stats, setStats] = useState<OwnerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!restaurantId) return;
    const ownerRestaurantId = restaurantId;
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        setError('');
        const data = await loadOwnerStats(ownerRestaurantId);
        if (mounted) setStats(data);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Unable to load dashboard data.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    const channel = supabase?.channel(`owner-dashboard:${ownerRestaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${ownerRestaurantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products', filter: `restaurant_id=eq.${ownerRestaurantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_staff', filter: `restaurant_id=eq.${ownerRestaurantId}` }, () => { void load(); })
      .subscribe();
    return () => {
      mounted = false;
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [restaurantId]);

  const statCards = useMemo(() => [
    { label: 'Today\'s Sales', value: loading ? '—' : `₱${(stats?.sales ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` },
    { label: 'Today\'s Orders', value: loading ? '—' : String(stats?.orders ?? 0) },
    { label: 'Pending Orders', value: loading ? '—' : String(stats?.pendingOrders ?? 0) },
    { label: 'Products', value: loading ? '—' : String(stats?.products ?? 0) },
    { label: 'Employees', value: loading ? '—' : String(stats?.employees ?? 0) },
    { label: 'Active Deliveries', value: loading ? '—' : String(stats?.activeDeliveries ?? 0) },
  ], [loading, stats]);

  return (
    <div className="restaurant-owner-dashboard">
      <header className="restaurant-owner-dashboard-topbar">
        <div>
          <p className="eyebrow">Store owner</p>
          <h2>{restaurantName || 'Restaurant'}</h2>
        </div>
        <span className="restaurant-owner-dashboard-live"><span /> System Online</span>
      </header>

      <div className="restaurant-owner-dashboard-heading">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Restaurant Dashboard</h1>
          <p>Monitor today's activity and access your restaurant operations.</p>
        </div>
      </div>

      {error && <div className="restaurant-owner-dashboard-error" role="alert">{error}</div>}

      <section className="restaurant-owner-dashboard-stats" aria-label="Restaurant overview">
        {statCards.map((card) => (
          <article className="restaurant-owner-dashboard-stat" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="restaurant-owner-dashboard-section">
        <div className="restaurant-owner-dashboard-section-heading">
          <div>
            <p className="eyebrow">Management</p>
            <h2>Restaurant Operations</h2>
          </div>
          <span>Owner access</span>
        </div>
        <div className="restaurant-owner-dashboard-links">
          {ownerLinks.map((link) => (
            <a href={link.href} className="restaurant-owner-dashboard-link" key={link.href}>
              <strong>{link.label}</strong>
              <span>{link.description}</span>
              <b aria-hidden="true">→</b>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

export function RestaurantRoleDashboardPage({ role, restaurantName, restaurantId, children }: Props) {
  const info = roleInfo[role];

  if (role === 'owner') {
    return (
      <section className="restaurant-role-dashboard">
        <OwnerDashboard restaurantName={restaurantName} restaurantId={restaurantId} />
      </section>
    );
  }

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
