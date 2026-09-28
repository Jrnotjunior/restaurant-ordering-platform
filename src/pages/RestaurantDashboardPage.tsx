import { useEffect, useMemo, useState } from 'react';
import { getRestaurantOrders, type RestaurantOrder } from '../services/restaurantOrderRepository';

type Props = { restaurantId: string };

function isToday(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function orderTypeLabel(type: RestaurantOrder['orderType']) {
  return type === 'dine_in' ? 'Dine-in' : type === 'pickup' ? 'Pickup / Take-out' : 'Delivery';
}

function statusLabel(status: RestaurantOrder['status']) {
  return status === 'pending' ? 'New Order'
    : status === 'confirmed' ? 'Confirmed'
      : status === 'preparing' ? 'Preparing'
        : status === 'ready' ? 'Ready'
          : status === 'completed' ? 'Completed'
            : 'Cancelled';
}

export function RestaurantDashboardPage({ restaurantId }: Props) {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    const timer = window.setInterval(() => void loadOrders(), 10000);
    return () => window.clearInterval(timer);
  }, [restaurantId]);

  const todayOrders = useMemo(() => orders.filter((order) => isToday(order.createdAt)), [orders]);
  const activeOrders = useMemo(() => orders.filter((order) => !['completed', 'cancelled'].includes(order.status)), [orders]);
  const pendingPayment = useMemo(() => orders.filter((order) => order.paymentStatus === 'pending'), [orders]);
  const completedToday = useMemo(() => todayOrders.filter((order) => order.status === 'completed'), [todayOrders]);
  const todaySales = useMemo(() => completedToday.reduce((sum, order) => sum + order.total, 0), [completedToday]);
  const recentOrders = useMemo(() => orders.slice(0, 5), [orders]);

  return (
    <section className="restaurant-dashboard-page">
      <div className="restaurant-dashboard-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Dashboard</h1>
          <p>See what is happening with your restaurant at a glance.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void loadOrders()}>Refresh</button>
      </div>

      <nav className="restaurant-dashboard-nav" aria-label="Restaurant navigation">
        <a className="is-active" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/dashboard`}>Dashboard</a>
        <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/orders`}>Orders</a>
      </nav>

      {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}

      {loading ? <div className="restaurant-dashboard-empty">Loading dashboard…</div> : (
        <>
          <div className="restaurant-dashboard-stats">
            <article className="restaurant-dashboard-stat">
              <span>Today's sales</span>
              <strong>₱{todaySales.toFixed(2)}</strong>
              <small>{completedToday.length} completed today</small>
            </article>
            <article className="restaurant-dashboard-stat">
              <span>Active orders</span>
              <strong>{activeOrders.length}</strong>
              <small>Orders still in progress</small>
            </article>
            <article className="restaurant-dashboard-stat">
              <span>Awaiting payment</span>
              <strong>{pendingPayment.length}</strong>
              <small>Payment needs attention</small>
            </article>
            <article className="restaurant-dashboard-stat">
              <span>Today's orders</span>
              <strong>{todayOrders.length}</strong>
              <small>All order types</small>
            </article>
          </div>

          <div className="restaurant-dashboard-sections">
            <section className="restaurant-dashboard-panel">
              <div className="restaurant-dashboard-panel-header">
                <div>
                  <p className="eyebrow">Incoming</p>
                  <h2>Recent orders</h2>
                </div>
                <a className="text-link" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/orders`}>View all</a>
              </div>

              {recentOrders.length === 0 ? <p className="restaurant-dashboard-muted">No orders yet.</p> : (
                <div className="restaurant-dashboard-order-list">
                  {recentOrders.map((order) => (
                    <article className="restaurant-dashboard-order" key={order.orderId}>
                      <div>
                        <strong>{order.orderNumber}</strong>
                        <span>{orderTypeLabel(order.orderType)} · {statusLabel(order.status)}</span>
                      </div>
                      <strong>₱{order.total.toFixed(2)}</strong>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="restaurant-dashboard-panel">
              <div className="restaurant-dashboard-panel-header">
                <div>
                  <p className="eyebrow">Quick actions</p>
                  <h2>Restaurant operations</h2>
                </div>
              </div>
              <div className="restaurant-dashboard-actions">
                <a className="button button-primary" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#restaurant/orders`}>Manage Orders</a>
                <a className="button button-secondary" href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/#menu`}>View Customer Menu</a>
              </div>
              <div className="restaurant-dashboard-note">
                <strong>Payment protection</strong>
                <p>Keep orders awaiting online payment out of the kitchen until payment is confirmed.</p>
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
