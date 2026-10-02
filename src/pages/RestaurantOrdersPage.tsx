import { useEffect, useMemo, useState } from 'react';
import { confirmDineInPayment, getRestaurantOrders, updateOrderStatus, type RestaurantOrder, type RestaurantOrderStatus } from '../services/restaurantOrderRepository';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };
type BoardColumn = 'new' | 'kitchen' | 'ready' | 'completed';

const statusLabels: Record<RestaurantOrderStatus, string> = {
  pending: 'New Order',
  confirmed: 'In the Kitchen',
  preparing: 'In the Kitchen',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const actionLabels: Partial<Record<RestaurantOrderStatus, string>> = {
  confirmed: 'Mark Ready',
  preparing: 'Mark Ready',
  ready: 'Complete Order',
};

const nextStatus: Partial<Record<RestaurantOrderStatus, RestaurantOrderStatus>> = {
  confirmed: 'ready',
  preparing: 'ready',
  ready: 'completed',
};

function paymentLabel(order: RestaurantOrder) {
  if (order.paymentMethod === 'gcash') {
    if (order.paymentStatus === 'paid') return 'Online Payment • Paid';
    if (order.paymentStatus === 'failed') return 'Online Payment • Failed';
    if (order.paymentStatus === 'refunded') return 'Online Payment • Refunded';
    return 'Online Payment • Awaiting payment';
  }
  if (order.paymentStatus === 'paid') return 'Cash • Paid';
  if (order.paymentStatus === 'failed') return 'Cash • Failed';
  if (order.paymentStatus === 'refunded') return 'Cash • Refunded';
  return 'Cash • Unpaid';
}

function isPaymentReady(order: RestaurantOrder) {
  if (order.orderType === 'dine_in' && order.paymentMethod === 'cash') return order.paymentStatus === 'paid';
  return order.paymentMethod !== 'gcash' || order.paymentStatus === 'paid';
}

function columnFor(order: RestaurantOrder): BoardColumn | null {
  if (order.status === 'pending') return 'new';
  if (order.status === 'confirmed' || order.status === 'preparing') return 'kitchen';
  // Delivery orders leave the restaurant Orders board once they are ready.
  // They are handled in Delivery Dispatch instead.
  if (order.status === 'ready' && order.orderType !== 'delivery') return 'ready';
  if (order.status === 'completed') return 'completed';
  return null;
}

const columns: Array<{ key: BoardColumn; title: string; description: string }> = [
  { key: 'new', title: 'New Orders', description: 'Waiting for payment confirmation' },
  { key: 'kitchen', title: 'In the Kitchen', description: 'Orders being prepared' },
  { key: 'ready', title: 'Ready', description: 'Ready for pickup or dine-in' },
  { key: 'completed', title: 'Completed', description: 'Finished orders' },
];

export function RestaurantOrdersPage({ restaurantId }: Props) {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [openColumn, setOpenColumn] = useState<BoardColumn | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<RestaurantOrder | null>(null);
  const [cancelConfirmationOrder, setCancelConfirmationOrder] = useState<RestaurantOrder | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [searchQuery, setSearchQuery] = useState('');

  async function loadOrders() {
    try {
      setError('');
      const data = await getRestaurantOrders(restaurantId);
      setOrders(data);

      const paidNewOrders = data.filter(
        (o) => o.status === 'pending' && o.paymentMethod === 'gcash' && o.paymentStatus === 'paid',
      );

      if (paidNewOrders.length) {
        await Promise.all(paidNewOrders.map((o) => updateOrderStatus(o.orderId, 'confirmed')));
        setOrders((current) =>
          current.map((o) =>
            paidNewOrders.some((p) => p.orderId === o.orderId) ? { ...o, status: 'confirmed' } : o,
          ),
        );
      }
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
      .on('broadcast', { event: 'restaurant_order_changed' }, () => {
        void loadOrders();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus('error');
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [restaurantId]);

  const activeOrders = useMemo(
    () => orders.filter((o) => !['completed', 'cancelled'].includes(o.status)),
    [orders],
  );
  const boardOrders = filter === 'active' ? activeOrders : orders;
  const openedColumn = columns.find((column) => column.key === openColumn) ?? null;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchedOrders = openedColumn?.key === 'new' && normalizedSearch
    ? boardOrders.filter((order) =>
        order.orderNumber.toLowerCase().includes(normalizedSearch) ||
        order.customerName.toLowerCase().includes(normalizedSearch),
      )
    : boardOrders;

  const openedColumnOrders = openedColumn
    ? searchedOrders.filter((order) => columnFor(order) === openedColumn.key)
    : [];

  async function advance(order: RestaurantOrder) {
    const status = nextStatus[order.status];
    if (!status) return;

    try {
      setError('');
      setUpdating(order.orderId);
      await updateOrderStatus(order.orderId, status);
      const updated = { ...order, status };
      setOrders((current) => current.map((item) => (item.orderId === order.orderId ? updated : item)));
      closeOrderList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update order.');
    } finally {
      setUpdating(null);
    }
  }

  async function confirmDineInCashPayment(order: RestaurantOrder) {
    try {
      setError(''); setUpdating(order.orderId);
      await confirmDineInPayment(order.orderId);
      setOrders((current) => current.map((item) => item.orderId === order.orderId ? { ...item, paymentStatus: 'paid', status: 'confirmed' } : item));
      setSelectedOrder(null); setOpenColumn(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to confirm dine-in payment.');
    } finally { setUpdating(null); }
  }

  async function printAndSendToKitchen(order: RestaurantOrder) {
    if (!isPaymentReady(order)) {
      setError('This online order cannot be sent to the kitchen until the payment is completed.');
      return;
    }

    try {
      setError('');
      setUpdating(order.orderId);
      window.print();
      await updateOrderStatus(order.orderId, 'confirmed');
      const updated = { ...order, status: 'confirmed' as RestaurantOrderStatus };
      setOrders((current) => current.map((item) => (item.orderId === order.orderId ? updated : item)));
      closeOrderList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to send order to the kitchen.');
    } finally {
      setUpdating(null);
    }
  }

  async function cancel(order: RestaurantOrder) {
    try {
      setError('');
      setUpdating(order.orderId);
      await updateOrderStatus(order.orderId, 'cancelled');
      setOrders((current) =>
        current.map((item) => (item.orderId === order.orderId ? { ...item, status: 'cancelled' } : item)),
      );
      setCancelConfirmationOrder(null);
      setSelectedOrder(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update order.');
    } finally {
      setUpdating(null);
    }
  }

  function closeOrderList() {
    setOpenColumn(null);
    setSelectedOrder(null);
  }

  return (
    <section className="restaurant-orders-page">
      <style>{`
        .restaurant-order-list-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px)}
        .restaurant-order-list-modal{position:relative;width:min(520px,100%);max-height:min(78vh,680px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);padding:24px;color:#0f172a}
        .restaurant-order-list-modal-close{position:absolute;right:14px;top:14px;width:38px;height:38px;border:0;border-radius:999px;background:#f1f5f9;font-size:22px;line-height:1;cursor:pointer}
        .restaurant-order-list-modal-title{padding-right:48px;margin:0 0 4px;font-size:22px}
        .restaurant-order-list-modal-subtitle{margin:0 0 20px;color:#64748b;font-size:14px}
        .restaurant-order-list{display:flex;flex-direction:column;gap:10px}
        .restaurant-order-list-item{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;text-align:left;cursor:pointer}
        .restaurant-order-list-item:hover{background:#f8fafc;border-color:#cbd5e1}
        .restaurant-order-list-number{font-weight:700;color:#0f172a;font-size:14px}
        .restaurant-order-list-meta{display:flex;align-items:center;gap:10px;white-space:nowrap}
        .restaurant-order-list-status{font-size:12px;padding:5px 8px;border-radius:999px;background:#f1f5f9;color:#475569}
        .restaurant-order-list-total{font-weight:800;color:#0f172a}
        .restaurant-order-list-empty{padding:30px 12px;text-align:center;color:#64748b;border:1px dashed #cbd5e1;border-radius:12px}
        .restaurant-order-modal-backdrop{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px)}
        .restaurant-order-modal{position:relative;width:min(560px,100%);max-height:min(88vh,760px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);padding:24px;color:#0f172a}
        .restaurant-order-modal-close{position:absolute;right:14px;top:14px;width:38px;height:38px;border:0;border-radius:999px;background:#f1f5f9;font-size:22px;line-height:1;cursor:pointer}
        .restaurant-order-modal-title{padding-right:48px;margin:0 0 5px;font-size:22px}
        .restaurant-order-modal-subtitle{margin:0 0 18px;color:#64748b;font-size:14px}
        .restaurant-order-modal-total{font-size:22px;font-weight:800}
        .restaurant-order-modal-actions{display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap;margin-top:20px}
        .restaurant-order-cancel-modal-backdrop{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.62);backdrop-filter:blur(4px)}
        .restaurant-order-cancel-modal{position:relative;width:min(430px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.32);padding:24px;color:#0f172a}
        .restaurant-order-cancel-modal-title{margin:0 0 8px;font-size:21px}
        .restaurant-order-cancel-modal-text{margin:0;color:#64748b;line-height:1.5}
        .restaurant-order-cancel-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
        .restaurant-order-cancel-button{border:0;border-radius:10px;padding:11px 16px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer}
        .restaurant-order-cancel-button:disabled{opacity:.6;cursor:not-allowed}
        @media(max-width:600px){
          .restaurant-order-list-modal-backdrop,.restaurant-order-modal-backdrop{padding:10px;align-items:flex-end}
          .restaurant-order-list-modal,.restaurant-order-modal{max-height:92vh;border-radius:18px 18px 12px 12px;padding:20px}
          .restaurant-order-list-meta{gap:6px}
          .restaurant-order-list-status{display:none}
          .restaurant-order-modal-actions .button{flex:1;min-width:130px}
        }
        .restaurant-order-print-receipt{display:none}
        @media print{
          @page{size:80mm auto;margin:0}
          html,body{width:80mm!important;margin:0!important;padding:0!important;background:#fff!important}
          body *{visibility:hidden!important}
          .restaurant-order-print-receipt,.restaurant-order-print-receipt *{visibility:visible!important}
          .restaurant-order-print-receipt{display:block!important;width:80mm!important;box-sizing:border-box!important;margin:0!important;padding:5mm 4mm!important;font-family:Arial,sans-serif!important;font-size:11px!important;line-height:1.35!important;color:#000!important;background:#fff!important}
          .restaurant-order-print-receipt *{box-sizing:border-box!important}
          .receipt-center{text-align:center!important}
          .receipt-title{font-size:16px!important;font-weight:800!important;margin:0 0 4px!important}
          .receipt-order-number{font-size:12px!important;font-weight:800!important;word-break:break-word!important}
          .receipt-muted{font-size:10px!important}
          .receipt-divider{border:0!important;border-top:1px dashed #000!important;margin:8px 0!important}
          .receipt-row{display:flex!important;justify-content:space-between!important;gap:10px!important}
          .receipt-row span:last-child{white-space:nowrap!important;text-align:right!important}
          .receipt-label{font-weight:700!important}
          .receipt-item{display:flex!important;justify-content:space-between!important;gap:8px!important}
          .receipt-item-name{min-width:0!important;overflow-wrap:anywhere!important}
          .receipt-total{font-size:14px!important;font-weight:800!important}
        }
      `}</style>

      <div className="restaurant-orders-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Orders</h1>
          <p>Track every order from payment confirmation to completion.</p>
        </div>
        <span className={`restaurant-dashboard-live-status is-${realtimeStatus}`}>
          <span className="restaurant-dashboard-live-dot" />
          {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </div>

      <div className="restaurant-orders-tabs">
        <button
          className={filter === 'active' ? 'is-active' : ''}
          type="button"
          onClick={() => {
            setFilter('active');
            closeOrderList();
          }}
        >
          Active ({activeOrders.length})
        </button>
        <button
          className={filter === 'all' ? 'is-active' : ''}
          type="button"
          onClick={() => {
            setFilter('all');
            closeOrderList();
          }}
        >
          All ({orders.length})
        </button>
      </div>

      {error && <div className="restaurant-orders-error" role="alert">{error}</div>}

      {loading ? (
        <div className="restaurant-orders-empty">Loading orders…</div>
      ) : (
        <div className="restaurant-order-board">
          {columns.map((column) => {
            const columnOrders = boardOrders.filter((order) => columnFor(order) === column.key);
            return (
              <section className="restaurant-order-column" key={column.key}>
                <button
                  className="restaurant-order-column-header"
                  type="button"
                  onClick={() => {
                    setSelectedOrder(null);
                    setOpenColumn(column.key);
                  }}
                >
                  <div>
                    <h2>{column.title}</h2>
                    <p>{column.description}</p>
                  </div>
                  <span>{columnOrders.length}</span>
                </button>
              </section>
            );
          })}
        </div>
      )}

      {openedColumn && (
        <div
          className="restaurant-order-list-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeOrderList();
          }}
        >
          <div className="restaurant-order-list-modal" role="dialog" aria-modal="true" aria-label={`${openedColumn.title} orders`}>
            <button className="restaurant-order-list-modal-close" type="button" onClick={closeOrderList}>×</button>
            <h2 className="restaurant-order-list-modal-title">{openedColumn.title}</h2>
            <p className="restaurant-order-list-modal-subtitle">{openedColumn.description}{normalizedSearch && openedColumn.key === 'new' ? ` · ${openedColumnOrders.length} matching order${openedColumnOrders.length === 1 ? '' : 's'}` : ''}</p>

            {openedColumn.key === 'new' && (
              <div style={{ margin: '18px 0 16px' }}>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by order number or customer name"
                  aria-label="Search new orders by order number or customer name"
                  autoFocus
                  style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 14, outline: 'none' }}
                />
              </div>
            )}

            {openedColumnOrders.length === 0 ? (
              <div className="restaurant-order-list-empty">No orders in this stage.</div>
            ) : (
              <div className="restaurant-order-list">
                {openedColumnOrders.map((order) => (
                  <button
                    className="restaurant-order-list-item"
                    key={order.orderId}
                    type="button"
                    onClick={() => setSelectedOrder(order)}
                  >
                    <span className="restaurant-order-list-number">{order.orderNumber}</span>
                    <span style={{ display: 'block', marginTop: 3, fontSize: 13, color: '#64748b' }}>{order.customerName}</span>
                    <span className="restaurant-order-list-meta">
                      <span className="restaurant-order-list-status">{statusLabels[order.status]}</span>
                      <span className="restaurant-order-list-total">₱{order.total.toFixed(2)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedOrder && (
        <div
          className="restaurant-order-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedOrder(null);
          }}
        >
          <div className="restaurant-order-modal" role="dialog" aria-modal="true" aria-label={`Order ${selectedOrder.orderNumber}`}>
            <button className="restaurant-order-modal-close" type="button" onClick={() => setSelectedOrder(null)}>×</button>
            <h2 className="restaurant-order-modal-title">{selectedOrder.orderNumber}</h2>
            <p className="restaurant-order-modal-subtitle">
              {statusLabels[selectedOrder.status]} · {new Date(selectedOrder.createdAt).toLocaleString()}
            </p>
            <div className="restaurant-order-meta">
              <span>{selectedOrder.orderType === 'dine_in' ? 'Dine-in' : selectedOrder.orderType === 'pickup' ? 'Pickup / Take-out' : 'Delivery'}</span>
              <span>{paymentLabel(selectedOrder)}</span>
            </div>
            <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#f8fafc', color: '#334155' }}>
              <strong>Customer</strong><div>{selectedOrder.customerName}</div>
            </div>
            <div className="restaurant-order-items" style={{ marginTop: 18 }}>
              {selectedOrder.items.map((item) => (
                <div className="restaurant-order-item" key={item.id}>
                  <span><strong>{item.quantity}×</strong> {item.productName}</span>
                  <span>₱{item.lineTotal.toFixed(2)}</span>
                </div>
              ))}
            </div>
            {selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0', color: '#64748b' }}>
                <span>Shipping fee</span>
                <span>₱{selectedOrder.shippingFee.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 ? '0' : '1px solid #e2e8f0', marginTop: selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 ? 0 : 12, paddingTop: selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 ? 8 : 14 }}>
              <strong>Total</strong>
              <strong className="restaurant-order-modal-total">₱{selectedOrder.total.toFixed(2)}</strong>
            </div>
            {selectedOrder.status === 'pending' && selectedOrder.orderType === 'dine_in' && selectedOrder.paymentMethod === 'cash' && selectedOrder.paymentStatus !== 'paid' && (
              <p style={{ marginTop: 16 }}>Customer must pay at the counter before this dine-in order can enter the kitchen.</p>
            )}
            {selectedOrder.status === 'pending' && !isPaymentReady(selectedOrder) && !(selectedOrder.orderType === 'dine_in' && selectedOrder.paymentMethod === 'cash') && (
              <p style={{ marginTop: 16 }}>Online payment is required before this order can enter the kitchen.</p>
            )}
            <div className="restaurant-order-modal-actions">
              {selectedOrder.status === 'pending' ? (
                <>
                  {selectedOrder.orderType === 'dine_in' && selectedOrder.paymentMethod === 'cash' && selectedOrder.paymentStatus !== 'paid' ? (
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={updating === selectedOrder.orderId}
                      onClick={() => void confirmDineInCashPayment(selectedOrder)}
                    >
                      {updating === selectedOrder.orderId ? 'Confirming Payment…' : 'Confirm Payment & Send to Kitchen'}
                    </button>
                  ) : (
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={updating === selectedOrder.orderId || !isPaymentReady(selectedOrder)}
                      onClick={() => void printAndSendToKitchen(selectedOrder)}
                    >
                      {updating === selectedOrder.orderId ? 'Printing & Sending…' : 'Print Order & Send to Kitchen'}
                    </button>
                  )}
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={updating === selectedOrder.orderId}
                    onClick={() => setCancelConfirmationOrder(selectedOrder)}
                  >
                    Cancel Order
                  </button>
                </>
              ) : nextStatus[selectedOrder.status] ? (
                <button
                  className="button button-primary"
                  type="button"
                  disabled={updating === selectedOrder.orderId}
                  onClick={() => void advance(selectedOrder)}
                >
                  {updating === selectedOrder.orderId ? 'Updating…' : actionLabels[selectedOrder.status]}
                </button>
              ) : null}
            </div>
          </div>

          <div className="restaurant-order-print-receipt" aria-hidden="true">
            <div className="receipt-center">
              <div className="receipt-title">Restaurant Order</div>
              <div className="receipt-order-number">{selectedOrder.orderNumber}</div>
              <div className="receipt-muted">
                {new Date(selectedOrder.createdAt).toLocaleString()}
              </div>
            </div>

            <hr className="receipt-divider" />

            <div className="receipt-center">
              <div className="receipt-label">
                {selectedOrder.orderType === 'dine_in'
                  ? 'DINE-IN'
                  : selectedOrder.orderType === 'pickup'
                    ? 'PICKUP / TAKE-OUT'
                    : 'DELIVERY'}
              </div>
              <div>{paymentLabel(selectedOrder)}</div>
            </div>

            <hr className="receipt-divider" />

            <div>
              <div className="receipt-label">Customer</div>
              <div>{selectedOrder.customerName || 'Guest'}</div>
            </div>

            <hr className="receipt-divider" />

            <div>
              {selectedOrder.items.map((item) => (
                <div className="receipt-item" key={item.id}>
                  <span className="receipt-item-name">{item.quantity} × {item.productName}</span>
                  <span>₱{item.lineTotal.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <hr className="receipt-divider" />

            {selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 && (
              <div className="receipt-row">
                <span>Shipping fee</span>
                <span>₱{selectedOrder.shippingFee.toFixed(2)}</span>
              </div>
            )}

            <div className="receipt-row receipt-total">
              <span>TOTAL</span>
              <span>₱{selectedOrder.total.toFixed(2)}</span>
            </div>

            <hr className="receipt-divider" />

            <div className="receipt-center">Thank you for your order!</div>
          </div>
        </div>
      )}

      {cancelConfirmationOrder && (
        <div
          className="restaurant-order-cancel-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && updating !== cancelConfirmationOrder.orderId) {
              setCancelConfirmationOrder(null);
            }
          }}
        >
          <div className="restaurant-order-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-order-title">
            <h2 id="cancel-order-title" className="restaurant-order-cancel-modal-title">Cancel Order?</h2>
            <p className="restaurant-order-cancel-modal-text">
              Are you sure you want to cancel order <strong>{cancelConfirmationOrder.orderNumber}</strong>? This action will mark the order as cancelled.
            </p>
            <div className="restaurant-order-cancel-modal-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={updating === cancelConfirmationOrder.orderId}
                onClick={() => setCancelConfirmationOrder(null)}
              >
                Keep Order
              </button>
              <button
                className="restaurant-order-cancel-button"
                type="button"
                disabled={updating === cancelConfirmationOrder.orderId}
                onClick={() => void cancel(cancelConfirmationOrder)}
              >
                {updating === cancelConfirmationOrder.orderId ? 'Cancelling…' : 'Yes, Cancel Order'}
              </button>
            </div>
          </div>
        </div>
      )}

    </section>
  );
}