import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { getRestaurantOrders, getRestaurantSales, type RestaurantOrder } from '../services/restaurantOrderRepository';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string; role?: 'owner' | 'cashier' };

type DailySales = {
  dateKey: string;
  dateLabel: string;
  orders: RestaurantOrder[];
  total: number;
  paymongoFees: number;
  netAfterPaymongoFees: number;
  recordedPaymongoFees: number;
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

export function RestaurantSalesPage({ restaurantId, role = 'owner' }: Props) {
  const [orders, setOrders] = useState<RestaurantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
  const [searchDate, setSearchDate] = useState('');

  async function loadOrders() {
    try {
      setError('');
      setOrders(role === 'owner'
        ? await getRestaurantSales(restaurantId)
        : await getRestaurantOrders(restaurantId));
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
        paymongoFees: dayOrders.reduce((sum, order) => sum + (order.paymongoFee ?? 0), 0),
        netAfterPaymongoFees: dayOrders.reduce(
          (sum, order) => sum + order.total - (order.paymongoFee ?? 0),
          0,
        ),
        recordedPaymongoFees: dayOrders.filter((order) => order.paymongoFee != null).length,
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

  const salesSummary = useMemo(() => ({
    total: completedOrders.reduce((sum, order) => sum + order.total, 0),
    paymongoFees: completedOrders.reduce((sum, order) => sum + (order.paymongoFee ?? 0), 0),
    netAfterPaymongoFees: completedOrders.reduce(
      (sum, order) => sum + order.total - (order.paymongoFee ?? 0),
      0,
    ),
    recordedPaymongoFees: completedOrders.filter((order) => order.paymongoFee != null).length,
    onlineOrders: completedOrders.filter((order) => order.paymentMethod === 'gcash').length,
  }), [completedOrders]);

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
      'PayMongo Payment Method': order.paymongoPaymentMethod ?? '',
      'PayMongo Fee': order.paymongoFee ?? '',
      'Net After PayMongo Fee': order.paymongoFee == null ? '' : order.total - order.paymongoFee,
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['Daily Sales Report'],
      ['Date', day.dateLabel],
      ['Total Sales', day.total],
      ['PayMongo Fees', day.paymongoFees],
      ['Net After PayMongo Fees', day.netAfterPaymongoFees],
      ['PayMongo Fees Recorded', day.recordedPaymongoFees],
      ['Completed Orders', day.orders.length],
      [],
    ]);
    XLSX.utils.sheet_add_json(worksheet, rows, { origin: 'A9' });
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
    <section className="restaurant-page restaurant-sales-page">
      <div className="restaurant-sales-card">
        <div className="restaurant-sales-card-header">
          <div>
            <h1>Sales Overview</h1>
            <p>
              Your restaurant's completed sales are shown here. Click a date to view the daily sales report.
            </p>
          </div>
          <span className={`restaurant-dashboard-live-status is-${realtimeStatus}`}>
            <span className="restaurant-dashboard-live-dot" />
            {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        </div>

        {error && <div className="restaurant-sales-error" role="alert">{error}</div>}

        {!loading && dailySales.length > 0 && role === 'owner' && (
          <div className="restaurant-sales-summary" aria-label="Sales summary">
            <div className="restaurant-sales-summary-item">
              <small>Total sales</small>
              <strong>₱ {salesSummary.total.toFixed(2)}</strong>
            </div>
            <div className="restaurant-sales-summary-item">
              <small>PayMongo fees</small>
              <strong>₱ {salesSummary.paymongoFees.toFixed(2)}</strong>
            </div>
            <div className="restaurant-sales-summary-item">
              <small>Net after PayMongo fees</small>
              <strong>₱ {salesSummary.netAfterPaymongoFees.toFixed(2)}</strong>
            </div>
            <div className="restaurant-sales-summary-item">
              <small>Online orders</small>
              <strong>{salesSummary.onlineOrders}</strong>
            </div>
          </div>
        )}

        {loading ? (
          <div className="restaurant-sales-empty">Loading sales…</div>
        ) : dailySales.length === 0 ? (
          <div className="restaurant-sales-empty">No completed sales yet.</div>
        ) : (
          <>
            <div className="restaurant-sales-search">
              <label htmlFor="restaurant-sales-date-search">Search date</label>
              <div className="restaurant-sales-search-input-wrap">
                <input
                  id="restaurant-sales-date-search"
                  type="search"
                  value={searchDate}
                  onChange={(event) => setSearchDate(event.target.value)}
                  placeholder="Search by date, e.g. September 27 or 2026-09-27"
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
                    <span className="restaurant-sales-day-main">
                      <span className="restaurant-sales-day-label">Sales date</span>
                      <strong>{day.dateLabel}</strong>
                    </span>
                    <span className="restaurant-sales-day-stats">
                      <span>
                        <small>Total sales</small>
                        <strong>₱ {day.total.toFixed(2)}</strong>
                      </span>
                      {role === 'owner' && (
                        <span>
                          <small>PayMongo fees</small>
                          <strong>₱ {day.paymongoFees.toFixed(2)}</strong>
                        </span>
                      )}
                      {role === 'owner' && (
                        <span>
                          <small>Net after fees</small>
                          <strong>₱ {day.netAfterPaymongoFees.toFixed(2)}</strong>
                        </span>
                      )}
                      <span>
                        <small>Completed orders</small>
                        <strong>{day.orders.length}</strong>
                      </span>
                    </span>
                    <span className="restaurant-sales-day-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="restaurant-sales-search-empty">
                No sales found for “{searchDate}”.
              </div>
            )}
          </>
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

              <div className="restaurant-sales-modal-financials">
                <div>
                  <small>Total sales</small>
                  <strong>₱ {selectedDay.total.toFixed(2)}</strong>
                </div>
                <div>
                  <small>PayMongo fees</small>
                  <strong>₱ {selectedDay.paymongoFees.toFixed(2)}</strong>
                </div>
                <div>
                  <small>Net after fees</small>
                  <strong>₱ {selectedDay.netAfterPaymongoFees.toFixed(2)}</strong>
                </div>
              </div>

              <p className="restaurant-sales-modal-description">
                PayMongo fees are the actual processing fees returned by PayMongo for recorded online payments.
                {selectedDay.recordedPaymongoFees < selectedDay.orders.filter((order) => order.paymentMethod === 'gcash').length
                  ? ' Some older online orders do not have a recorded fee and are not deducted from the net figure.'
                  : ''}
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
      </div>
    </section>
  );
}
