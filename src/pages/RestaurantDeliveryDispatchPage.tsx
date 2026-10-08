import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../services/supabaseClient';
import { assignDelivery, completeDispatchHandoff, getDispatchData, type ReadyOrder, type Rider } from '../modules/dispatch/dispatchService';

type Props = { restaurantId: string; role?: 'owner' | 'dispatcher' };
type DispatchTab = 'dine_in' | 'delivery' | 'pickup';

export function RestaurantDeliveryDispatchPage({ restaurantId, role = 'owner' }: Props) {
  const [orders, setOrders] = useState<ReadyOrder[]>([]);
  const [activeTab, setActiveTab] = useState<DispatchTab>('delivery');
  const [riders, setRiders] = useState<Rider[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ReadyOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [assigningRiderId, setAssigningRiderId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [dispatchTabsSlot, setDispatchTabsSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setDispatchTabsSlot(document.getElementById('restaurant-dispatch-tabs-slot'));
  }, []);

  async function loadDispatchData() {
    try {
      setError('');
      const data = await getDispatchData(restaurantId);
      setOrders(data.orders);
      setRiders(data.riders);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load delivery dispatch data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void loadDispatchData();

    const client = supabase;
    if (!client) {
      setRealtimeStatus('error');
      return;
    }

    const channel = client
      .channel(`delivery-dispatch:${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, () => {
        void loadDispatchData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_staff', filter: `restaurant_id=eq.${restaurantId}` }, () => {
        void loadDispatchData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments', filter: `restaurant_id=eq.${restaurantId}` }, () => {
        void loadDispatchData();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('error');
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [restaurantId]);

  const deliveryOrders = useMemo(
    () => orders.filter((order) => order.orderType === 'delivery' && order.riderId === null),
    [orders],
  );
  const pickupOrders = useMemo(
    () => orders.filter((order) => order.orderType === 'pickup'),
    [orders],
  );
  const dineInOrders = useMemo(
    () => orders.filter((order) => order.orderType === 'dine_in'),
    [orders],
  );

  const activeOrders = activeTab === 'delivery'
    ? deliveryOrders
    : activeTab === 'pickup'
      ? pickupOrders
      : dineInOrders;

  const statusLabel = (status: Rider['status']) => ({
    available: 'Available',
    busy: 'Has active delivery',
  }[status]);

  async function assignOrder(rider: Rider) {
    if (role !== 'dispatcher' || !selectedOrder || assigning || rider.status !== 'available') return;
    setAssigning(true);
    setAssigningRiderId(rider.id);
    setError('');
    try {
      await assignDelivery(restaurantId, selectedOrder.id, rider.id);
      setSelectedOrder(null);
      await loadDispatchData();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Unable to assign this delivery.');
    } finally {
      setAssigningRiderId(null);
      setAssigning(false);
    }
  }

  async function completePickup(order: ReadyOrder) {
    if (role !== 'dispatcher' || assigning) return;
    setAssigning(true);
    setError('');
    try {
      await completeDispatchHandoff(restaurantId, order.id, order.orderType === 'dine_in' ? 'dine_in' : 'pickup');
      await loadDispatchData();
    } catch (pickupError) {
      setError(pickupError instanceof Error ? pickupError.message : 'Unable to complete this pickup.');
    } finally {
      setAssigning(false);
    }
  }

  return (
    <section className="restaurant-page restaurant-dispatch-page">
            {role !== 'owner' && <header className="restaurant-page-header">
        <div>
          <p className="eyebrow">Restaurant Operations</p>
          <h1>Dispatch</h1>
          <p>Handle in-house deliveries and customer pickup handoffs.</p>
        </div>
        <span className={`restaurant-dashboard-live-status is-${realtimeStatus}`}>
          <span className="restaurant-dashboard-live-dot" />
          {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </header>}

      {error ? <div className="restaurant-dispatch-message" role="alert">{error}</div> : null}

      <main className="restaurant-dispatch-workflow">
        {dispatchTabsSlot
          ? createPortal(
              <nav className="restaurant-navigation restaurant-dispatch-tabs" aria-label="Dispatch order type">
                <button
                  type="button"
                  className={'restaurant-navigation-item' + (activeTab === 'delivery' ? ' is-active' : '')}
                  onClick={() => setActiveTab('delivery')}
                >
                  <span>Delivery</span>
                  <span className="restaurant-dispatch-tab-count">{deliveryOrders.length}</span>
                </button>
                <button
                  type="button"
                  className={'restaurant-navigation-item' + (activeTab === 'pickup' ? ' is-active' : '')}
                  onClick={() => setActiveTab('pickup')}
                >
                  <span>Pick Up</span>
                  <span className="restaurant-dispatch-tab-count">{pickupOrders.length}</span>
                </button>
                <button
                  type="button"
                  className={'restaurant-navigation-item' + (activeTab === 'dine_in' ? ' is-active' : '')}
                  onClick={() => setActiveTab('dine_in')}
                >
                  <span>Dine In</span>
                  <span className="restaurant-dispatch-tab-count">{dineInOrders.length}</span>
                </button>
              </nav>,
              dispatchTabsSlot,
            )
          : null}

        <section className="restaurant-panel">
          <div className="restaurant-panel-header">
            <div>
              <p className="restaurant-panel-label">
                {activeTab === 'delivery' ? 'In-house delivery' : activeTab === 'pickup' ? 'Handoff' : 'Table service'}
              </p>
              <h2>
                {activeTab === 'delivery'
                  ? 'Orders waiting for a rider'
                  : activeTab === 'pickup'
                    ? 'Orders ready for pickup'
                    : 'Orders ready to be served'}
              </h2>
            </div>
            <span className="restaurant-panel-count">{activeOrders.length}</span>
          </div>

          <div className="restaurant-list">
            {loading ? (
              <div className="restaurant-list-empty">Loading ready orders…</div>
            ) : activeOrders.length === 0 ? (
              <div className="restaurant-dispatch-empty">
                {activeTab === 'delivery'
                  ? 'There are no ready delivery orders waiting for rider assignment.'
                  : activeTab === 'pickup'
                    ? 'There are no ready pickup orders waiting for handoff.'
                    : 'There are no ready dine-in orders waiting to be served.'}
              </div>
            ) : activeOrders.map((order) => (
              <article className="restaurant-list-item" key={order.id}>
                <div className="restaurant-list-item-main">
                  <div className="restaurant-dispatch-order-heading">
                    <strong>{order.orderNumber}</strong>
                    <strong>₱{order.total.toFixed(2)}</strong>
                  </div>
                  <span>{order.customerName}</span>
                  <span>
                    {activeTab === 'delivery'
                      ? order.address
                      : activeTab === 'pickup'
                        ? order.pickupMethod === 'third_party_courier'
                          ? 'Customer courier pickup'
                          : 'Customer pickup'
                        : 'Dine-in order'}
                  </span>
                  <small>Ready at {order.readyAt}</small>
                </div>
                {role === 'dispatcher' && (activeTab === 'delivery' ? (
                  <button className="button" type="button" onClick={() => { setSelectedOrder(order); setError(''); }}>
                    Assign to Rider
                  </button>
                ) : (
                  <button className="button" type="button" disabled={assigning} onClick={() => void completePickup(order)}>
                    {activeTab === 'dine_in'
                      ? 'Confirm Served'
                      : order.pickupMethod === 'third_party_courier'
                        ? 'Mark Handed to Courier'
                        : 'Confirm Pickup'}
                  </button>
                ))}
              </article>
            ))}
          </div>
        </section>
      </main>

      {selectedOrder ? (
        <div className="restaurant-dispatch-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !assigning) setSelectedOrder(null); }}>
          <section className="restaurant-dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-modal-title">
            <div className="restaurant-dispatch-modal-header">
              <div>
                <p className="restaurant-dispatch-label">Assign delivery</p>
                <h2 id="dispatch-modal-title">{selectedOrder.orderNumber} · {selectedOrder.customerName}</h2>
                <p>{selectedOrder.address}</p>
              </div>
              <button type="button" className="restaurant-dispatch-modal-close" onClick={() => setSelectedOrder(null)} aria-label="Close" disabled={assigning}>×</button>
            </div>

            <div className="restaurant-dispatch-modal-riders">
              {riders.map((rider) => {
                const canAssign = rider.status === 'available';

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
                    </div>
                    <button className="restaurant-dispatch-rider-select" type="button" disabled={!canAssign || assigning} onClick={() => void assignOrder(rider)}>
                      {assigningRiderId === rider.id ? 'Assigning…' : canAssign ? 'Assign' : rider.status === 'busy' ? 'Has active delivery' : 'Unavailable'}
                    </button>
                  </article>
                );
              })}

              {!riders.length ? (
                <div className="restaurant-list-empty">No riders are currently available to view.</div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
