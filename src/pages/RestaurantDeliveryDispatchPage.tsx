import { useMemo, useState } from 'react';

type ReadyOrder = { id: string; orderNumber: string; customerName: string; address: string; total: number; readyAt: string };
type Rider = { id: string; name: string; status: 'available' | 'delivering' | 'returning' | 'offline'; activeDeliveries: number; deliveredToday: number; scope: string[] };
type DeliveryBatch = { id: string; riderId: string; orderIds: string[] };

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [batches, setBatches] = useState<DeliveryBatch[]>([]);
  const [message, setMessage] = useState('');
  const availableOrders = useMemo(() => previewOrders.filter((order) => !batches.some((batch) => batch.orderIds.includes(order.id))), [batches]);
  const orderById = (id: string) => previewOrders.find((order) => order.id === id)!;
  const selectedOrders = selectedIds.map(orderById);
  const selectedAreas = selectedOrders.map((order) => order.address.split(',')[0].trim());
  const riderMatches = previewRiders.map((rider) => ({ ...rider, matches: selectedAreas.filter((area) => rider.scope.includes(area)).length }));
  const statusLabel = (status: Rider['status']) => ({ available: 'At restaurant', delivering: 'Out delivering', returning: 'Returning to restaurant', offline: 'Offline' }[status]);

  function toggleOrder(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setMessage('');
  }

  function createBatch() {
    if (!selectedRiderId || selectedIds.length === 0) { setMessage('Select at least one ready order and a rider.'); return; }
    const nextNumber = batches.length + 1;
    setBatches((current) => [...current, { id: 'B00' + nextNumber, riderId: selectedRiderId, orderIds: selectedIds }]);
    setSelectedIds([]); setSelectedRiderId(''); setMessage('Delivery batch created in this UI preview.');
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
          <p>Select ready orders, choose a rider, and send them as one delivery batch.</p>
        </div>
      </header>

      {message && <div className="restaurant-dispatch-message" role="status">{message}</div>}

      <main className="restaurant-dispatch-workflow">
        <section className="restaurant-dispatch-card restaurant-dispatch-ready-card">
          <div className="restaurant-dispatch-card-heading">
            <div>
              <p className="restaurant-dispatch-label">Step 1</p>
              <h2>Select ready orders</h2>
              <p className="restaurant-dispatch-helper">Choose one or more orders that should go with the same rider.</p>
            </div>
            <span className="restaurant-dispatch-count">{availableOrders.length}</span>
          </div>

          <div className="restaurant-dispatch-order-list">
            {availableOrders.length === 0 ? (
              <div className="restaurant-dispatch-empty">All ready orders are currently assigned to a delivery batch.</div>
            ) : availableOrders.map((order) => {
              const selected = selectedIds.includes(order.id);
              return (
                <label className={'restaurant-dispatch-order' + (selected ? ' is-selected' : '')} key={order.id}>
                  <input type="checkbox" checked={selected} onChange={() => toggleOrder(order.id)} />
                  <span className="restaurant-dispatch-order-main">
                    <span className="restaurant-dispatch-order-top"><strong>{order.orderNumber}</strong><strong>₱{order.total.toFixed(2)}</strong></span>
                    <span>{order.customerName}</span>
                    <span className="restaurant-dispatch-address">{order.address}</span>
                    <small>Ready at {order.readyAt}</small>
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        <section className="restaurant-dispatch-card restaurant-dispatch-riders-card">
          <div className="restaurant-dispatch-card-heading">
            <div>
              <p className="restaurant-dispatch-label">Rider availability</p>
              <h2>Riders</h2>
              <p className="restaurant-dispatch-helper">See who is available, who is delivering, and which destinations are in each rider's restaurant-assigned scope.</p>
            </div>
          </div>
          <div className="restaurant-dispatch-rider-list">
            {riderMatches.map((rider) => (
              <article className="restaurant-dispatch-rider" key={rider.id}>
                <div className="restaurant-dispatch-rider-main">
                  <div className="restaurant-dispatch-rider-heading">
                    <strong>{rider.name}</strong>
                    <span className={'restaurant-dispatch-status is-' + rider.status}>● {statusLabel(rider.status)}</span>
                  </div>
                  <div className="restaurant-dispatch-rider-stats">
                    <span>{rider.activeDeliveries} active</span>
                    <span>{rider.deliveredToday} delivered today</span>
                  </div>
                  <div className="restaurant-dispatch-rider-scope"><strong>Delivery scope:</strong> {rider.scope.join(' · ')}</div>
                  {selectedIds.length > 0 && (
                    <div className={'restaurant-dispatch-match ' + (rider.matches === selectedAreas.length ? 'is-match' : '')}>
                      {rider.matches === selectedAreas.length ? '✓ Covers all selected destinations' : rider.matches + ' of ' + selectedAreas.length + ' selected destinations in scope'}
                    </div>
                  )}
                </div>
                <button className="restaurant-dispatch-rider-select" type="button" disabled={!selectedIds.length || rider.status === 'offline' || rider.matches !== selectedAreas.length} onClick={() => setSelectedRiderId(rider.id)}>
                  {selectedRiderId === rider.id ? 'Selected' : 'Assign'}
                </button>
              </article>
            ))}
          </div>


        </section>

        <section className="restaurant-dispatch-card restaurant-dispatch-active-card">
          <div className="restaurant-dispatch-card-heading">
            <div>
              <p className="restaurant-dispatch-label">After sending</p>
              <h2>Active delivery batches</h2>
            </div>
            <span className="restaurant-dispatch-count">{batches.length}</span>
          </div>

          {batches.length === 0 ? (
            <div className="restaurant-dispatch-empty">Batches you send to riders will appear here.</div>
          ) : (
            <div className="restaurant-dispatch-batches">
              {batches.map((batch) => {
                const rider = previewRiders.find((item) => item.id === batch.riderId);
                return (
                  <article className="restaurant-dispatch-batch" key={batch.id}>
                    <div className="restaurant-dispatch-batch-heading">
                      <div>
                        <strong>{rider ? rider.name : 'Unknown rider'}</strong>
                        <span>{batch.orderIds.length} order{batch.orderIds.length === 1 ? '' : 's'} · Assigned</span>
                      </div>
                      <button type="button" onClick={() => { setBatches((current) => current.filter((item) => item.id !== batch.id)); setMessage('Batch released in this UI preview.'); }}>Release</button>
                    </div>
                    <ol>
                      {batch.orderIds.map((id) => {
                        const order = orderById(id);
                        return <li key={id}><span><strong>{order.orderNumber}</strong></span><span>{order.address}</span></li>;
                      })}
                    </ol>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </section>
  );
}