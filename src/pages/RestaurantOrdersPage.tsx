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
  const [orders, setOrders] = useState<RestaurantOrder[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [updating, setUpdating] = useState<string | null>(null); const [filter, setFilter] = useState<'active' | 'all'>('active'); const [openColumn, setOpenColumn] = useState<BoardColumn | null>(null); const [selectedOrder, setSelectedOrder] = useState<RestaurantOrder | null>(null); const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');

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
    try { setError(''); setUpdating(order.orderId); await updateOrderStatus(order.orderId, status); const updated = { ...order, status }; setOrders((current) => current.map((item) => item.orderId === order.orderId ? updated : item)); setSelectedOrder(updated); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update order.'); }
    finally { setUpdating(null); }
  }

  async function printAndSendToKitchen(order: RestaurantOrder) {
    if (!isPaymentReady(order)) { setError('This online order cannot be sent to the kitchen until the payment is completed.'); return; }
    try {
      setError('');
      setUpdating(order.orderId);
      setSelectedOrder(order);
      window.setTimeout(() => window.print(), 100);
      await updateOrderStatus(order.orderId, 'confirmed');
      const updated = { ...order, status: 'confirmed' as RestaurantOrderStatus };
      setOrders((current) => current.map((item) => item.orderId === order.orderId ? updated : item));
      setSelectedOrder(updated);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to send order to the kitchen.'); }
    finally { setUpdating(null); }
  }

  async function cancel(order: RestaurantOrder) {
    if (!window.confirm(`Cancel order ${order.orderNumber}?`)) return;
    try { setError(''); setUpdating(order.orderId); await updateOrderStatus(order.orderId, 'cancelled'); setOrders((current) => current.map((item) => item.orderId === order.orderId ? { ...item, status: 'cancelled' } : item)); setSelectedOrder(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update order.'); }
    finally { setUpdating(null); }
  }

  function printOrder(order: RestaurantOrder) { setSelectedOrder(order); window.setTimeout(() => window.print(), 100); }

  return (
    <section className="restaurant-orders-page">
      <style>{`\n        .restaurant-order-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px)}\n        .restaurant-order-modal{position:relative;width:min(560px,100%);max-height:min(88vh,760px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);padding:24px;color:#0f172a}\n        .restaurant-order-modal-close{position:absolute;right:14px;top:14px;width:38px;height:38px;border:0;border-radius:999px;background:#f1f5f9;font-size:22px;line-height:1;cursor:pointer}\n        .restaurant-order-modal-title{padding-right:48px;margin:0 0 5px;font-size:22px}\n        .restaurant-order-modal-subtitle{margin:0 0 18px;color:#64748b;font-size:14px}\n        .restaurant-order-modal-total{font-size:22px;font-weight:800}\n        .restaurant-order-modal-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}\n        @media(max-width:600px){.restaurant-order-modal-backdrop{padding:10px;align-items:flex-end}.restaurant-order-modal{max-height:92vh;border-radius:18px 18px 12px 12px;padding:20px}.restaurant-order-modal-actions .button{flex:1;min-width:130px}}\n        @media print{body *{visibility:hidden!important}.restaurant-order-modal-backdrop,.restaurant-order-modal-backdrop *{visibility:visible!important}.restaurant-order-modal-backdrop{position:static!important;padding:0!important;background:#fff!important;display:block!important}.restaurant-order-modal{width:100%!important;max-height:none!important;overflow:visible!important;box-shadow:none!important;border-radius:0!important;padding:20px!important}.restaurant-order-modal-close,.restaurant-order-modal-actions{display:none!important}}\n      `}</style>
      <div className="restaurant-orders-header"><div><p className="eyebrow">Restaurant operations</p><h1>Orders</h1><p>Track every order from payment confirmation to completion.</p></div><span className={`restaurant-dashboard-live-status is-${realtimeStatus}`} aria-live="polite"><span className="restaurant-dashboard-live-dot" aria-hidden="true" />{realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span></div>
      <div className="restaurant-orders-tabs" role="tablist" aria-label="Order filters"><button className={filter === 'active' ? 'is-active' : ''} type="button" onClick={() => setFilter('active')}>Active ({orders.filter((o) => !['completed', 'cancelled'].includes(o.status)).length})</button><button className={filter === 'all' ? 'is-active' : ''} type="button" onClick={() => setFilter('all')}>All ({orders.length})</button></div>
      {error && <div className="restaurant-orders-error" role="alert">{error}</div>}
      {loading ? <div className="restaurant-orders-empty">Loading orders…</div> : (
        <div className="restaurant-order-board">
          {columns.map((column) => {
            const columnOrders = visibleOrders.filter((order) => columnFor(order) === column.key);
            const isOpen = openColumn === column.key;
            return <section className={`restaurant-order-column is-${column.key} ${isOpen ? 'is-open' : ''}`} key={column.key} aria-label={column.title}>
              <button className="restaurant-order-column-header" type="button" aria-expanded={isOpen} onClick={() => { setOpenColumn(isOpen ? null : column.key); setSelectedOrder(null); }}>
                <div><h2>{column.title}</h2><p>{column.description}</p></div><span>{columnOrders.length}</span>
              </button>
              {isOpen && <div className="restaurant-order-column-list">
                {columnOrders.length === 0 ? <div className="restaurant-order-column-empty">No orders</div> : columnOrders.map((order) => <article className={`restaurant-order-card status-${order.status}`} key={order.orderId}><button className="restaurant-order-summary-button" type="button" aria-label={`View order ${order.orderNumber}`} onClick={() => setSelectedOrder(order)}><span className="restaurant-order-number">{order.orderNumber}</span><span className="restaurant-order-summary-right"><span className="restaurant-order-status">{statusLabels[order.status]}</span><strong>₱{order.total.toFixed(2)}</strong></span></button></article>)}
              </div>}
            </section>;
          })}
        </div>
      )}

      {selectedOrder && <div className="restaurant-order-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOrder(null); }}>
        <div className="restaurant-order-modal" role="dialog" aria-modal="true" aria-labelledby="restaurant-order-modal-title">
          <button className="restaurant-order-modal-close" type="button" aria-label="Close order details" onClick={() => setSelectedOrder(null)}>×</button>
          <h2 id="restaurant-order-modal-title" className="restaurant-order-modal-title">{selectedOrder.orderNumber}</h2>
          <p className="restaurant-order-modal-subtitle">{statusLabels[selectedOrder.status]} · {new Date(selectedOrder.createdAt).toLocaleString()}</p>
          <div className="restaurant-order-meta"><span>{selectedOrder.orderType === 'dine_in' ? 'Dine-in' : selectedOrder.orderType === 'pickup' ? 'Pickup / Take-out' : 'Delivery'}</span><span className={`restaurant-payment-status ${selectedOrder.paymentStatus === 'paid' ? 'is-paid' : selectedOrder.paymentStatus === 'failed' ? 'is-failed' : selectedOrder.paymentStatus === 'refunded' ? 'is-refunded' : 'is-pending'}`}>{paymentLabel(selectedOrder)}</span></div>
          <div className="restaurant-order-items" style={{ marginTop: 18 }}>{selectedOrder.items.map((item) => <div className="restaurant-order-item" key={item.id}><span><strong>{item.quantity}×</strong> {item.productName}</span><span>₱{item.lineTotal.toFixed(2)}</span></div>)}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e2e8f0', marginTop: 12, paddingTop: 14 }}><strong>Total</strong><strong className="restaurant-order-modal-total">₱{selectedOrder.total.toFixed(2)}</strong></div>
          {selectedOrder.status === 'pending' && !isPaymentReady(selectedOrder) && <p className="restaurant-order-payment-warning" style={{ marginTop: 16 }}>Online payment is required before this order can enter the kitchen.</p>}
          <div className="restaurant-order-modal-actions">
            {selectedOrder.status === 'pending' ? <button className="button button-primary" type="button" disabled={updating === selectedOrder.orderId || !isPaymentReady(selectedOrder)} onClick={() => void printAndSendToKitchen(selectedOrder)}>{updating === selectedOrder.orderId ? 'Printing & Sending…' : 'Print Order & Send to Kitchen'}</button> : nextStatus[selectedOrder.status] && <button className="button button-primary" type="button" disabled={updating === selectedOrder.orderId} onClick={() => void advance(selectedOrder)}>{updating === selectedOrder.orderId ? 'Updating…' : actionLabels[selectedOrder.status]}</button>}
            {selectedOrder.status !== 'completed' && selectedOrder.status !== 'cancelled' && <button className="button button-secondary" type="button" disabled={updating === selectedOrder.orderId} onClick={() => void cancel(selectedOrder)}>Cancel</button>}
            {selectedOrder.status !== 'pending' && <button className="button button-secondary restaurant-print-button" type="button" onClick={() => printOrder(selectedOrder)}>Print Order</button>}
          </div>
        </div>
      </div>}
    </section>
  );
}
