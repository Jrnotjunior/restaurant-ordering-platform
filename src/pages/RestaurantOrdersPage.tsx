import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getRestaurantOrders, updateOrderStatus, type RestaurantOrder, type RestaurantOrderStatus } from '../services/restaurantOrderRepository';
import { getKitchenOrders, updateKitchenOrderStatus } from '../modules/kitchen/kitchenService';
import { confirmPosCashPayment } from '../modules/pos/posService';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string; role?: 'owner' | 'cashier' | 'kitchen' };
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

function isOnlinePaid(order: RestaurantOrder) {
  return order.paymentMethod === 'gcash' && order.paymentStatus === 'paid';
}

function columnFor(order: RestaurantOrder): BoardColumn | null {
  if (order.status === 'pending') return 'new';
  if (order.status === 'confirmed' || order.status === 'preparing') return 'kitchen';
  // Delivery and pickup orders leave the restaurant Orders board once they are ready.
  // They are handled in Dispatch instead. Dine-in orders remain on the Ready board.
  if (order.status === 'ready' && order.orderType === 'dine_in') return 'ready';
  if (order.status === 'completed') return 'completed';
  return null;
}

const columns: Array<{ key: BoardColumn; title: string; description: string }> = [
  { key: 'new', title: 'New Orders', description: 'New customer orders waiting for cashier review' },
  { key: 'kitchen', title: 'In the Kitchen', description: 'Orders being prepared' },
  { key: 'ready', title: 'Ready', description: 'Ready for pickup or dine-in' },
  { key: 'completed', title: 'Completed', description: 'Finished orders' },
];

