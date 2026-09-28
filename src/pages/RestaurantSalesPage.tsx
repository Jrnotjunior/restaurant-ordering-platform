import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getRestaurantOrders, type RestaurantOrder } from '../services/restaurantOrderRepository';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };

type DailySales = {
  dateKey: string;
  dateLabel: string;
  orders: RestaurantOrder[];
  total: number;
};

function localDateKey(dateString: string) {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
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
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);

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

  const dailySales = useMemo<DailySales[]>(() => {
    const grouped = new Map<string, RestaurantOrder[]>();

    for (const order of completedOrders) {
      const key = localDateKey(order.createdAt);
      const dayOrders = grouped.get(key) ?? [];
      dayOrders.push(order);
      grouped.set(key, dayOrders);
    }

    return [...grouped.entries()]
      .map(([dateKey, dayOrders]) => ({
        dateKey,
        dateLabel: formatDateLabel(dateKey),
        orders: dayOrders,
        total: dayOrders.reduce((sum, order) => sum + order.total, 0),
      }))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [completedOrders]);

  useEffect(() => {
    if (!selectedDateKey && dailySales.length > 0) setSelectedDateKey(dailySales[0].dateKey);
    if (selectedDateKey && !dailySales.some((day) => day.dateKey === selectedDateKey)) setSelectedDateKey(dailySales[0]?.dateKey ?? null);
  }, [dailySales, selectedDateKey]);

  const selectedDay = useMemo(
    () => dailySales.find((day) => day.dateKey === selectedDateKey) ?? null,
    [dailySales, selectedDateKey],
  );

  function exportDailySales(day: DailySales) {
    const rows = day.orders.map((order) => ({
      'Order Number': order.orderNumber,
      Date: new Date(order.createdAt).toLocaleString(),
      'Order Type': order.orderType === 'dine_in' ? 'Dine-in' : order.orderType === 'pickup' ? 'Pickup' : 'Delivery',
      Payment: paymentLabel(order),
      'Shipping Fee': order.shippingFee,
      'Order Total': order.total,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.sheet_add_aoa(worksheet, [
      ['Daily Sales Report'],
      ['Date', day.dateLabel],
      ['Total Sales', day.total],
      ['Completed Orders', day.orders.length],
      [],
    ], { origin: 'A1' });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily Sales');
    XLSX.writeFile(workbook, `sales-${day.dateKey}.xlsx`);
  }

  return (
    <section className="restaurant-sales-page">
      <div className="restaurant-sales-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Sales</h1>
          <p>View your completed sales by day and download a daily sales report.</p>
        </div>
        <span className={`restaurant-dashboard-live-status is-${realtimeStatus}`}>
          <span className="restaurant-dashboard-live-dot" />
          {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </div>

      {error && <div className="restaurant-sales-error" role="alert">{error}</div>}

      {loading ? (
        <div className="restaurant-sales-empty">Loading sales…</div>
      ) : dailySales.length === 0 ? (
        <div className="restaurant-sales-empty">No completed sales yet.</div>
      ) : (
        <div className="restaurant-sales-layout">
          <section className="restaurant-sales-panel">
            <div className="restaurant-sales-panel-header">
              <div>
                <p className="eyebrow">Daily sales</p>
                <h2>Sales by day</h2>
              </div>
              <span>{dailySales.length} {dailySales.length === 1 ? 'day' : 'days'}</span>
            </div>

            <div className="restaurant-sales-day-list">
              {dailySales.map((day) => (
                <button
                  key={day.dateKey}
                  type="button"
                  className={`restaurant-sales-day ${selectedDateKey === day.dateKey ? 'is-selected' : ''}`}
                  onClick={() => setSelectedDateKey(day.dateKey)}
                >
                  <span>
                    <strong>{day.dateLabel}</strong>
                    <small>{day.orders.length} completed {day.orders.length === 1 ? 'order' : 'orders'}</small>
                  </span>
                  <strong>₱{day.total.toFixed(2)}</strong>
                </button>
              ))}
            </div>
          </section>

          {selectedDay && (
            <section className="restaurant-sales-detail">
              <div>
                <p className="eyebrow">Selected day</p>
                <h2>{selectedDay.dateLabel}</h2>
                <p>Download the completed sales for this day as an Excel spreadsheet.</p>
              </div>

              <div className="restaurant-sales-detail-stats">
                <div>
                  <span>Total sales</span>
                  <strong>₱{selectedDay.total.toFixed(2)}</strong>
                </div>
                <div>
                  <span>Completed orders</span>
                  <strong>{selectedDay.orders.length}</strong>
                </div>
              </div>

              <button className="button button-primary restaurant-sales-export" type="button" onClick={() => exportDailySales(selectedDay)}>
                Save as XLSX
              </button>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
