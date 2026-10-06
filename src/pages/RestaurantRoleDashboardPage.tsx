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



type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday';

type DayHours = {
  isOpen: boolean;
  open: string;
  close: string;
};

type OperatingHours = Record<DayKey, DayHours>;

const DAY_KEYS: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function getManilaDateParts(dateString: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(dateString));

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');
  const minute = get('minute');
  const date = new Date(Date.UTC(year, month - 1, day));
  return { year, month, day, hour, minute, weekday: DAY_KEYS[date.getUTCDay()], date };
}

function formatBusinessDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getBusinessDateKey(dateString: string, operatingHours: OperatingHours): string {
  const current = getManilaDateParts(dateString);
  const currentHours = operatingHours[current.weekday];
  const nowMinutes = current.hour * 60 + current.minute;

  if (currentHours?.isOpen) {
    const [openHour, openMinute] = currentHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = currentHours.close.split(':').map(Number);
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;

    if (
      openMinutes === closeMinutes ||
      (closeMinutes > openMinutes && nowMinutes >= openMinutes && nowMinutes < closeMinutes) ||
      (closeMinutes < openMinutes && nowMinutes >= openMinutes)
    ) {
      return formatBusinessDate(current.date);
    }
  }

  const previousDate = new Date(current.date);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  const previousHours = operatingHours[DAY_KEYS[previousDate.getUTCDay()]];

  if (previousHours?.isOpen) {
    const [openHour, openMinute] = previousHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = previousHours.close.split(':').map(Number);
    const openMinutes = openHour * 60 + openMinute;
    const closeMinutes = closeHour * 60 + closeMinute;

    if (closeMinutes < openMinutes && nowMinutes < closeMinutes) {
      return formatBusinessDate(previousDate);
    }
  }

  return formatBusinessDate(current.date);
}

async function loadOwnerStats(restaurantId: string): Promise<OwnerStats> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select('operating_hours')
    .eq('id', restaurantId)
    .single();

  if (restaurantError) throw restaurantError;

  const operatingHours = (restaurant?.operating_hours ?? {}) as OperatingHours;
  const nowParts = getManilaDateParts(new Date().toISOString());
  const currentBusinessDate = getBusinessDateKey(new Date().toISOString(), operatingHours);
  const currentDate = nowParts.date;
  const chartStart = new Date(currentDate);
  chartStart.setUTCDate(chartStart.getUTCDate() - 6);
  const queryStart = new Date(chartStart);
  queryStart.setUTCDate(queryStart.getUTCDate() - 1);
  const queryEnd = new Date(currentDate);
  queryEnd.setUTCDate(queryEnd.getUTCDate() + 2);

  const start = queryStart.toISOString();
  const end = queryEnd.toISOString();

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
  const businessDateForOrder = (order: typeof orderRows[number]) =>
    getBusinessDateKey(order.created_at, operatingHours);

  const todayOrders = orderRows.filter((order) => businessDateForOrder(order) === currentBusinessDate);
  const sales = todayOrders.reduce(
    (sum, order) => completedStatuses.has(order.status) ? sum + Number(order.total ?? 0) : sum,
    0,
  );

  const pendingStatuses = new Set(['new', 'confirmed', 'preparing', 'ready']);
  const pendingOrders = todayOrders.filter((order) => pendingStatuses.has(order.status)).length;
  const activeDeliveries = todayOrders.filter(
    (order) => order.order_type === 'delivery' && ['assigned', 'picked_up', 'out_for_delivery'].includes(order.delivery_status ?? ''),
  ).length;

  const dailySales = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(chartStart);
    date.setUTCDate(chartStart.getUTCDate() + index);
    const key = formatBusinessDate(date);
    const total = orderRows.reduce((sum, order) => {
      return businessDateForOrder(order) === key && completedStatuses.has(order.status)
        ? sum + Number(order.total ?? 0)
        : sum;
    }, 0);

    return {
      label: new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila',
        weekday: 'short',
      }).format(date),
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
