import { useMemo, useState } from 'react';

type ReadyOrder = { id: string; orderNumber: string; customerName: string; address: string; total: number; readyAt: string };
type Rider = { id: string; name: string; activeDeliveries: number };
type DeliveryBatch = { id: string; riderId: string; orderIds: string[] };

const previewOrders: ReadyOrder[] = [
  { id: 'order-1001', orderNumber: '#1001', customerName: 'Juan Dela Cruz', address: 'Dalandanan, Valenzuela City', total: 350, readyAt: '10:12 AM' },
  { id: 'order-1002', orderNumber: '#1002', customerName: 'Maria Santos', address: 'Malinta, Valenzuela City', total: 420, readyAt: '10:18 AM' },
  { id: 'order-1003', orderNumber: '#1003', customerName: 'Carlo Reyes', address: 'Arkong Bato, Valenzuela City', total: 285, readyAt: '10:21 AM' },
  { id: 'order-1004', orderNumber: '#1004', customerName: 'Ana Garcia', address: 'Gen. T. de Leon, Valenzuela City', total: 510, readyAt: '10:24 AM' },
];

const previewRiders: Rider[] = [
  { id: 'rider-john', name: 'John Santos', activeDeliveries: 0 },
  { id: 'rider-mark', name: 'Mark Reyes', activeDeliveries: 1 },
];

export function RestaurantDeliveryDispatchPage() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState('');
  const [batches, setBatches] = useState<DeliveryBatch[]>([]);
  const [message, setMessage] = useState('');
  const availableOrders = useMemo(() => previewOrders.filter((order) => !batches.some((batch) => batch.orderIds.includes(order.id))), [batches]);
  const orderById = (id: string) => previewOrders.find((order) => order.id === id)!;

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
      <div className="restaurant-dispatch-preview-banner"><strong>UI PREVIEW</strong><span>No Supabase data is changed. This screen prepares the dispatcher workflow before live assignment is connected.</span></div>
      <header className="restaurant-dispatch-header">
        <div><p className="eyebrow">Restaurant operations</p><h1>Delivery Dispatch</h1><p>Group ready delivery orders into batches and send each batch to an in-house rider.</p></div>
        <div className="restaurant-dispatch-rule"><strong>Dispatcher decides the grouping</strong><span>The system shows destinations; it does not automatically choose the route.</span></div>
      </header>
      {message && <div className="restaurant-dispatch-message" role="status">{message}</div>}
      <div className="restaurant-dispatch-layout">
        <main>
          <section className="restaurant-dispatch-card">
            <div className="restaurant-dispatch-card-heading"><div><p className="restaurant-dispatch-label">Ready for delivery</p><h2>Choose orders to group</h2></div><span className="restaurant-dispatch-count">{availableOrders.length}</span></div>
            <div className="restaurant-dispatch-order-list">
              {availableOrders.length === 0 ? <div className="restaurant-dispatch-empty">All ready orders are currently assigned to a delivery batch.</div> : availableOrders.map((order) => {
                const selected = selectedIds.includes(order.id);
                return <label className={'restaurant-dispatch-order' + (selected ? ' is-selected' : '')} key={order.id}>
                  <input type="checkbox" checked={selected} onChange={() => toggleOrder(order.id)} />
                  <span className="restaurant-dispatch-order-main"><span className="restaurant-dispatch-order-top"><strong>{order.orderNumber}</strong><strong>₱{order.total.toFixed(2)}</strong></span><span>{order.customerName}</span><span className="restaurant-dispatch-address">{order.address}</span><small>Ready at {order.readyAt}</small></span>
                </label>;
              })}
            </div>
          </section>
          <section className="restaurant-dispatch-card">
            <div className="restaurant-dispatch-card-heading"><div><p className="restaurant-dispatch-label">Selected orders</p><h2>{selectedIds.length} order{selectedIds.length === 1 ? '' : 's'} in new batch</h2></div></div>
            {selectedIds.length === 0 ? <div className="restaurant-dispatch-empty">Select orders above to build a delivery batch.</div> : <ol className="restaurant-dispatch-selection-list">
              {selectedIds.map((id, index) => { const order = orderById(id); return <li key={id}><span className="restaurant-dispatch-sequence">{index + 1}</span><span><strong>{order.orderNumber}</strong><small>{order.address}</small></span><button type="button" onClick={() => toggleOrder(id)} aria-label={'Remove ' + order.orderNumber + ' from batch'}>×</button></li>; })}
            </ol>}
          </section>
        </main>
        <aside>
          <section className="restaurant-dispatch-card restaurant-dispatch-assignment-card">
            <p className="restaurant-dispatch-label">Assign batch</p><h2>Select rider</h2><p className="restaurant-dispatch-helper">Only active in-house riders for this restaurant appear here.</p>
            <select value={selectedRiderId} onChange={(event) => setSelectedRiderId(event.target.value)} aria-label="Select delivery rider"><option value="">Choose a rider</option>{previewRiders.map((rider) => <option key={rider.id} value={rider.id}>{rider.name} · {rider.activeDeliveries} active</option>)}</select>
            <button className="button button-primary restaurant-dispatch-send" type="button" onClick={createBatch}>Send Batch to Rider</button>
            <p className="restaurant-dispatch-note">The rider cannot accept or reject the batch. Assignment is made by the restaurant dispatcher.</p>
          </section>
          <section className="restaurant-dispatch-card">
            <div className="restaurant-dispatch-card-heading"><div><p className="restaurant-dispatch-label">Active batches</p><h2>Rider routes</h2></div></div>
            {batches.length === 0 ? <div className="restaurant-dispatch-empty">No batches created yet.</div> : <div className="restaurant-dispatch-batches">{batches.map((batch) => { const rider = previewRiders.find((item) => item.id === batch.riderId); return <article className="restaurant-dispatch-batch" key={batch.id}><div className="restaurant-dispatch-batch-heading"><div><strong>Delivery Batch #{batch.id.replace('B', '')}</strong><span>{rider ? rider.name : 'Unknown rider'}</span></div><button type="button" onClick={() => { setBatches((current) => current.filter((item) => item.id !== batch.id)); setMessage('Batch released in this UI preview.'); }}>Release</button></div><ol>{batch.orderIds.map((id) => { const order = orderById(id); return <li key={id}><span>{order.orderNumber}</span><span>{order.address}</span></li>; })}</ol></article>; })}</div>}
          </section>
        </aside>
      </div>
    </section>
  );
}