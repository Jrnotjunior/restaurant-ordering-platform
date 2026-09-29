import { useMemo, useState } from 'react';

type ReadyOrder = { id: string; orderNumber: string; customerName: string; address: string; total: number; readyAt: string };
type Rider = {
  id: string;
  name: string;
  status: 'available' | 'delivering' | 'returning' | 'offline';
  activeDeliveries: number;
  deliveredToday: number;
  scope: string[];
};

const previewOrders: ReadyOrder[] = [
  { id: 'order-1001', orderNumber: '#1001', customerName: 'Juan Dela Cruz', address: 'Dalandanan, Valenzuela City', total: 350, readyAt: '10:12 AM' },
  { id: 'order-1002', orderNumber: '#1002', customerName: 'Maria Santos', address: 'Malinta, Valenzuela City', total: 420, readyAt: '10:18 AM' },
  { id: 'order-1003', orderNumber: '#1003', customerName: 'Carlo Reyes', address: 'Arkong Bato, Valenzuela City', total: 285, readyAt: '10:21 AM' },
  { id: 'order-1004', orderNumber: '#1004', customerName: 'Ana Garcia', address: 'Gen. T. de Leon, Valenzuela City', total: 510, readyAt: '10:24 AM' },
];

const previewRiders: Rider[] = [
  { id: 'rider-john', name: 'John Santos', status: 'available', activeDeliveries: 0, deliveredToday: 8, scope: ['Dalandanan', 'Malinta', 'Arkong Bato'] },
  { id: 'rider-mark', name: 'Mark Reyes', status: 'delivering', activeDeliveries: 1, deliveredToday: 5, scope: ['Gen. T. de Leon', 'Karuhatan', 'Paso de Blas'] },
];

export function RestaurantDeliveryDispatchPage() {
  const [assignedOrderIds, setAssignedOrderIds] = useState<string[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ReadyOrder | null>(null);
  const [message, setMessage] = useState('');

  const availableOrders = useMemo(
    () => previewOrders.filter((order) => !assignedOrderIds.includes(order.id)),
    [assignedOrderIds],
  );

  const statusLabel = (status: Rider['status']) => ({
    available: 'At restaurant',
    delivering: 'Out delivering',
    returning: 'Returning to restaurant',
    offline: 'Offline',
  }[status]);

  const orderArea = selectedOrder?.address.split(',')[0].trim() ?? '';

  function assignOrder(rider: Rider) {
    if (!selectedOrder || rider.status !== 'available') return;
    setAssignedOrderIds((current) => [...current, selectedOrder.id]);
    setSelectedOrder(null);
    setMessage(selectedOrder.orderNumber + ' assigned to ' + rider.name + '.');
  }

  return (
    <section className="restaurant-dispatch-page">
      <div className="restaurant-dispatch-preview-banner">
        <strong>UI PREVIEW</strong>
        <span>No Supabase data is changed. This screen prepares the dispatcher workflow before live assignment is connected.</span>
      </div>

      <header className="restaurant-dispatch-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Delivery Dispatch</h1>
          <p>Ready orders that still need a rider assignment.</p>
        </div>
      </header>

      {message && <div className="restaurant-dispatch-message" role="status">{message}</div>}

      <main className="restaurant-dispatch-workflow">
        <section className="restaurant-dispatch-card restaurant-dispatch-ready-card">
          <div className="restaurant-dispatch-card-heading">
            <div>
              <p className="restaurant-dispatch-label">Ready for delivery</p>
              <h2>Orders waiting for a rider</h2>
            </div>
            <span className="restaurant-dispatch-count">{availableOrders.length}</span>
          </div>

          <div className="restaurant-dispatch-order-list">
            {availableOrders.length === 0 ? (
              <div className="restaurant-dispatch-empty">There are no ready orders waiting for rider assignment.</div>
            ) : availableOrders.map((order) => (
              <article className="restaurant-dispatch-order" key={order.id}>
                <div className="restaurant-dispatch-order-main">
                  <div className="restaurant-dispatch-order-top">
                    <strong>{order.orderNumber}</strong>
                    <strong>₱{order.total.toFixed(2)}</strong>
                  </div>
                  <span>{order.customerName}</span>
                  <span className="restaurant-dispatch-address">{order.address}</span>
                  <small>Ready at {order.readyAt}</small>
                </div>
                <button
                  className="restaurant-dispatch-assign-button"
                  type="button"
                  onClick={() => { setSelectedOrder(order); setMessage(''); }}
                >
                  Assign to Rider
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>

      {selectedOrder && (
        <div className="restaurant-dispatch-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSelectedOrder(null);
        }}>
          <section className="restaurant-dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-modal-title">
            <div className="restaurant-dispatch-modal-header">
              <div>
                <p className="restaurant-dispatch-label">Assign delivery</p>
                <h2 id="dispatch-modal-title">{selectedOrder.orderNumber} · {selectedOrder.customerName}</h2>
                <p>{selectedOrder.address}</p>
              </div>
              <button type="button" className="restaurant-dispatch-modal-close" onClick={() => setSelectedOrder(null)} aria-label="Close">×</button>
            </div>

            <div className="restaurant-dispatch-modal-order">
              <span>Delivery destination</span>
              <strong>{orderArea}</strong>
            </div>

            <div className="restaurant-dispatch-modal-riders">
              {previewRiders.map((rider) => {
                const inScope = rider.scope.includes(orderArea);
                const canAssign = rider.status === 'available' && inScope;
                return (
                  <article className="restaurant-dispatch-modal-rider" key={rider.id}>
                    <div>
                      <div className="restaurant-dispatch-rider-heading">
                        <strong>{rider.name}</strong>
                        <span className={'restaurant-dispatch-status is-' + rider.status}>● {statusLabel(rider.status)}</span>
                      </div>
                      <div className="restaurant-dispatch-rider-stats">
                        <span>{rider.activeDeliveries} active</span>
                        <span>{rider.deliveredToday} delivered today</span>
                      </div>
                      <div className="restaurant-dispatch-rider-scope">
                        <strong>Delivery scope:</strong> {rider.scope.join(' · ')}
                      </div>
                      <div className={'restaurant-dispatch-match ' + (inScope ? 'is-match' : '')}>
                        {inScope ? '✓ Destination is within this rider’s scope' : 'Destination is outside this rider’s scope'}
                      </div>
                    </div>
                    <button
                      className="restaurant-dispatch-rider-select"
                      type="button"
                      disabled={!canAssign}
                      onClick={() => assignOrder(rider)}
                    >
                      {rider.status === 'available' && inScope ? 'Assign' : rider.status === 'delivering' ? 'Currently delivering' : rider.status === 'returning' ? 'Returning' : 'Unavailable'}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
