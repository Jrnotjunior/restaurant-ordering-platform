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
  dailySales: { label: string; total: number }[];
};

const roleInfo = {
  owner: { eyebrow: 'Restaurant owner', title: 'Owner Dashboard', description: 'Manage your restaurant, team, products, orders, and operations.' },
  cashier: { eyebrow: 'Cashier', title: 'Cashier Dashboard', description: 'Handle customer orders, payments, receipts, and cashier tasks.' },
  kitchen: { eyebrow: 'Kitchen', title: 'Kitchen Dashboard', description: 'View confirmed orders and update the kitchen preparation status.' },
  dispatcher: { eyebrow: 'Dispatch', title: 'Dispatcher Dashboard', description: 'Manage ready orders, rider assignments, pickups, and courier handoffs.' },
} as const;



async function loadOwnerStats(restaurantId: string): Promise<OwnerStats> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const chartStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  const start = chartStart.toISOString();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

  const [orders, products, employees] = await Promise.all([
    supabase.from('orders').select('id,total,status,created_at,order_type,delivery_status').eq('restaurant_id', restaurantId).gte('created_at', start).lt('created_at', end),
    supabase.from('products').select('id').eq('restaurant_id', restaurantId),
    supabase.from('restaurant_staff').select('id').eq('restaurant_id', restaurantId).eq('is_active', true),
  ]);

  if (orders.error) throw orders.error;
  if (products.error) throw products.error;
  if (employees.error) throw employees.error;

  const orderRows = orders.data ?? [];
  const completedStatuses = new Set(['completed']);
  const todayKey = startOfToday.toDateString();

  const sales = orderRows.reduce((sum, order) => {
    const orderDate = new Date(order.created_at);
    return orderDate.toDateString() === todayKey && completedStatuses.has(order.status)
      ? sum + Number(order.total ?? 0)
      : sum;
  }, 0);

  const todayOrders = orderRows.filter((order) => new Date(order.created_at).toDateString() === todayKey);
  const pendingStatuses = new Set(['new', 'confirmed', 'preparing', 'ready']);
  const pendingOrders = todayOrders.filter((order) => pendingStatuses.has(order.status)).length;
  const activeDeliveries = todayOrders.filter((order) => order.order_type === 'delivery' && ['assigned', 'picked_up', 'out_for_delivery'].includes(order.delivery_status ?? '')).length;

  const dailySales = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(chartStart.getFullYear(), chartStart.getMonth(), chartStart.getDate() + index);
    const key = date.toDateString();
    const total = orderRows.reduce((sum, order) => {
      const orderDate = new Date(order.created_at);
      return orderDate.toDateString() === key && completedStatuses.has(order.status)
        ? sum + Number(order.total ?? 0)
        : sum;
    }, 0);

    return {
      label: date.toLocaleDateString('en-PH', { weekday: 'short' }),
      total,
    };
  });

  return {
    sales,
    orders: todayOrders.length,
    pendingOrders,
    products: products.data?.length ?? 0,
    employees: employees.data?.length ?? 0,
    activeDeliveries,
    dailySales,
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
  ], [loading, stats]);

  return (
    <div className="restaurant-owner-dashboard">
      {error && <div className="restaurant-owner-dashboard-error" role="alert">{error}</div>}

      <section className="restaurant-owner-dashboard-stats" aria-label="Restaurant overview">
        {statCards.map((card) => (
          <article className="restaurant-owner-dashboard-stat" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </article>
        ))}
      </section>

      <section className="restaurant-owner-dashboard-chart">
        <div className="restaurant-owner-dashboard-chart-heading">
          <div>
            <p className="eyebrow">Sales activity</p>
            <h2>Daily Sales</h2>
          </div>
          <span>Last 7 days</span>
        </div>

        {loading ? (
          <div className="restaurant-owner-dashboard-chart-empty">Loading sales data…</div>
        ) : (
          <div className="restaurant-owner-dashboard-sales-chart" role="img" aria-label="Daily completed sales for the last 7 days">
            <div className="restaurant-owner-dashboard-sales-axis">
              <span>₱{Math.round((Math.max(...(stats?.dailySales.map((point) => point.total) ?? [0]), 0)) / 1000)}k</span>
              <span>₱0</span>
            </div>
            <div className="restaurant-owner-dashboard-sales-bars">
              {(stats?.dailySales ?? []).map((point) => {
                const max = Math.max(...(stats?.dailySales.map((item) => item.total) ?? [0]), 1);
                const height = point.total > 0 ? Math.max((point.total / max) * 100, 5) : 2;
                return (
                  <div className="restaurant-owner-dashboard-sales-column" key={point.label}>
                    <div className="restaurant-owner-dashboard-sales-value">{point.total > 0 ? `₱${point.total.toLocaleString('en-PH', { maximumFractionDigits: 0 })}` : '₱0'}</div>
                    <div className="restaurant-owner-dashboard-sales-track">
                      <div className="restaurant-owner-dashboard-sales-bar" style={{ height: `${height}%` }} />
                    </div>
                    <span>{point.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
