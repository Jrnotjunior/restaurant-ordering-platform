import { FormEvent, useEffect, useRef, useState } from 'react';
import { DeliveryNavigation } from '../components/DeliveryNavigation';
import { CustomerContactActions } from '../components/CustomerContactActions';
import { supabase } from '../services/supabaseClient';

type DeliveryStatus = 'assigned' | 'delivering' | 'delivered';

type DeliveryItem = {
  id: string;
  name: string;
  quantity: number;
  total: number;
};

type Delivery = {
  id: string;
  orderNumber: string;
  customerName: string;
  mobileNumber: string;
  address: string;
  total: number;
  items: DeliveryItem[];
  status: DeliveryStatus;
  paymentMethod: 'cash' | 'gcash';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
};

const deliveryStatuses = [
  { label: 'Assigned', detail: 'Dispatcher assigned this delivery to you.' },
  { label: 'Out for delivery', detail: 'You are heading to the customer.' },
  { label: 'Delivered', detail: 'The order was delivered to the customer.' },
];

function statusIndexFor(status: DeliveryStatus) {
  return status === 'delivering' ? 1 : status === 'delivered' ? 2 : 0;
}

export function RiderDeliveryPage({ orderId }: { orderId: string }) {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusIndex, setStatusIndex] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [orderDetailsOpen, setOrderDetailsOpen] = useState(false);
  const [slideValue, setSlideValue] = useState(0);
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [error, setError] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [logoutSaving, setLogoutSaving] = useState(false);
  const slideCompletionLock = useRef(false);

  const currentStatus = deliveryStatuses[statusIndex];
  const isDelivered = statusIndex === deliveryStatuses.length - 1;

  async function loadDelivery() {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    try {
      setError('');
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      const user = authData.user;
      if (!user) throw new Error('Please sign in to view this delivery.');
      setEmail(user.email ?? '');

      const { data: rider, error: riderError } = await supabase
        .from('restaurant_riders')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (riderError) throw riderError;
      if (!rider) throw new Error('Your account is not linked to a rider profile.');

      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('id,order_number,customer_name,mobile_number,delivery_address,delivery_barangay,total,delivery_status,payment_method,payment_status')
        .eq('id', orderId)
        .eq('rider_id', rider.id)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order) throw new Error('This delivery is no longer assigned to your rider account.');

      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('id,product_name,quantity,line_total')
        .eq('order_id', order.id)
        .order('created_at', { ascending: true });
      if (itemsError) throw itemsError;

      const nextDelivery: Delivery = {
        id: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        mobileNumber: order.mobile_number,
        address: order.delivery_address ?? order.delivery_barangay ?? 'Delivery address not provided',
        total: Number(order.total),
        items: ((items ?? []) as Array<{ id: string; product_name: string; quantity: number; line_total: number | string }>).map((item) => ({
          id: item.id,
          name: item.product_name,
          quantity: Number(item.quantity),
          total: Number(item.line_total),
        })),
        status: (order.delivery_status ?? 'assigned') as DeliveryStatus,
        paymentMethod: (order.payment_method ?? 'cash') as 'cash' | 'gcash',
        paymentStatus: (order.payment_status ?? 'pending') as 'pending' | 'paid' | 'failed' | 'refunded',
      };

      setDelivery(nextDelivery);
      setStatusIndex(statusIndexFor(nextDelivery.status));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load this delivery.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void loadDelivery();

    const client = supabase;
    if (!client) return;

    const channel = client
      .channel(`rider-delivery:${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, () => {
        void loadDelivery();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments', filter: `order_id=eq.${orderId}` }, () => {
        void loadDelivery();
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [orderId]);

  async function updateDeliveryStatus(nextStatus: DeliveryStatus) {
    if (!supabase || !delivery || savingStatus) return;

    setSavingStatus(true);
    setError('');

    const previousStatus = delivery.status;
    const previousAssignmentStatus = previousStatus === 'assigned' ? 'assigned' : 'delivering';
    const { data: authData, error: authError } = await supabase.auth.getUser();

    try {
      if (authError) throw authError;
      const user = authData.user;
      if (!user) throw new Error('Please sign in again.');

      const { data: rider, error: riderError } = await supabase
        .from('restaurant_riders')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (riderError) throw riderError;
      if (!rider) throw new Error('Your account is not linked to a rider profile.');

      const assignmentStatus = nextStatus === 'delivered' ? 'delivered' : 'delivering';
      const assignmentUpdate = nextStatus === 'delivered'
        ? { status: assignmentStatus, delivered_at: new Date().toISOString() }
        : { status: assignmentStatus };

      const { error: assignmentError } = await supabase
        .from('delivery_assignments')
        .update(assignmentUpdate)
        .eq('order_id', delivery.id)
        .eq('rider_id', rider.id)
        .eq('status', previousAssignmentStatus);
      if (assignmentError) throw assignmentError;

      const orderUpdate = nextStatus === 'delivered'
        ? { delivery_status: 'delivered', status: 'completed', ...(delivery.paymentMethod === 'cash' ? { payment_status: 'paid' } : {}) }
        : { delivery_status: 'delivering' };

      const { error: orderError } = await supabase
        .from('orders')
        .update(orderUpdate)
        .eq('id', delivery.id)
        .eq('rider_id', rider.id)
        .eq('delivery_status', previousStatus);

      if (orderError) {
        await supabase
          .from('delivery_assignments')
          .update(nextStatus === 'delivered' ? { status: 'delivering', delivered_at: null } : { status: 'assigned' })
          .eq('order_id', delivery.id)
          .eq('rider_id', rider.id)
          .eq('status', assignmentStatus);
        throw orderError;
      }

      setDelivery((current) => current ? { ...current, status: nextStatus } : current);
      setStatusIndex(statusIndexFor(nextStatus));
      setSlideValue(0);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'Unable to update delivery status.');
    } finally {
      setSavingStatus(false);
    }
  }

  function handleDeliverySlide(value: number) {
    if (isDelivered || savingStatus || slideCompletionLock.current) return;
    setSlideValue(value);

    if (value >= 95) {
      slideCompletionLock.current = true;
      const nextStatus: DeliveryStatus = statusIndex === 0 ? 'delivering' : 'delivered';
      void updateDeliveryStatus(nextStatus);
      window.setTimeout(() => {
        slideCompletionLock.current = false;
      }, 300);
    }
  }

  function openPasswordChange() {
    setAccountOpen(false);
    setPasswordError('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordOpen(true);
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError('');

    if (!supabase) {
      setPasswordError('Supabase is not configured.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }

    setPasswordSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);

    if (updateError) {
      setPasswordError(updateError.message);
      return;
    }
    setPasswordOpen(false);
  }

  async function handleLogout() {
    if (!supabase) return;
    setLogoutSaving(true);
    const { error: logoutError } = await supabase.auth.signOut();
    setLogoutSaving(false);
    if (logoutError) {
      setPasswordError(logoutError.message);
      return;
    }
    window.location.href = `${window.location.origin}${import.meta.env.BASE_URL}`;
  }

  if (loading) {
    return <section className="rider-delivery-page"><div className="rider-delivery-empty">Loading delivery…</div></section>;
  }

  if (!delivery) {
    return (
      <section className="rider-delivery-page">
        <div className="rider-delivery-error" role="alert">{error || 'Delivery not found.'}</div>
        <a className="button" href={`${import.meta.env.BASE_URL}#rider/dashboard`}>Back to dashboard</a>
      </section>
    );
  }

  return (
    <section className="rider-delivery-page">
      <header className="rider-delivery-header">
        <div>
          <a className="rider-delivery-back" href={`${import.meta.env.BASE_URL}#rider/dashboard`}>← My deliveries</a>
          <p className="eyebrow">My delivery</p>
          <h1>{delivery.orderNumber}</h1>
          <p>Deliver this order to the customer.</p>
        </div>
        <div className="rider-delivery-header-actions">
          <span className="rider-delivery-status">{currentStatus.label}</span>
          <div className="rider-account-menu">
            <button className="rider-account-button" type="button" aria-label="Open rider account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" />
              </svg>
            </button>
            {accountOpen ? (
              <div className="rider-account-dropdown">
                <div className="rider-account-email">{email || 'Rider account'}</div>
                <button type="button" onClick={openPasswordChange}>Change password</button>
                <button type="button" onClick={() => void handleLogout()} disabled={logoutSaving}>{logoutSaving ? 'Logging out…' : 'Log out'}</button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {error ? <div className="rider-delivery-error" role="alert">{error}</div> : null}

      <div className="rider-delivery-layout">
        <main className="rider-delivery-main">
          <section className="rider-delivery-card">
            <div className="rider-delivery-card-heading">
              <div><p className="rider-delivery-label">Customer</p><h2>{delivery.customerName}</h2></div>
              <span className="rider-delivery-customer-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" /></svg></span>
            </div>
            <p className="rider-delivery-phone">{delivery.mobileNumber}</p>
            <CustomerContactActions mobileNumber={delivery.mobileNumber} />
          </section>

          <section className="rider-delivery-card">
            <div className="rider-delivery-card-heading">
              <div><p className="rider-delivery-label">Delivery destination</p><h2>Customer address</h2></div>
              <span className="rider-delivery-location-icon" aria-hidden="true">⌖</span>
            </div>
            <DeliveryNavigation address={delivery.address} />
            <p className="rider-delivery-helper">Tap the address to open Google Maps or Waze.</p>
          </section>

          <section className="rider-delivery-card rider-order-details-card">
            <button className="rider-order-details-toggle" type="button" aria-expanded={orderDetailsOpen} onClick={() => setOrderDetailsOpen((open) => !open)}>
              <span><span className="rider-delivery-label">Order</span><strong>Order details</strong><small>View items and order total</small></span>
              <span className="rider-order-details-chevron" aria-hidden="true">{orderDetailsOpen ? '⌃' : '⌄'}</span>
            </button>
            {orderDetailsOpen ? (
              <>
                <div className="rider-delivery-items">
                  {delivery.items.map((item) => <div className="rider-delivery-item" key={item.id}><span><strong>{item.quantity}×</strong> {item.name}</span><span>₱{item.total.toFixed(2)}</span></div>)}
                </div>
                <div className="rider-delivery-total"><span>Order total</span><strong>₱{delivery.total.toFixed(2)}</strong></div>
              </>
            ) : null}
          </section>
        </main>

        <aside className="rider-delivery-sidebar">
          <section className="rider-delivery-card rider-delivery-progress-card">
            <p className="rider-delivery-label">Delivery status</p>
            <h2>{currentStatus.label}</h2>
            <div className="rider-delivery-steps">
              {deliveryStatuses.map((status, index) => (
                <div className="rider-delivery-step" key={status.label}>
                  <span className={`rider-delivery-step-marker ${index <= statusIndex ? 'is-done' : ''}`}>{index <= statusIndex ? '✓' : index + 1}</span>
                  <div><strong>{status.label}</strong><p>{status.detail}</p></div>
                </div>
              ))}
            </div>

            {!isDelivered ? (
              <div className="rider-delivery-slider" data-status={statusIndex === 0 ? 'start' : 'delivered'}>
                <input className="rider-delivery-slider-input" type="range" min="0" max="100" value={slideValue} aria-label={statusIndex === 0 ? 'Slide to start delivery' : delivery.paymentMethod === 'cash' ? 'Slide to collect cash' : 'Slide to mark delivered'} onChange={(event) => handleDeliverySlide(Number(event.target.value))} disabled={savingStatus} />
                <span className="rider-delivery-slider-label" aria-hidden="true">{savingStatus ? 'Updating…' : statusIndex === 0 ? 'Slide to start delivery' : delivery.paymentMethod === 'cash' ? 'Slide to collect cash' : 'Slide to mark delivered'}</span>
                <span className="rider-delivery-slider-arrow" aria-hidden="true">›</span>
              </div>
            ) : (
              <div className="rider-delivery-complete">{delivery.paymentMethod === 'cash' ? 'Cash collected · Delivery completed' : 'Payment received online · Delivery completed'}</div>
            )}
          </section>
        </aside>
      </div>

      {passwordOpen ? (
        <div className="rider-password-overlay" role="presentation" onMouseDown={() => setPasswordOpen(false)}>
          <section className="rider-password-modal" role="dialog" aria-modal="true" aria-labelledby="rider-password-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="rider-password-modal-header">
              <div><p className="rider-delivery-label">Account</p><h2 id="rider-password-title">Change password</h2></div>
              <button className="rider-password-close" type="button" aria-label="Close" onClick={() => setPasswordOpen(false)}>×</button>
            </div>
            <p className="rider-delivery-helper">Choose a new password with at least 8 characters.</p>
            <form onSubmit={handleChangePassword}>
              <label className="rider-password-field"><span>New password</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
              <label className="rider-password-field"><span>Confirm new password</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
              {passwordError ? <p className="rider-password-error" role="alert">{passwordError}</p> : null}
              <div className="rider-password-actions"><button className="button" type="button" onClick={() => setPasswordOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={passwordSaving}>{passwordSaving ? 'Saving…' : 'Change password'}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
