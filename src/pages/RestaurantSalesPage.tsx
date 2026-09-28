import { useEffect, useMemo, useState } from 'react';
import { getRestaurantOrders, type RestaurantOrder } from '../services/restaurantOrderRepository';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };

function isToday(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function paymentLabel(order: RestaurantOrder) {
  if (order.paymentMethod === 'gcash') return order.paymentStatus === 'paid' ? 'GCash' : 'GCash • Unpaid';
  return order.paymentStatus === 'paid' ? 'Cash' : 'Cash • Unpaid';
}

export function RestaurantSalesPage({ restaurantId }: Props) {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');

  async function loadOrders() {
    try {
      setError('');
      setOrders(await getRestaurantOrders(restaurantId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load sales.');
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
      .channel(`restaurant-sales:${restaurantId}`)
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

  const completedOrders = useMemo(() => orders.filter((order) => order.status === 'completed'), [orders]);
  const todayOrders = useMemo(() => completedOrders.filter((order) => isToday(order.createdAt)), [completedOrders]);
  const todaySales = useMemo(() => todayOrders.reduce((sum, order) => sum + order.total, 0), [todayOrders]);
  const totalSales = useMemo(() => completedOrders.reduce((sum, order) => sum + order.total, 0), [completedOrders]);
  const averageOrder = completedOrders.length ? totalSales / completedOrders.length : 0;

  return (
    <section className="restaurant-sales-page">
      <div className="restaurant-sales-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Sales</h1>
          <p>Review completed orders and track your restaurant's sales.</p>
        </div>
        <span className={`restaurant-dashboard-live-status is-${realtimeStatus}`}>
          <span className="restaurant-dashboard-live-dot" />
          {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </div>

      {error && <div className="restaurant-sales-error" role="alert">{error}</div>}

      {loading ? (
        <div className="restaurant-sales-empty">Loading sales…</div>
      ) : (
        <>
          <div className="restaurant-sales-stats">
            <article className="restaurant-sales-stat">
              <span>Today's sales</span>
              <strong>₱{todaySales.toFixed(2)}</strong>
              <small>{todayOrders.length} completed {todayOrders.length === 1 ? 'order' : 'orders'} today</small>
            </article>
            <article className="restaurant-sales-stat">
              <span>Total sales</span>
              <strong>₱{totalSales.toFixed(2)}</strong>
              <small>{completedOrders.length} completed orders</small>
            </article>
            <article className="restaurant-sales-stat">
              <span>Average order</span>
              <strong>₱{averageOrder.toFixed(2)}</strong>
              <small>Across completed orders</small>
            </article>
          </div>

          <section className="restaurant-sales-panel">
            <div className="restaurant-sales-panel-header">
              <div>
                <p className="eyebrow">Completed orders</p>
                <h2>Sales history</h2>
              </div>
              <span>{completedOrders.length} orders</span>
            </div>

            {completedOrders.length === 0 ? (
              <div className="restaurant-sales-empty">No completed sales yet.</div>
            ) : (
              <div className="restaurant-sales-table-wrap">
                <table className="restaurant-sales-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Date</th>
                      <th>Payment</th>
                      <th>Type</th>
                      <th className="is-number">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedOrders.map((order) => (
                      <tr key={order.orderId}>
                        <td><strong>{order.orderNumber}</strong></td>
                        <td>{new Date(order.createdAt).toLocaleString()}</td>
                        <td>{paymentLabel(order)}</td>
                        <td>{order.orderType === 'dine_in' ? 'Dine-in' : order.orderType === 'pickup' ? 'Pickup' : 'Delivery'}</td>
                        <td className="is-number"><strong>₱{order.total.toFixed(2)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
