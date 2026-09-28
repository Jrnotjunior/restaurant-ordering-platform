import { useEffect, useMemo, useState } from 'react';
import {
  getRestaurantOrders,
  updateOrderStatus,
  type RestaurantOrder,
  type RestaurantOrderStatus,
} from '../services/restaurantOrderRepository';

type Props = { restaurantId: string };

const statusLabels: Record<RestaurantOrderStatus, string> = {
  pending: 'New Order',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const nextStatus: Partial<Record<RestaurantOrderStatus, RestaurantOrderStatus>> = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};

function paymentLabel(order: RestaurantOrder) {
  if (order.paymentMethod === 'gcash') {
    if (order.paymentStatus === 'paid') return 'GCash • Paid';
    if (order.paymentStatus === 'failed') return 'GCash • Failed';
    if (order.paymentStatus === 'refunded') return 'GCash • Refunded';
    return 'GCash • Awaiting payment';
  }

  if (order.paymentStatus === 'paid') return 'Cash • Paid';
  if (order.paymentStatus === 'failed') return 'Cash • Failed';
  if (order.paymentStatus === 'refunded') return 'Cash • Refunded';
  return 'Cash • Unpaid';
}

export function RestaurantOrdersPage({ restaurantId }: Props) {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');

  async function loadOrders() {
    try {
      setError('');
      const data = await getRestaurantOrders(restaurantId);
      setOrders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load orders.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders();
    const timer = window.setInterval(() => void loadOrders(), 10000);
    return () => window.clearInterval(timer);
  }, [restaurantId]);

  const visibleOrders = useMemo(
    () => filter === 'active'
      ? orders.filter((order) => !['completed', 'cancelled'].includes(order.status))
      : orders,
    [orders, filter],
  );

  async function advance(order: RestaurantOrder) {
    const status = nextStatus[order.status];
    if (!status) return;
    try {
      setUpdating(order.orderId);
      await updateOrderStatus(order.orderId, status);
      setOrders((current) => current.map((item) => item.orderId === order.orderId ? { ...item, status } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update order.');
    } finally {
      setUpdating(null);
    }
  }

  async function cancel(order: RestaurantOrder) {
    if (!window.confirm(`Cancel order ${order.orderNumber}?`)) return;
    try {
      setUpdating(order.orderId);
      await updateOrderStatus(order.orderId, 'cancelled');
      setOrders((current) => current.map((item) => item.orderId === order.orderId ? { ...item, status: 'cancelled' } : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel order.');
    } finally {
      setUpdating(null);
    }
  }

  return (
    <section className="restaurant-orders-page">
      <div className="restaurant-orders-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Orders</h1>
          <p>Manage incoming orders and move them through the kitchen workflow.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void loadOrders()}>Refresh</button>
      </div>

      <div className="restaurant-orders-tabs" role="tablist" aria-label="Order filters">
        <button className={filter === 'active' ? 'is-active' : ''} type="button" onClick={() => setFilter('active')}>Active ({orders.filter((o) => !['completed', 'cancelled'].includes(o.status)).length})</button>
        <button className={filter === 'all' ? 'is-active' : ''} type="button" onClick={() => setFilter('all')}>All ({orders.length})</button>
      </div>

      {error && <div className="restaurant-orders-error" role="alert">{error}</div>}
      {loading ? <div className="restaurant-orders-empty">Loading orders…</div> : visibleOrders.length === 0 ? <div className="restaurant-orders-empty"><h2>No orders yet</h2><p>New customer orders will appear here automatically.</p></div> : (
        <div className="restaurant-order-list">
          {visibleOrders.map((order) => {
            const next = nextStatus[order.status];
            const paymentClass = order.paymentStatus === 'paid' ? 'is-paid' : order.paymentStatus === 'failed' ? 'is-failed' : order.paymentStatus === 'refunded' ? 'is-refunded' : 'is-pending';
            return (
              <article className={`restaurant-order-card status-${order.status}`} key={order.orderId}>
                <div className="restaurant-order-top">
                  <div>
                    <span className="restaurant-order-number">{order.orderNumber}</span>
                    <span className="restaurant-order-status">{statusLabels[order.status]}</span>
                  </div>
                  <strong>₱{order.total.toFixed(2)}</strong>
                </div>

                <div className="restaurant-order-meta">
                  <span>{order.orderType === 'dine_in' ? 'Dine-in' : order.orderType === 'pickup' ? 'Pickup / Take-out' : 'Delivery'}</span>
                  <span className={`restaurant-payment-status ${paymentClass}`}>{paymentLabel(order)}</span>
                  <span>{new Date(order.createdAt).toLocaleString()}</span>
                </div>

                <div className="restaurant-order-items">
                  {order.items.map((item) => (
                    <div className="restaurant-order-item" key={item.id}>
                      <span><strong>{item.quantity}×</strong> {item.productName}</span>
                      <span>₱{item.lineTotal.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <div className="restaurant-order-actions">
                  {next && <button className="button button-primary" type="button" disabled={updating === order.orderId} onClick={() => void advance(order)}>{updating === order.orderId ? 'Updating…' : `Mark ${statusLabels[next]}`}</button>}
                  {order.status !== 'completed' && order.status !== 'cancelled' && <button className="button button-secondary" type="button" disabled={updating === order.orderId} onClick={() => void cancel(order)}>Cancel</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
