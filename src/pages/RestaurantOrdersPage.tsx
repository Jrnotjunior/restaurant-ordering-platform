import { useEffect, useMemo, useState } from 'react';
import {
  getRestaurantOrders,
  updateOrderStatus,
  type RestaurantOrder,
  type RestaurantOrderStatus,
} from '../services/restaurantOrderRepository';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };
type BoardColumn = 'new' | 'kitchen' | 'ready' | 'completed';

const statusLabels: Record<RestaurantOrderStatus, string> = {
  pending: 'New Order', confirmed: 'In the Kitchen', preparing: 'In the Kitchen', ready: 'Ready', completed: 'Completed', cancelled: 'Cancelled',
};
const actionLabels: Partial<Record<RestaurantOrderStatus, string>> = { pending: 'Send to Kitchen', confirmed: 'Start Preparing', preparing: 'Mark Ready', ready: 'Complete Order' };
const nextStatus: Partial<Record<RestaurantOrderStatus, RestaurantOrderStatus>> = { pending: 'confirmed', confirmed: 'preparing', preparing: 'ready', ready: 'completed' };

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
function isPaymentReady(order: RestaurantOrder) { return order.paymentMethod !== 'gcash' || order.paymentStatus === 'paid'; }
function columnFor(order: RestaurantOrder): BoardColumn { if (order.status === 'pending') return 'new'; if (order.status === 'confirmed' || order.status === 'preparing') return 'kitchen'; if (order.status === 'ready') return 'ready'; return 'completed'; }

const columns: Array<{ key: BoardColumn; title: string; description: string }> = [
  { key: 'new', title: 'New Orders', description: 'Waiting for payment confirmation' },
  { key: 'kitchen', title: 'In the Kitchen', description: 'Orders being prepared' },
  { key: 'ready', title: 'Ready', description: 'Ready for pickup, dine-in, or delivery' },
  { key: 'completed', title: 'Completed', description: 'Finished orders' },
];

