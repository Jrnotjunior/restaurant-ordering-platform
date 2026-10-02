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
  const [searchDate, setSearchDate] = useState('');

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

  const filteredDailySales = useMemo(() => {
    const query = searchDate.trim().toLowerCase();
    if (!query) return dailySales;

    return dailySales.filter((day) =>
      day.dateLabel.toLowerCase().includes(query) || day.dateKey.includes(query),
    );
  }, [dailySales, searchDate]);

  const selectedDay = useMemo(
    () => dailySales.find((day) => day.dateKey === selectedDateKey) ?? null,
    [dailySales, selectedDateKey],
  );

  function openSalesModal(dateKey: string) {
    setSelectedDateKey(dateKey);
  }

  function closeSalesModal() {
    setSelectedDateKey(null);
  }

  function exportDailySales(day: DailySales) {
    const rows = day.orders.map((order) => ({
      'Order Number': order.orderNumber,
      Date: new Date(order.createdAt).toLocaleString(),
      'Order Type': order.orderType === 'dine_in' ? 'Dine-in' : order.orderType === 'pickup' ? 'Pickup' : 'Delivery',
      Payment: paymentLabel(order),
      'Shipping Fee': order.shippingFee,
      'Order Total': order.total,
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Daily Sales Report'],
      ['Date', day.dateLabel],
      ['Total Sales', day.total],
      ['Completed Orders', day.orders.length],
      [],
    ]);
    XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A6' });
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily Sales');
    XLSX.writeFile(workbook, `sales-${day.dateKey}.xlsx`);
  }

  useEffect(() => {
    if (!selectedDay) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeSalesModal();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedDay]);

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
        <section className="restaurant-sales-panel">
          <div className="restaurant-sales-search" style={{ marginTop: 0 }}>
            <div className="restaurant-sales-search-input-wrap" style={{ maxWidth: 360 }}>
              <input
                id="restaurant-sales-date-search"
                type="search"
                value={searchDate}
                onChange={(event) => setSearchDate(event.target.value)}
                placeholder="Search by date, e.g. September 27 or 2026-09-27"
                style={{ maxWidth: 360 }}
              />
              {searchDate && (
                <button
                  type="button"
                  className="restaurant-sales-search-clear"
                  onClick={() => setSearchDate('')}
                  aria-label="Clear date search"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {filteredDailySales.length > 0 ? (
            <div className="restaurant-sales-day-list">
              {filteredDailySales.map((day) => (
                <button
                  key={day.dateKey}
                  type="button"
                  className="restaurant-sales-day"
                  onClick={() => openSalesModal(day.dateKey)}
                  aria-label={`Open sales for ${day.dateLabel}`}
                >
                  <strong>{day.dateLabel}</strong>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="restaurant-sales-search-empty">
              No sales found for “{searchDate}”.
            </div>
          )}
        </section>
      )}

      {selectedDay && (
        <div className="restaurant-sales-modal-backdrop" role="presentation" onMouseDown={closeSalesModal}>
          <div
            className="restaurant-sales-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restaurant-sales-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="restaurant-sales-modal-header">
              <div>
                <p className="eyebrow">Daily sales</p>
                <h2 id="restaurant-sales-modal-title">{selectedDay.dateLabel}</h2>
              </div>
              <button
                type="button"
                className="restaurant-sales-modal-close"
                onClick={closeSalesModal}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <p className="restaurant-sales-modal-description">
              Save the completed sales for this date as an Excel spreadsheet.
            </p>

            <button
              className="button button-primary restaurant-sales-export"
              type="button"
              onClick={() => exportDailySales(selectedDay)}
            >
              Save as XLSX
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
