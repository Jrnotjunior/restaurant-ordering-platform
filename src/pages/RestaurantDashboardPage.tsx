import { useEffect, useMemo, useState } from 'react';
import { getRestaurantOrders, type RestaurantOrder } from '../services/restaurantOrderRepository';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };

function isToday(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function orderTypeLabel(type: RestaurantOrder['orderType']) {
  return type === 'dine_in' ? 'Dine-in' : type === 'pickup' ? 'Pickup / Take-out' : 'Delivery';
}

function statusLabel(status: RestaurantOrder['status']) {
  return status === 'pending' ? 'New Order' : status === 'confirmed' ? 'Confirmed' : status === 'preparing' ? 'Preparing' : status === 'ready' ? 'Ready' : status === 'completed' ? 'Completed' : 'Cancelled';
}

export function RestaurantDashboardPage({ restaurantId }: Props) {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');

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

  useEffect(() => {
    void loadOrders();
    const client = supabase;
    if (!client) {
      setRealtimeStatus('error');
      return;
    }
    const channel = client.channel(`restaurant-dashboard:${restaurantId}`).on('broadcast', { event: 'restaurant_order_changed' }, () => { void loadOrders(); }).subscribe((status) => {
      if (status === 'SUBSCRIBED') setRealtimeStatus('live');
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('error');
    });
    return () => { void client.removeChannel(channel); };
  }, [restaurantId]);

  const todayOrders = useMemo(() => orders.filter((order) => isToday(order.createdAt)), [orders]);
  const activeOrders = useMemo(() => orders.filter((order) => !['completed', 'cancelled'].includes(order.status)), [orders]);
  const pendingPayment = useMemo(() => orders.filter((order) => order.paymentStatus === 'pending'), [orders]);
  const completedToday = useMemo(() => todayOrders.filter((order) => order.status === 'completed'), [todayOrders]);
  const todaySales = useMemo(() => completedToday.reduce((sum, order) => sum + order.total, 0), [completedToday]);
  const recentOrders = useMemo(() => orders.slice(0, 6), [orders]);
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  return (
    <section className="restaurant-dashboard-shell">
      <aside className="restaurant-dashboard-sidebar">
        <div className="restaurant-dashboard-brand">
          <span className="restaurant-dashboard-brand-mark" aria-hidden="true">R</span>
          <div><strong>Restaurant</strong><span>Operations</span></div>
        </div>
        <nav aria-label="Restaurant navigation" className="restaurant-dashboard-sidebar-nav">
          <a className="is-active" href={`${base}/#restaurant/dashboard`}><span aria-hidden="true">⌂</span>Dashboard</a>
          <a href={`${base}/#restaurant/orders`}><span aria-hidden="true">▤</span>Orders</a>
          <a href={`${base}/#restaurant/menu`}><span aria-hidden="true">☷</span>Menu</a>
        </nav>
        <div className="restaurant-dashboard-sidebar-footer">
          <span className="restaurant-dashboard-live-dot" aria-hidden="true" />
          <span>{realtimeStatus === 'live' ? 'System live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
        </div>
      </aside>

      <div className="restaurant-dashboard-main">
        <header className="restaurant-dashboard-topbar">
          <div>
            <p className="eyebrow">Restaurant operations</p>
            <h1>Dashboard</h1>
          </div>
          <a className="restaurant-dashboard-view-store" href={`${base}/#menu`}>View customer menu ↗</a>
        </header>

        {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}

        {loading ? <div className="restaurant-dashboard-empty">Loading dashboard…</div> : <>
          <div className="restaurant-dashboard-stats">
            <article className="restaurant-dashboard-stat"><span>Today's sales</span><strong>₱{todaySales.toFixed(2)}</strong><small>{completedToday.length} completed today</small></article>
            <article className="restaurant-dashboard-stat"><span>Active orders</span><strong>{activeOrders.length}</strong><small>Currently in progress</small></article>
            <article className="restaurant-dashboard-stat"><span>Awaiting payment</span><strong>{pendingPayment.length}</strong><small>Needs attention</small></article>
            <article className="restaurant-dashboard-stat"><span>Today's orders</span><strong>{todayOrders.length}</strong><small>All order types</small></article>
          </div>

          <div className="restaurant-dashboard-grid">
            <section className="restaurant-dashboard-panel restaurant-dashboard-panel-orders">
              <div className="restaurant-dashboard-panel-header"><div><p className="eyebrow">Live activity</p><h2>Recent orders</h2></div><a className="text-link" href={`${base}/#restaurant/orders`}>View all</a></div>
              {recentOrders.length === 0 ? <p className="restaurant-dashboard-muted">No orders yet.</p> : <div className="restaurant-dashboard-order-list">{recentOrders.map((order) => <a className="restaurant-dashboard-order" href={`${base}/#restaurant/orders`} key={order.orderId}><div className="restaurant-dashboard-order-info"><strong>{order.orderNumber}</strong><span>{orderTypeLabel(order.orderType)} · {order.items.length} item{order.items.length === 1 ? '' : 's'}</span></div><div className="restaurant-dashboard-order-meta"><strong>₱{order.total.toFixed(2)}</strong><span className={`restaurant-dashboard-status status-${order.status}`}>{statusLabel(order.status)}</span></div></a>)}</div>}
            </section>

            <div className="restaurant-dashboard-side-panels">
              <section className="restaurant-dashboard-panel">
                <div className="restaurant-dashboard-panel-header"><div><p className="eyebrow">Quick actions</p><h2>Manage</h2></div></div>
                <div className="restaurant-dashboard-actions"><a className="button button-primary" href={`${base}/#restaurant/orders`}>Manage Orders</a><a className="button button-secondary" href={`${base}/#restaurant/menu`}>Manage Menu</a></div>
              </section>
              <section className="restaurant-dashboard-panel restaurant-dashboard-note"><div className="restaurant-dashboard-panel-header"><div><p className="eyebrow">Payment protection</p><h2>Keep the kitchen safe</h2></div></div><p>Online orders stay out of the kitchen until payment is confirmed. Cash orders can be reviewed before acceptance.</p></section>
            </div>
          </div>
        </>}
      </div>

      <nav className="restaurant-dashboard-mobile-nav" aria-label="Restaurant navigation">
        <a className="is-active" href={`${base}/#restaurant/dashboard`}><span aria-hidden="true">⌂</span>Dashboard</a>
        <a href={`${base}/#restaurant/orders`}><span aria-hidden="true">▤</span>Orders</a>
        <a href={`${base}/#restaurant/menu`}><span aria-hidden="true">☷</span>Menu</a>
      </nav>
    </section>
  );
}