export function RestaurantOrdersPage({ restaurantId }: Props) {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [updating, setUpdating] = useState<string | null>(null); const [filter, setFilter] = useState<'active' | 'all'>('active'); const [openColumn, setOpenColumn] = useState<BoardColumn | null>(null); const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');

  async function loadOrders() {
    try {
      setError('');
      const data = await getRestaurantOrders(restaurantId);
      setOrders(data);
      const paidNewOrders = data.filter((order) => order.status === 'pending' && order.paymentMethod === 'gcash' && order.paymentStatus === 'paid');
      if (paidNewOrders.length) {
        await Promise.all(paidNewOrders.map((order) => updateOrderStatus(order.orderId, 'confirmed')));
        setOrders((current) => current.map((order) => paidNewOrders.some((paid) => paid.orderId === order.orderId) ? { ...order, status: 'confirmed' } : order));
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load orders.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void loadOrders();
    const client = supabase; if (!client) { setRealtimeStatus('error'); return; }
    const channel = client.channel(`restaurant-orders-page:${restaurantId}`).on('broadcast', { event: 'restaurant_order_changed' }, () => { void loadOrders(); }).subscribe((status) => { if (status === 'SUBSCRIBED') setRealtimeStatus('live'); else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('error'); });
    return () => { void client.removeChannel(channel); };
  }, [restaurantId]);

  const visibleOrders = useMemo(() => filter === 'active' ? orders.filter((order) => !['completed', 'cancelled'].includes(order.status)) : orders, [orders, filter]);

  async function advance(order: RestaurantOrder) {
    const status = nextStatus[order.status]; if (!status) return;
    if (order.status === 'pending' && !isPaymentReady(order)) { setError('This online order cannot be sent to the kitchen until the payment is completed.'); return; }
    try { setError(''); setUpdating(order.orderId); await updateOrderStatus(order.orderId, status); setOrders((current) => current.map((item) => item.orderId === order.orderId ? { ...item, status } : item)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update order.'); }
    finally { setUpdating(null); }
  }

  async function cancel(order: RestaurantOrder) {
    if (!window.confirm(`Cancel order ${order.orderNumber}?`)) return;
    try { setError(''); setUpdating(order.orderId); await updateOrderStatus(order.orderId, 'cancelled'); setOrders((current) => current.map((item) => item.orderId === order.orderId ? { ...item, status: 'cancelled' } : item)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update order.'); }
    finally { setUpdating(null); }
  }

  return (
    <section className="restaurant-orders-page">
      <div className="restaurant-orders-header"><div><p className="eyebrow">Restaurant operations</p><h1>Orders</h1><p>Track every order from payment confirmation to completion.</p></div><span className={`restaurant-dashboard-live-status is-${realtimeStatus}`} aria-live="polite"><span className="restaurant-dashboard-live-dot" aria-hidden="true" />{realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span></div>
      <div className="restaurant-orders-tabs" role="tablist" aria-label="Order filters"><button className={filter === 'active' ? 'is-active' : ''} type="button" onClick={() => setFilter('active')}>Active ({orders.filter((o) => !['completed', 'cancelled'].includes(o.status)).length})</button><button className={filter === 'all' ? 'is-active' : ''} type="button" onClick={() => setFilter('all')}>All ({orders.length})</button></div>
      {error && <div className="restaurant-orders-error" role="alert">{error}</div>}
      {loading ? <div className="restaurant-orders-empty">Loading orders…</div> : (
        <div className="restaurant-order-board">
          {columns.map((column) => {
            const columnOrders = visibleOrders.filter((order) => columnFor(order) === column.key);
            const isOpen = openColumn === column.key;
            return <section className={`restaurant-order-column is-${column.key} ${isOpen ? 'is-open' : ''}`} key={column.key} aria-label={column.title}>
              <button className="restaurant-order-column-header" type="button" aria-expanded={isOpen} onClick={() => setOpenColumn(isOpen ? null : column.key)}>
                <div><h2>{column.title}</h2><p>{column.description}</p></div><span>{columnOrders.length}</span>
              </button>
              {isOpen && <div className="restaurant-order-column-list">
                {columnOrders.length === 0 ? <div className="restaurant-order-column-empty">No orders</div> : columnOrders.map((order) => {
                  const next = nextStatus[order.status]; const paymentClass = order.paymentStatus === 'paid' ? 'is-paid' : order.paymentStatus === 'failed' ? 'is-failed' : order.paymentStatus === 'refunded' ? 'is-refunded' : 'is-pending'; const paymentReady = isPaymentReady(order); const actionBlocked = order.status === 'pending' && !paymentReady;
                  return <article className={`restaurant-order-card status-${order.status}`} key={order.orderId}>
                    <div className="restaurant-order-top"><div><span className="restaurant-order-number">{order.orderNumber}</span><span className="restaurant-order-status">{statusLabels[order.status]}</span></div><strong>₱{order.total.toFixed(2)}</strong></div>
                    <div className="restaurant-order-meta"><span>{order.orderType === 'dine_in' ? 'Dine-in' : order.orderType === 'pickup' ? 'Pickup / Take-out' : 'Delivery'}</span><span className={`restaurant-payment-status ${paymentClass}`}>{paymentLabel(order)}</span><span>{new Date(order.createdAt).toLocaleString()}</span></div>
                    <div className="restaurant-order-items">{order.items.map((item) => <div className="restaurant-order-item" key={item.id}><span><strong>{item.quantity}×</strong> {item.productName}</span><span>₱{item.lineTotal.toFixed(2)}</span></div>)}</div>
                    {actionBlocked && <p className="restaurant-order-payment-warning">Online payment is required before this order can enter the kitchen.</p>}
                    <div className="restaurant-order-actions">{next && <button className="button button-primary" type="button" disabled={updating === order.orderId || actionBlocked} onClick={() => void advance(order)}>{updating === order.orderId ? 'Updating…' : actionLabels[order.status]}</button>}{order.status !== 'completed' && order.status !== 'cancelled' && <button className="button button-secondary" type="button" disabled={updating === order.orderId} onClick={() => void cancel(order)}>Cancel</button>}</div>
                  </article>;
                })}
              </div>}
            </section>;
          })}
        </div>
      )}
    </section>
  );
}
