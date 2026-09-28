import { useEffect, useMemo, useState } from 'react';
import {
  getRestaurantOrders,
  updateOrderStatus,
  type RestaurantOrder,
  type RestaurantOrderStatus,
} from '../services/restaurantOrderRepository';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };

const statusLabels: Record<RestaurantOrderStatus, string> = {
  pending: 'New Order',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const actionLabels: Partial<Record<RestaurantOrderStatus, string>> = {
  pending: 'Confirm Order',
  confirmed: 'Start Preparing',
  preparing: 'Mark Ready',
  ready: 'Complete Order',
};

const nextStatus: Partial<Record<RestaurantOrderStatus, RestaurantOrderStatus>> = {
  pending: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'completed',
};

const workflowSteps: RestaurantOrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];

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

function isPaymentReady(order: RestaurantOrder) {
  // Cash orders may be confirmed by the restaurant. Online orders must be paid first.
  return order.paymentMethod !== 'gcash' || order.paymentStatus === 'paid';
}

function workflowIndex(status: RestaurantOrderStatus) {
  return workflowSteps.indexOf(status);
}

export function RestaurantOrdersPage({ restaurantId }: Props) {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');

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

    const client = supabase;
    if (!client) {
      setRealtimeStatus('error');
      return;
    }

    const channel = client
      .channel(`restaurant-orders-page:${restaurantId}`)
      .on(
        'broadcast',
        { event: 'restaurant_order_changed' },
        () => {
          void loadOrders();
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('live');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus('error');
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
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

    if (order.status === 'pending' && !isPaymentReady(order)) {
      setError('This online order cannot be confirmed until the payment is completed.');
      return;
    }

    try {
      setError('');
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
      setError('');
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
        <span className={`restaurant-dashboard-live-status is-${realtimeStatus}`} aria-live="polite">
          <span className="restaurant-dashboard-live-dot" aria-hidden="true" />
          {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
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
            const paymentReady = isPaymentReady(order);
            const actionBlocked = order.status === 'pending' && !paymentReady;
            const currentStep = workflowIndex(order.status);

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

                {order.status !== 'cancelled' && (
                  <div className="restaurant-order-workflow" aria-label={`Order status: ${statusLabels[order.status]}`}>
                    {workflowSteps.map((step, index) => (
                      <span key={step} className={index <= currentStep ? 'is-complete' : ''}>
                        {statusLabels[step]}
                      </span>
                    ))}
                  </div>
                )}

                <div className="restaurant-order-items">
                  {order.items.map((item) => (
                    <div className="restaurant-order-item" key={item.id}>
                      <span><strong>{item.quantity}×</strong> {item.productName}</span>
                      <span>₱{item.lineTotal.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {actionBlocked && (
                  <p className="restaurant-order-payment-warning">
                    Online payment is required before this order can be confirmed and sent to the kitchen.
                  </p>
                )}

                <div className="restaurant-order-actions">
                  {next && (
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={updating === order.orderId || actionBlocked}
                      onClick={() => void advance(order)}
                    >
                      {updating === order.orderId ? 'Updating…' : actionLabels[order.status]}
                    </button>
                  )}
                  {order.status !== 'completed' && order.status !== 'cancelled' && (
                    <button className="button button-secondary" type="button" disabled={updating === order.orderId} onClick={() => void cancel(order)}>
                      Cancel
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
