import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../services/supabaseClient';

type ReadyOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  total: number;
  readyAt: string;
};

type Rider = {
  id: string;
  name: string;
  mobileNumber: string;
  status: 'available' | 'delivering';
  activeDeliveries: number;
  deliveredToday: number;
  scope: string[];
};

type OrderRow = {
  id: string;
  order_number: string;
  customer_name: string;
  delivery_address: string | null;
  delivery_barangay: string | null;
  total: number | string;
  created_at: string;
};

type RiderRow = {
  id: string;
  name: string;
  mobile_number: string;
};

type ScopeRow = {
  rider_id: string;
  scope_name: string;
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
      const [orderResult, riderResult, scopeResult, assignmentResult] = await Promise.all([
        supabase
          .from('orders')
          .select('id,order_number,customer_name,delivery_address,delivery_barangay,total,created_at')
          .eq('restaurant_id', restaurantId)
          .eq('order_type', 'delivery')
          .eq('status', 'ready')
          .eq('delivery_status', 'unassigned')
          .order('created_at', { ascending: true }),
        supabase
          .from('restaurant_riders')
          .select('id,name,mobile_number')
          .eq('restaurant_id', restaurantId)
          .order('name', { ascending: true }),
        supabase
          .from('rider_delivery_scopes')
          .select('rider_id,scope_name')
          .order('scope_name', { ascending: true }),
        supabase
          .from('delivery_assignments')
          .select('rider_id,status,assigned_at,delivered_at')
          .eq('restaurant_id', restaurantId),
      ]);

      if (orderResult.error) throw orderResult.error;
      if (riderResult.error) throw riderResult.error;
      if (scopeResult.error) throw scopeResult.error;
      if (assignmentResult.error) throw assignmentResult.error;

      const scopesByRider = new Map<string, string[]>();
      for (const row of (scopeResult.data ?? []) as ScopeRow[]) {
        const scopes = scopesByRider.get(row.rider_id) ?? [];
        scopes.push(row.scope_name);
        scopesByRider.set(row.rider_id, scopes);
      }

      const assignments = (assignmentResult.data ?? []) as AssignmentRow[];
      const activeStatuses = new Set<AssignmentRow['status']>(['assigned', 'delivering']);
      const startOfToday = todayStartIso();
      const activeByRider = new Map<string, number>();
      const deliveredTodayByRider = new Map<string, number>();

      for (const assignment of assignments) {
        if (activeStatuses.has(assignment.status)) {
          activeByRider.set(assignment.rider_id, (activeByRider.get(assignment.rider_id) ?? 0) + 1);
        }
        if (assignment.status === 'delivered' && assignment.delivered_at && assignment.delivered_at >= startOfToday) {
          deliveredTodayByRider.set(assignment.rider_id, (deliveredTodayByRider.get(assignment.rider_id) ?? 0) + 1);
        }
      }

      setOrders(((orderResult.data ?? []) as OrderRow[]).map((order) => ({
        id: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        address: order.delivery_address ?? order.delivery_barangay ?? 'Delivery address not provided',
        total: Number(order.total),
        readyAt: formatReadyTime(order.created_at),
      })));

      setRiders(((riderResult.data ?? []) as RiderRow[]).map((rider) => {
        const activeDeliveries = activeByRider.get(rider.id) ?? 0;
        return {
          id: rider.id,
          name: rider.name,
          mobileNumber: rider.mobile_number,
          status: activeDeliveries > 0 ? 'delivering' : 'available',
          activeDeliveries,
          deliveredToday: deliveredTodayByRider.get(rider.id) ?? 0,
          scope: scopesByRider.get(rider.id) ?? [],
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_delivery_scopes' }, () => {
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

  const orderArea = selectedOrder?.address.split(',')[0].trim() ?? '';

  async function assignOrder(rider: Rider) {
    if (!supabase || !selectedOrder || assigning) return;
    const canAssign = rider.status === 'available' && rider.scope.includes(orderArea);
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

      const { error: orderError } = await supabase
        .from('orders')
        .update({
          rider_id: rider.id,
          delivery_status: 'assigned',
          rider_assigned_at: new Date().toISOString(),
        })
        .eq('id', selectedOrder.id)
        .eq('restaurant_id', restaurantId)
        .eq('delivery_status', 'unassigned');

      if (orderError) {
        await supabase.from('delivery_assignments').delete().eq('order_id', selectedOrder.id).eq('rider_id', rider.id).eq('status', 'assigned');
        throw orderError;
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

  return (
    <section className="restaurant-dispatch-page">
      <header className="restaurant-dispatch-header">
        <div>
          <p className="eyebrow">Restaurant operations</p>
          <h1>Delivery Dispatch</h1>
          <p>Ready orders that still need a rider assignment.</p>
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
              <p className="restaurant-dispatch-label">Ready for delivery</p>
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

            <div className="restaurant-dispatch-modal-order">
              <span>Delivery destination</span>
              <strong>{orderArea}</strong>
            </div>

            <div className="restaurant-dispatch-modal-riders">
              {riders.map((rider) => {
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
                        <strong>Delivery scope:</strong> {rider.scope.length ? rider.scope.join(' · ') : 'Not assigned'}
                      </div>
                      <div className={'restaurant-dispatch-match ' + (inScope ? 'is-match' : '')}>
                        {inScope ? '✓ Destination is within this rider’s scope' : 'Destination is outside this rider’s scope'}
                      </div>
                    </div>
                    <button className="restaurant-dispatch-rider-select" type="button" disabled={!canAssign || assigning} onClick={() => void assignOrder(rider)}>
                      {assigning ? 'Assigning…' : canAssign ? 'Assign' : rider.status === 'delivering' ? 'Currently delivering' : inScope ? 'Unavailable' : 'Outside scope'}
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