export function RestaurantOrdersPage({ restaurantId, role = 'owner' }: Props) {
  const isCashier = role === 'cashier';
  const isKitchen = role === 'kitchen';
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
  const [newOrderPaymentFilter, setNewOrderPaymentFilter] = useState<'all' | 'online-paid' | 'unpaid'>('all');

  async function loadOrders() {
    try {
      setError('');
      const data = isKitchen ? await getKitchenOrders(restaurantId) : await getRestaurantOrders(restaurantId);
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
      .channel(`restaurant-orders:${restaurantId}`)
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
  const boardOrders = isCashier
    ? orders
    : isKitchen
      ? activeOrders
      : filter === 'active'
        ? activeOrders
        : orders;
  const openedColumn = columns.find((column) => column.key === openColumn) ?? null;
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchedOrders = openedColumn?.key === 'new' && normalizedSearch
    ? boardOrders.filter((order) =>
        order.orderNumber.toLowerCase().includes(normalizedSearch) ||
        order.customerName.toLowerCase().includes(normalizedSearch),
      )
    : boardOrders;

  const openedColumnOrders = openedColumn
    ? searchedOrders.filter((order) => {
        if (isKitchen && order.status === 'ready') return openedColumn.key === 'ready';
        return columnFor(order) === openedColumn.key;
      })
    : [];

  async function advance(order: RestaurantOrder) {
    if (role !== 'kitchen') return;
    const status = nextStatus[order.status];
    if (!status) return;

    try {
      setError('');
      setUpdating(order.orderId);
      await updateKitchenOrderStatus(order.orderId, status);
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
    if (role !== 'cashier') return;
    try {
      setError(''); setUpdating(order.orderId);
      await confirmPosCashPayment(order.orderId);
      setOrders((current) => current.map((item) => item.orderId === order.orderId ? { ...item, paymentStatus: 'paid', status: 'confirmed' } : item));
      setSelectedOrder(null); setOpenColumn(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to confirm dine-in payment.');
    } finally { setUpdating(null); }
  }

  async function printAndSendToKitchen(order: RestaurantOrder) {
    if (role !== 'cashier') return;
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
      // Close only the order-detail modal and return to the New Orders list.
      // Keep the parent New Orders modal open for the cashier. 
      setSelectedOrder(null);
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
    <section className="restaurant-page restaurant-orders-page">
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
        .restaurant-order-customer{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:12px;padding:10px 12px;border-radius:10px;background:#f8fafc;color:#334155}
        .restaurant-order-customer strong{flex:0 0 auto}
        .restaurant-order-customer span{min-width:0;text-align:right;overflow-wrap:anywhere}
        .restaurant-order-modal-actions{display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap;margin-top:20px}
        .restaurant-order-cancel-modal-backdrop{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.62);backdrop-filter:blur(4px)}
        .restaurant-order-cancel-modal{position:relative;width:min(430px,100%);background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.32);padding:24px;color:#0f172a}
        .restaurant-order-cancel-modal-title{margin:0 0 8px;font-size:21px}
        .restaurant-order-cancel-modal-text{margin:0;color:#64748b;line-height:1.5}
        .restaurant-order-cancel-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
        .restaurant-order-cancel-button{border:0;border-radius:10px;padding:11px 16px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer}
        .restaurant-kitchen-order-item{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:13px 0;border-bottom:1px solid #e2e8f0;color:#0f172a}
        .restaurant-kitchen-order-item:last-child{border-bottom:0}
        .restaurant-kitchen-order-item .restaurant-order-item-name{min-width:0;font-size:14px;font-weight:600;line-height:1.4}
        .restaurant-kitchen-order-quantity{flex:0 0 auto;min-width:42px;text-align:right;color:#475569;font-size:14px;font-weight:700}

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
          .restaurant-order-print-receipt{display:block!important;width:80mm!important;max-width:80mm!important;box-sizing:border-box!important;margin:0!important;padding:4mm 4mm 6mm!important;font-family:Arial,sans-serif!important;font-size:12px!important;line-height:1.4!important;color:#000!important;background:#fff!important}
          .restaurant-kitchen-receipt{page-break-after:always!important;break-after:page!important}
          .receipt-kitchen-item{display:grid!important;grid-template-columns:minmax(0,1fr) 35px!important;gap:8px!important;font-size:15px!important;font-weight:700!important;margin-bottom:8px!important}.receipt-kitchen-item strong{text-align:right!important}
          .receipt-discount-detail{margin-top:6px!important;font-size:10px!important;line-height:1.35!important}
          .receipt-signature-line{margin-top:14px!important;font-size:10px!important}
          .restaurant-order-print-receipt *{box-sizing:border-box!important}
          .receipt-center{text-align:center!important}
          .receipt-title{font-size:18px!important;line-height:1.2!important;font-weight:800!important;margin:0 0 5px!important}
          .receipt-order-number{font-size:13px!important;line-height:1.25!important;font-weight:800!important;word-break:break-word!important}
          .receipt-muted{font-size:11px!important}
          .receipt-divider{border:0!important;border-top:1px dashed #000!important;margin:9px 0!important}
          .receipt-row{display:flex!important;justify-content:space-between!important;align-items:flex-start!important;gap:12px!important}
          .receipt-row span:first-child{min-width:0!important}
          .receipt-row span:last-child{white-space:nowrap!important;text-align:right!important}
          .receipt-label{font-weight:700!important}
          .receipt-item{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;align-items:start!important;column-gap:10px!important}
          .receipt-item + .receipt-item{margin-top:3px!important}
          .receipt-item-name{min-width:0!important;overflow-wrap:anywhere!important}
          .receipt-item > span:last-child{white-space:nowrap!important;text-align:right!important}
          .receipt-total{font-size:16px!important;line-height:1.25!important;font-weight:800!important}
          .receipt-center:last-child{font-size:11px!important}
        }
      `}</style>

            {role !== 'owner' && <div className="restaurant-page-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Orders</h1>
          <p>Track every order from payment confirmation to completion.</p>
        </div>
        <span className={`restaurant-dashboard-live-status is-${realtimeStatus}`}>
          <span className="restaurant-dashboard-live-dot" />
          {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </div>}

      {!isCashier && !isKitchen && <div className="restaurant-orders-tabs">
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
      </div>}

      {error && <div className="restaurant-orders-error" role="alert">{error}</div>}

      {loading ? (
        <div className="restaurant-orders-empty">Loading orders…</div>
      ) : isKitchen ? (
        (() => {
          const kitchenOrders = orders.filter((order) => order.status === 'confirmed' || order.status === 'preparing');

          return kitchenOrders.length === 0 ? (
            <div className="restaurant-order-list-empty">No orders currently in the kitchen.</div>
          ) : (
            <div className="restaurant-order-list restaurant-order-list-scroll">
              {kitchenOrders.map((order) => (
                <button
                  className="restaurant-order-list-item"
                  key={order.orderId}
                  type="button"
                  onClick={() => setSelectedOrder(order)}
                >
                  <span>
                    <span className="restaurant-order-list-number">{order.orderNumber}</span>
                    <span style={{ display: 'block', marginTop: 3, fontSize: 13, color: '#64748b' }}>
                      {order.customerName}
                    </span>
                  </span>
                  <span className="restaurant-order-list-meta">
                    <span className="restaurant-order-list-status">{statusLabels[order.status]}</span>
                    <span className="restaurant-order-list-total">₱{order.total.toFixed(2)}</span>
                  </span>
                </button>
              ))}
            </div>
          );
        })()
      ) : isCashier ? (
        (() => {
          const cashierNewOrders = boardOrders
            .filter((order) => columnFor(order) === 'new')
            .filter((order) => {
              if (!normalizedSearch) return true;
              return (
                order.orderNumber.toLowerCase().includes(normalizedSearch) ||
                order.customerName.toLowerCase().includes(normalizedSearch)
              );
            });

          const visibleCashierOrders = cashierNewOrders.filter((order) =>
            newOrderPaymentFilter === 'all'
              ? true
              : newOrderPaymentFilter === 'online-paid'
                ? isOnlinePaid(order)
                : !isOnlinePaid(order),
          );

          return (
            <section className="restaurant-cashier-orders">
              <div style={{ marginBottom: 14 }}>
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by order number or customer name"
                  aria-label="Search new orders by order number or customer name"
                  style={{ width: '100%', maxWidth: 360, boxSizing: 'border-box', padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 14, outline: 'none' }}
                />
              </div>

              <div className="restaurant-order-payment-tabs" role="tablist" aria-label="New order payment filter">
                {[
                  ['all', 'All'],
                  ['online-paid', 'Online Paid'],
                  ['unpaid', 'Unpaid'],
                ].map(([key, label]) => {
                  const count = key === 'all'
                    ? cashierNewOrders.length
                    : key === 'online-paid'
                      ? cashierNewOrders.filter(isOnlinePaid).length
                      : cashierNewOrders.filter((order) => !isOnlinePaid(order)).length;

                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={newOrderPaymentFilter === key}
                      className={newOrderPaymentFilter === key ? 'is-active' : ''}
                      onClick={() => setNewOrderPaymentFilter(key as 'all' | 'online-paid' | 'unpaid')}
                    >
                      {label} <span>{count}</span>
                    </button>
                  );
                })}
              </div>

              {visibleCashierOrders.length === 0 ? (
                <div className="restaurant-order-list-empty">
                  {cashierNewOrders.length === 0
                    ? 'No new customer orders right now.'
                    : 'No orders match the current filter.'}
                </div>
              ) : (
                <div className="restaurant-order-list restaurant-order-list-scroll">
                  {visibleCashierOrders.map((order) => (
                    <button
                      className="restaurant-order-list-item"
                      key={order.orderId}
                      type="button"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <span>
                        <span className="restaurant-order-list-number">{order.orderNumber}</span>
                        <span style={{ display: 'block', marginTop: 3, fontSize: 13, color: '#64748b' }}>
                          {order.customerName}
                        </span>
                      </span>
                      <span className="restaurant-order-list-meta">
                        <span className="restaurant-order-list-status">{paymentLabel(order)}</span>
                        <span className="restaurant-order-list-total">₱{order.total.toFixed(2)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })()
      ) : (
        <div className="restaurant-order-board">
          {columns.filter((column) => isKitchen ? (column.key === 'kitchen' || column.key === 'ready') : true).map((column) => {
            const columnOrders = boardOrders.filter((order) => {
              if (isKitchen && order.status === 'ready') return column.key === 'ready';
              return columnFor(order) === column.key;
            });
            return (
              <section className="restaurant-order-column" key={column.key}>
                <button
                  className="restaurant-order-column-header"
                  type="button"
                  onClick={() => {
                    setSelectedOrder(null);
                    if (column.key === 'new') {
                      setNewOrderPaymentFilter('all');
                      setSearchQuery('');
                    }
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

      {openedColumn && createPortal(
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
              <>
                <div style={{ margin: '18px 0 12px' }}>
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
                <div className="restaurant-order-payment-tabs" role="tablist" aria-label="New order payment filter">
                  {[
                    ['all', 'All'],
                    ['online-paid', 'Online Paid'],
                    ['unpaid', 'Unpaid'],
                  ].map(([key, label]) => {
                    const count = key === 'all'
                      ? openedColumnOrders.length
                      : key === 'online-paid'
                        ? openedColumnOrders.filter(isOnlinePaid).length
                        : openedColumnOrders.filter((order) => !isOnlinePaid(order)).length;
                    return (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={newOrderPaymentFilter === key}
                        className={newOrderPaymentFilter === key ? 'is-active' : ''}
                        onClick={() => setNewOrderPaymentFilter(key as 'all' | 'online-paid' | 'unpaid')}
                      >
                        {label} <span>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {(() => {
              const visibleOrders = openedColumn.key === 'new'
                ? openedColumnOrders.filter((order) =>
                    newOrderPaymentFilter === 'all'
                      ? true
                      : newOrderPaymentFilter === 'online-paid'
                        ? isOnlinePaid(order)
                        : !isOnlinePaid(order),
                  )
                : openedColumnOrders;

              if (visibleOrders.length === 0) {
                return <div className="restaurant-order-list-empty">No orders in this stage.</div>;
              }

              return (
                <div className="restaurant-order-list restaurant-order-list-scroll">
                  {visibleOrders.map((order) => (
                    <button
                      className="restaurant-order-list-item"
                      key={order.orderId}
                      type="button"
                      onClick={() => setSelectedOrder(order)}
                    >
                      <span className="restaurant-order-list-number">{order.orderNumber}</span>
                      <span style={{ display: 'block', marginTop: 3, fontSize: 13, color: '#64748b' }}>{order.customerName}</span>
                      <span className="restaurant-order-list-meta">
                        <span className="restaurant-order-list-status">
                          {openedColumn.key === 'new' ? paymentLabel(order) : statusLabels[order.status]}
                        </span>
                        <span className="restaurant-order-list-total">₱{order.total.toFixed(2)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>,
        document.body,
      )}

      {selectedOrder && createPortal(
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
              <span>{selectedOrder.orderType === 'dine_in' ? 'Dine-in' : selectedOrder.orderType === 'pickup' ? (selectedOrder.pickupMethod === 'third_party_courier' ? 'Customer Courier Pickup' : 'Pickup / Take-out') : 'Delivery'}</span>
              <span>{paymentLabel(selectedOrder)}</span>
            </div>
            <div className="restaurant-order-customer">
              <strong>Customer</strong>
              <span>{selectedOrder.customerName}</span>
            </div>
            {selectedOrder.notes.trim() && (
              <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#fffbeb', color: '#334155' }}>
                <strong>Special Instructions</strong>
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{selectedOrder.notes}</div>
              </div>
            )}
            <div className="restaurant-order-items" style={{ marginTop: 18 }}>
              {selectedOrder.items.map((item) => (
                <div className={`restaurant-order-item${isKitchen ? ' restaurant-kitchen-order-item' : ''}`} key={item.id}>
                  <span className="restaurant-order-item-name">{item.productName}</span>
                  {isKitchen ? (
                    <strong className="restaurant-kitchen-order-quantity">×{item.quantity}</strong>
                  ) : (
                    <span>₱{item.lineTotal.toFixed(2)}</span>
                  )}
                </div>
              ))}
            </div>
            {!isKitchen && selectedOrder.loyaltyDiscountAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0', color: '#0f766e' }}>
                <span>Loyalty Discount</span>
                <span>-₱{selectedOrder.loyaltyDiscountAmount.toFixed(2)}</span>
              </div>
            )}
            {!isKitchen && selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0', color: '#64748b' }}>
                <span>Shipping fee</span>
                <span>₱{selectedOrder.shippingFee.toFixed(2)}</span>
              </div>
            )}
            {!isKitchen && (
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 ? '0' : '1px solid #e2e8f0', marginTop: selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 ? 0 : 12, paddingTop: selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 ? 8 : 14 }}>
                <strong>Total</strong>
                <strong className="restaurant-order-modal-total">₱{selectedOrder.total.toFixed(2)}</strong>
              </div>
            )}
            {selectedOrder.status === 'pending' && selectedOrder.orderType === 'dine_in' && selectedOrder.paymentMethod === 'cash' && selectedOrder.paymentStatus !== 'paid' && (
              <p style={{ marginTop: 16 }}>Customer must pay at the counter before this dine-in order can enter the kitchen.</p>
            )}
            {selectedOrder.status === 'pending' && !isPaymentReady(selectedOrder) && !(selectedOrder.orderType === 'dine_in' && selectedOrder.paymentMethod === 'cash') && (
              <p style={{ marginTop: 16 }}>Online payment is required before this order can enter the kitchen.</p>
            )}
            {role !== 'owner' && <div className="restaurant-order-modal-actions">
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
            </div>}
          </div>

          <div className="restaurant-order-print-receipt restaurant-kitchen-receipt" aria-hidden="true">
            <div className="receipt-center">
              <div className="receipt-title">KITCHEN ORDER</div>
              <div className="receipt-order-number">{selectedOrder.orderNumber}</div>
              <div className="receipt-muted">{new Date(selectedOrder.createdAt).toLocaleString()}</div>
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
              {selectedOrder.customerName && <div>{selectedOrder.customerName}</div>}
            </div>
            {selectedOrder.notes.trim() && (
              <>
                <hr className="receipt-divider" />
                <div>
                  <div className="receipt-label">SPECIAL INSTRUCTIONS</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{selectedOrder.notes}</div>
                </div>
              </>
            )}
            <hr className="receipt-divider" />
            <div>
              {selectedOrder.items.map((item) => (
                <div className="receipt-kitchen-item" key={item.id}>
                  <span>{item.productName}</span>
                  <strong>×{item.quantity}</strong>
                </div>
              ))}
            </div>
            <hr className="receipt-divider" />
            <div className="receipt-center">Prepare this order.</div>
          </div>

          <div className="restaurant-order-print-receipt restaurant-customer-receipt" aria-hidden="true">
            <div className="receipt-center">
              <div className="receipt-title">CUSTOMER RECEIPT</div>
              <div className="receipt-order-number">{selectedOrder.orderNumber}</div>
              <div className="receipt-muted">{new Date(selectedOrder.createdAt).toLocaleString()}</div>
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
            {selectedOrder.taxGrossSales > 0 ? (
              <>
                <div className="receipt-row"><span>Gross sales</span><span>₱{selectedOrder.taxGrossSales.toFixed(2)}</span></div>
                <div className="receipt-row"><span>VATable sales</span><span>₱{selectedOrder.taxVatableSales.toFixed(2)}</span></div>
                {selectedOrder.taxVatAmount > 0 && <div className="receipt-row"><span>VAT {selectedOrder.taxVatRate.toFixed(2)}%</span><span>₱{selectedOrder.taxVatAmount.toFixed(2)}</span></div>}
                {selectedOrder.taxVatExemptSales > 0 && <div className="receipt-row"><span>VAT-exempt sales</span><span>₱{selectedOrder.taxVatExemptSales.toFixed(2)}</span></div>}
                {selectedOrder.discountAmount > 0 && <div className="receipt-row"><span>SC/PWD discount</span><span>-₱{selectedOrder.discountAmount.toFixed(2)}</span></div>}
              </>
            ) : (
              <div className="receipt-row"><span>Subtotal</span><span>₱{selectedOrder.items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)}</span></div>
            )}
            {selectedOrder.loyaltyDiscountAmount > 0 && (
              <div className="receipt-row"><span>Loyalty Discount</span><span>-₱{selectedOrder.loyaltyDiscountAmount.toFixed(2)}</span></div>
            )}
            {selectedOrder.orderType === 'delivery' && selectedOrder.shippingFee > 0 && (
              <div className="receipt-row"><span>Delivery fee</span><span>₱{selectedOrder.shippingFee.toFixed(2)}</span></div>
            )}
            <div className="receipt-row receipt-total">
              <span>TOTAL</span>
              <span>₱{selectedOrder.total.toFixed(2)}</span>
            </div>
            {selectedOrder.discountBeneficiaries.length > 0 && (
              <>
                <hr className="receipt-divider" />
                <div className="receipt-label">SC/PWD DETAILS</div>
                {selectedOrder.discountBeneficiaries.map((beneficiary, index) => (
                  <div key={index} className="receipt-discount-detail">
                    <div>{beneficiary.discountType.toUpperCase()} ID: {beneficiary.idNumber}</div>
                    <div>Eligible: ₱{beneficiary.eligibleAmount.toFixed(2)} · Discount: ₱{beneficiary.discountAmount.toFixed(2)}</div>
                  </div>
                ))}
                <div className="receipt-signature-line">Customer signature: ____________________</div>
              </>
            )}
            <hr className="receipt-divider" />
            <div className="receipt-center">Thank you for your order!</div>
          </div>
        </div>,
        document.body,
      )}

      {cancelConfirmationOrder && createPortal(
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
        </div>,
        document.body,
      )}

    </section>
  );
}