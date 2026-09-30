import { FormEvent, useEffect, useState } from 'react';
import { DeliveryNavigation } from '../components/DeliveryNavigation';
import { CustomerContactActions } from '../components/CustomerContactActions';
import { supabase } from '../services/supabaseClient';

const previewDelivery = {
  orderNumber: '#1024',
  customerName: 'Juan Dela Cruz',
  mobileNumber: '0917 123 4567',
  address: 'Blk 12 Lot 8, Dalandanan, Valenzuela City',
  total: 350,
  items: [
    { quantity: 2, name: 'Chicken Meal', total: 240 },
    { quantity: 1, name: 'Iced Tea', total: 60 },
    { quantity: 1, name: 'Fries', total: 50 },
  ],
};

const deliveryStatuses = [
  { label: 'Assigned', detail: 'Dispatcher assigned this delivery to you.' },
  { label: 'Out for delivery', detail: 'You are heading to the customer.' },
  { label: 'Delivered', detail: 'The order was delivered to the customer.' },
];

export function RiderDeliveryPage() {
  const [statusIndex, setStatusIndex] = useState(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [orderDetailsOpen, setOrderDetailsOpen] = useState(false);
  const [slideValue, setSlideValue] = useState(0);
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [logoutSaving, setLogoutSaving] = useState(false);
  const currentStatus = deliveryStatuses[statusIndex];
  const isDelivered = statusIndex === deliveryStatuses.length - 1;

  useEffect(() => {
    let mounted = true;

    async function loadAccount() {
      if (!supabase) return;
      const { data } = await supabase.auth.getUser();
      if (mounted) setEmail(data.user?.email ?? '');
    }

    void loadAccount();
    return () => {
      mounted = false;
    };
  }, []);

  function handleDeliverySlide(value: number) {
    if (isDelivered) return;

    setSlideValue(value);

    if (value >= 95) {
      setStatusIndex((current) => Math.min(current + 1, deliveryStatuses.length - 1));
      setSlideValue(0);
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
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);

    if (error) {
      setPasswordError(error.message);
      return;
    }

    setPasswordOpen(false);
  }

  async function handleLogout() {
    if (!supabase) return;
    setLogoutSaving(true);
    const { error } = await supabase.auth.signOut();
    setLogoutSaving(false);

    if (error) {
      setPasswordError(error.message);
      return;
    }

    window.location.href = `${window.location.origin}${import.meta.env.BASE_URL}`;
  }

  return (
    <section className="rider-delivery-page">
      <header className="rider-delivery-header">
        <div>
          <p className="eyebrow">My delivery</p>
          <h1>{previewDelivery.orderNumber}</h1>
          <p>Deliver this order to the customer.</p>
        </div>
        <div className="rider-delivery-header-actions">
          <span className="rider-delivery-status">{currentStatus.label}</span>
          <div className="rider-account-menu">
            <button
              className="rider-account-button"
              type="button"
              aria-label="Open rider account menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" />
              </svg>
            </button>
            {accountOpen ? (
              <div className="rider-account-dropdown">
                <div className="rider-account-email">{email || 'Rider account'}</div>
                <button type="button" onClick={openPasswordChange}>Change password</button>
                <button type="button" onClick={() => void handleLogout()} disabled={logoutSaving}>
                  {logoutSaving ? 'Logging out…' : 'Log out'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="rider-delivery-layout">
        <main className="rider-delivery-main">
          <section className="rider-delivery-card">
            <div className="rider-delivery-card-heading">
              <div>
                <p className="rider-delivery-label">Customer</p>
                <h2>{previewDelivery.customerName}</h2>
              </div>
              <span className="rider-delivery-customer-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" />
                </svg>
              </span>
            </div>
            <p className="rider-delivery-phone">{previewDelivery.mobileNumber}</p>
            <CustomerContactActions mobileNumber={previewDelivery.mobileNumber} />
          </section>

          <section className="rider-delivery-card">
            <div className="rider-delivery-card-heading">
              <div>
                <p className="rider-delivery-label">Delivery destination</p>
                <h2>Customer address</h2>
              </div>
              <span className="rider-delivery-location-icon" aria-hidden="true">⌖</span>
            </div>
            <DeliveryNavigation address={previewDelivery.address} />
            <p className="rider-delivery-helper">Tap the address to open Google Maps or Waze.</p>
          </section>

          <section className="rider-delivery-card rider-order-details-card">
            <button
              className="rider-order-details-toggle"
              type="button"
              aria-expanded={orderDetailsOpen}
              onClick={() => setOrderDetailsOpen((open) => !open)}
            >
              <span>
                <span className="rider-delivery-label">Order</span>
                <strong>Order details</strong>
                <small>View items and order total</small>
              </span>
              <span className="rider-order-details-chevron" aria-hidden="true">{orderDetailsOpen ? '⌃' : '⌄'}</span>
            </button>

            {orderDetailsOpen ? (
              <>
                <div className="rider-delivery-items">
                  {previewDelivery.items.map((item) => (
                    <div className="rider-delivery-item" key={item.name}>
                      <span><strong>{item.quantity}×</strong> {item.name}</span>
                      <span>₱{item.total.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="rider-delivery-total">
                  <span>Order total</span>
                  <strong>₱{previewDelivery.total.toFixed(2)}</strong>
                </div>
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
                  <span className={`rider-delivery-step-marker ${index <= statusIndex ? 'is-done' : ''}`}>
                    {index <= statusIndex ? '✓' : index + 1}
                  </span>
                  <div>
                    <strong>{status.label}</strong>
                    <p>{status.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {!isDelivered ? (
              <div className="rider-delivery-slider" data-status={statusIndex === 0 ? 'start' : 'delivered'}>
                <input
                  className="rider-delivery-slider-input"
                  type="range"
                  min="0"
                  max="100"
                  value={slideValue}
                  aria-label={statusIndex === 0 ? 'Slide to start delivery' : 'Slide to mark delivered'}
                  onChange={(event) => handleDeliverySlide(Number(event.target.value))}
                />
                <span className="rider-delivery-slider-label" aria-hidden="true">
                  {statusIndex === 0 ? 'Slide to start delivery' : 'Slide to mark delivered'}
                </span>
                <span className="rider-delivery-slider-arrow" aria-hidden="true">›</span>
              </div>
            ) : (
              <div className="rider-delivery-complete">Delivery completed</div>
            )}
          </section>
        </aside>
      </div>

      {passwordOpen ? (
        <div className="rider-password-overlay" role="presentation" onMouseDown={() => setPasswordOpen(false)}>
          <section className="rider-password-modal" role="dialog" aria-modal="true" aria-labelledby="rider-password-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="rider-password-modal-header">
              <div>
                <p className="rider-delivery-label">Account</p>
                <h2 id="rider-password-title">Change password</h2>
              </div>
              <button className="rider-password-close" type="button" aria-label="Close" onClick={() => setPasswordOpen(false)}>×</button>
            </div>
            <p className="rider-delivery-helper">Choose a new password with at least 8 characters.</p>
            <form onSubmit={handleChangePassword}>
              <label className="rider-password-field">
                <span>New password</span>
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required />
              </label>
              <label className="rider-password-field">
                <span>Confirm new password</span>
                <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" required />
              </label>
              {passwordError ? <p className="rider-password-error" role="alert">{passwordError}</p> : null}
              <div className="rider-password-actions">
                <button className="button" type="button" onClick={() => setPasswordOpen(false)}>Cancel</button>
                <button className="button button-primary" type="submit" disabled={passwordSaving}>{passwordSaving ? 'Saving…' : 'Change password'}</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
