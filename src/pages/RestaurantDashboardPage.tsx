import { useEffect, useMemo, useState } from 'react';
import { getRestaurantOrders, type RestaurantOrder } from '../services/restaurantOrderRepository';
import { getRestaurantShippingFee } from '../services/restaurantSettingsRepository';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };

function isToday(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function RestaurantDashboardPage({ restaurantId }: Props) {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [shippingFee, setShippingFee] = useState(0);

  async function loadOrders() {
    try {
      setError('');
      setOrders(await getRestaurantOrders(restaurantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }

  async function loadShippingFee() {
    try {
      setShippingFee(await getRestaurantShippingFee(restaurantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load shipping fee.');
    }
  }

  useEffect(() => {
    void loadOrders();
    void loadShippingFee();

    const client = supabase;
    if (!client) {
      setRealtimeStatus('error');
      return;
    }

    const channel = client
      .channel(`restaurant-orders:${restaurantId}`)
      .on('broadcast', { event: 'restaurant_order_changed' }, () => {
        void loadOrders();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('error');
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [restaurantId]);

  const todayOrders = useMemo(() => orders.filter((order) => isToday(order.createdAt)), [orders]);
  const todaySales = useMemo(
    () => todayOrders.filter((order) => order.status === 'completed').reduce((sum, order) => sum + order.total, 0),
    [todayOrders],
  );

  return (
    <section className="restaurant-dashboard-page">
      <div className="restaurant-dashboard-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Dashboard</h1>
        </div>
        <span className={`restaurant-dashboard-live-status is-${realtimeStatus}`} aria-live="polite">
          <span className="restaurant-dashboard-live-dot" aria-hidden="true" />
          {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </div>

      {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}

      {loading ? (
        <div className="restaurant-dashboard-empty">Loading dashboard…</div>
      ) : (
        <div className="restaurant-dashboard-stats">
          <a className="restaurant-dashboard-stat" href="#restaurant/orders">
            <span>Orders</span>
            <small>Today's orders</small>
          </a>

          <a className="restaurant-dashboard-stat" href="#restaurant/menu">
            <span>Product</span>
            <small>Manage your menu</small>
          </a>

          <a className="restaurant-dashboard-stat restaurant-dashboard-stat-link" href="#restaurant/shipping-fee">
            <span>Shipping fee</span>
            <small>Manage your delivery fee</small>
          </a>

          <article className="restaurant-dashboard-stat">
            <span>Sales</span>
            <small>Completed sales today</small>
          </article>
        </div>
      )}
    </section>
  );
}
