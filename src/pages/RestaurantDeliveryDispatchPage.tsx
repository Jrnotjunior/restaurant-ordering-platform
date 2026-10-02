import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabaseClient';

type ReadyOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  total: number;
  readyAt: string;
  pickupMethod: 'customer' | 'third_party_courier' | null;
  orderType: 'delivery' | 'pickup' | 'dine_in';
};

type Rider = {
  id: string;
  name: string;
  mobileNumber: string;
  status: 'available' | 'delivering';
  activeDeliveries: number;
  deliveredToday: number;
};

type OrderRow = {
  id: string;
  order_number: string;
  customer_name: string;
  delivery_address: string | null;
  delivery_barangay: string | null;
  notes: string | null;
  total: number | string;
  created_at: string;
  pickup_method: 'customer' | 'third_party_courier' | null;
  order_type: 'delivery' | 'pickup' | 'dine_in';
};

type RiderRow = {
  id: string;
  name: string;
  mobile_number: string;
};

type AssignmentRow = {
  rider_id: string;
  status: 'assigned' | 'delivering' | 'delivered' | 'cancelled';
  assigned_at: string;
  delivered_at: string | null;
};

type Props = { restaurantId: string };

function formatReadyTime(value: string) {
  return new Intl.DateTimeFormat('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function todayStartIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export function RestaurantDeliveryDispatchPage({ restaurantId }: Props) {
  const [orders, setOrders] = useState<ReadyOrder[]>([]);
  const [pickupOrders, setPickupOrders] = useState<ReadyOrder[]>([]);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ReadyOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');

  async function loadDispatchData() {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      setRealtimeStatus('error');
      return;
    }

    setError('');

    try {
      const [orderResult, riderResult, assignmentResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id,order_number,customer_name,delivery_address,delivery_barangay,notes,total,created_at,pickup_method,order_type,rider_id')
          .eq('restaurant_id', restaurantId)
          .in('order_type', ['delivery', 'dine_in'])
          .eq('status', 'ready')
          .is('rider_id', null)
          .order('created_at', { ascending: true }),
        supabase
          .from('restaurant_riders')
          .select('id,name,mobile_number')
          .eq('restaurant_id', restaurantId)
          .order('name', { ascending: true }),
        supabase
          .from('delivery_assignments')
          .select('rider_id,status,assigned_at,delivered_at')
          .eq('restaurant_id', restaurantId),
      ]);

      if (orderResult.error) throw orderResult.error;
      if (riderResult.error) throw riderResult.error;
      if (assignmentResult.error) throw assignmentResult.error;

      const assignments = (assignmentResult.data ?? []) as AssignmentRow[];
      const activeStatuses = new Set<AssignmentRow['status']>(['assigned', 'delivering']);
      const startOfToday = todayStartIso();
      const activeByRider = new Map<string, number>();
      const deliveringByRider = new Map<string, number>();
      const deliveredTodayByRider = new Map<string, number>();

      for (const assignment of assignments) {
        if (activeStatuses.has(assignment.status)) {
          activeByRider.set(assignment.rider_id, (activeByRider.get(assignment.rider_id) ?? 0) + 1);
        }
        if (assignment.status === 'delivering') {
          deliveringByRider.set(assignment.rider_id, (deliveringByRider.get(assignment.rider_id) ?? 0) + 1);
        }
        if (assignment.status === 'delivered' && assignment.delivered_at && assignment.delivered_at >= startOfToday) {
          deliveredTodayByRider.set(assignment.rider_id, (deliveredTodayByRider.get(assignment.rider_id) ?? 0) + 1);
        }
      }

      const mapOrder = (order: OrderRow): ReadyOrder => ({
        id: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        address: order.delivery_address ?? order.delivery_barangay ?? 'Pickup at restaurant',
        total: Number(order.total),
        readyAt: formatReadyTime(order.created_at),
        pickupMethod: order.pickup_method,
        orderType: order.order_type,
      });
      setOrders(((orderResult.data ?? []) as OrderRow[]).map(mapOrder));

      const pickupResult = await supabase
        .from('orders')
        .select('id,order_number,customer_name,delivery_address,delivery_barangay,notes,total,created_at,pickup_method,order_type')
        .eq('restaurant_id', restaurantId)
        .in('order_type', ['pickup', 'dine_in'])
        .eq('status', 'ready')
        .order('created_at', { ascending: true });
      if (pickupResult.error) throw pickupResult.error;
      setPickupOrders(((pickupResult.data ?? []) as OrderRow[]).map(mapOrder));

      setRiders(((riderResult.data ?? []) as RiderRow[]).map((rider) => {
        const activeDeliveries = activeByRider.get(rider.id) ?? 0;
        const activeDelivering = deliveringByRider.get(rider.id) ?? 0;
        return {
          id: rider.id,
          name: rider.name,
          mobileNumber: rider.mobile_number,
          status: activeDelivering > 0 ? 'delivering' : 'available',
          activeDeliveries,
          deliveredToday: deliveredTodayByRider.get(rider.id) ?? 0,
        };
      }));
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_riders', filter: `restaurant_id=eq.${restaurantId}` }, () => {
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

  const availableOrders = useMemo(() => orders, [orders]);

  const statusLabel = (status: Rider['status']) => ({
    available: 'Available',
    delivering: 'Out delivering',
  }[status]);

  async function assignOrder(rider: Rider) {
    if (!supabase || !selectedOrder || assigning) return;
    const canAssign = rider.status === 'available';
    if (!canAssign) return;

    setAssigning(true);
    setError('');
    setMessage('');

    try {
      const { error: assignmentError } = await supabase
        .from('delivery_assignments')
        .insert({
          order_id: selectedOrder.id,
          rider_id: rider.id,
          restaurant_id: restaurantId,
          status: 'assigned',
        });
      if (assignmentError) throw assignmentError;

      const { data: updatedOrder, error: orderError } = await supabase
        .from('orders')
        .update({
          rider_id: rider.id,
          delivery_status: 'assigned',
          rider_assigned_at: new Date().toISOString(),
        })
        .eq('id', selectedOrder.id)
        .eq('restaurant_id', restaurantId)
        .or('delivery_status.eq.unassigned,delivery_status.is.null')
        .select('id')
        .maybeSingle();

      if (orderError) {
        await supabase.from('delivery_assignments').delete().eq('order_id', selectedOrder.id).eq('rider_id', rider.id).eq('status', 'assigned');
        throw orderError;
      }

      if (!updatedOrder) {
        await supabase.from('delivery_assignments').delete().eq('order_id', selectedOrder.id).eq('rider_id', rider.id).eq('status', 'assigned');
        throw new Error('The order could not be updated for rider assignment. Please refresh and try again.');
      }

      setSelectedOrder(null);
      setMessage(`${selectedOrder.orderNumber} assigned to ${rider.name}.`);
      await loadDispatchData();
    } catch (assignError) {
      setError(assignError instanceof Error ? assignError.message : 'Unable to assign this delivery.');
    } finally {
      setAssigning(false);
    }
  }

  async function completePickup(order: ReadyOrder) {
    if (!supabase || assigning) return;
    setAssigning(true);
    setError('');
    setMessage('');
    try {
      const { error: orderError } = await supabase
        .from('orders')
        .update({ status: 'completed' })
        .eq('id', order.id)
        .eq('restaurant_id', restaurantId)
        .in('order_type', ['pickup', 'dine_in'])
        .eq('status', 'ready');
      if (orderError) throw orderError;
      setMessage(order.orderNumber + ' marked as handed off.');
      await loadDispatchData();
    } catch (pickupError) {
      setError(pickupError instanceof Error ? pickupError.message : 'Unable to complete this pickup.');
    } finally {
      setAssigning(false);
    }
  }

  return (
    <section className="restaurant-dispatch-page">
      <header className="restaurant-dispatch-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Dispatch</h1>
          <p>Handle in-house deliveries and customer pickup handoffs.</p>
        </div>
        <span className={`restaurant-dashboard-live-status is-${realtimeStatus}`}>
          <span className="restaurant-dashboard-live-dot" />
          {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </header>

      {message ? <div className="restaurant-dispatch-message" role="status">{message}</div> : null}
      {error ? <div className="restaurant-dispatch-message" role="alert">{error}</div> : null}

      <main className="restaurant-dispatch-workflow">
        <section className="restaurant-dispatch-card restaurant-dispatch-ready-card">
          <div className="restaurant-dispatch-card-heading">
            <div>
              <p className="restaurant-dispatch-label">In-house delivery</p>
              <h2>Orders waiting for a rider</h2>
            </div>
            <span className="restaurant-dispatch-count">{availableOrders.length}</span>
          </div>

          <div className="restaurant-dispatch-order-list">
            {loading ? (
              <div className="restaurant-dispatch-empty">Loading ready orders…</div>
            ) : availableOrders.length === 0 ? (
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
                <button className="restaurant-dispatch-assign-button" type="button" onClick={() => { setSelectedOrder(order); setMessage(''); setError(''); }}>
                  Assign to Rider
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="restaurant-dispatch-card restaurant-dispatch-ready-card">
          <div className="restaurant-dispatch-card-heading">
            <div>
              <p className="restaurant-dispatch-label">Handoff</p>
              <h2>Customer, courier & dine-in orders</h2>
            </div>
            <span className="restaurant-dispatch-count">{pickupOrders.length}</span>
          </div>
          <div className="restaurant-dispatch-order-list">
            {pickupOrders.length === 0 ? (
              <div className="restaurant-dispatch-empty">There are no ready pickup orders waiting for handoff.</div>
            ) : pickupOrders.map((order) => (
              <article className="restaurant-dispatch-order" key={order.id}>
                <div className="restaurant-dispatch-order-main">
                  <div className="restaurant-dispatch-order-top">
                    <strong>{order.orderNumber}</strong>
                    <strong>₱{order.total.toFixed(2)}</strong>
                  </div>
                  <span>{order.customerName}</span>
                  <span className="restaurant-dispatch-address">
                    {order.orderType === 'dine_in'
                      ? 'Dine-in order'
                      : order.pickupMethod === 'third_party_courier'
                        ? 'Customer courier pickup'
                        : 'Customer pickup'}
                  </span>
                  <small>Ready at {order.readyAt}</small>
                </div>
                <button className="restaurant-dispatch-assign-button" type="button" disabled={assigning} onClick={() => void completePickup(order)}>
                  {order.orderType === 'dine_in'
                    ? 'Confirm Served'
                    : order.pickupMethod === 'third_party_courier'
                      ? 'Mark Handed to Courier'
                      : 'Confirm Pickup'}
                </button>
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
                      {assigning ? 'Assigning…' : canAssign ? 'Assign' : rider.status === 'delivering' ? 'Currently delivering' : 'Unavailable'}
                    </button>
                  </article>
                );
              })}

              {!riders.length ? (
                <div className="restaurant-dispatch-empty">No riders are currently available to view.</div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
