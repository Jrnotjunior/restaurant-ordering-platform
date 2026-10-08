import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { getRiderDashboardData } from '../modules/dispatch/dispatchService';

function statusLabel(status: DeliveryStatus) {
  return status === 'delivering' ? 'Out for delivery' : 'Assigned';
}

function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function RiderDashboardPage() {
  const [riderName, setRiderName] = useState('Rider');
  const [deliveries, setDeliveries] = useState<RiderDelivery[]>([]);
  const [history, setHistory] = useState<RiderHistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [logoutSaving, setLogoutSaving] = useState(false);

  async function loadDeliveries() {
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
      if (!user) {
        setError('Please sign in to view your rider deliveries.');
        setLoading(false);
        return;
      }

      setEmail(user.email ?? '');

      const dashboardData = await getRiderDashboardData(user.id);
      setRiderName(dashboardData.riderName);
      setDeliveries(dashboardData.deliveries);
      setHistory(dashboardData.history);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load your deliveries.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void loadDeliveries();

    const client = supabase;
    if (!client) return;

    const channel = client
      .channel('rider-dashboard-deliveries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => void loadDeliveries())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'delivery_assignments' }, () => void loadDeliveries())
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, []);

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

  const activeCount = deliveries.length;
  const hasDeliveringOrder = deliveries.some((delivery) => delivery.status === 'delivering');
  const riderAvailability = hasDeliveringOrder ? 'Out for delivery' : 'Available';

  return (
    <section className="rider-dashboard-page">
      <header className="rider-dashboard-header">
        <div>
          <p className="eyebrow">Rider dashboard</p>
          <h1>Hello, {riderName}.</h1>
          <div className="rider-dashboard-availability" aria-label={`Rider availability: ${riderAvailability}`}>
            <span className={`rider-dashboard-availability-dot ${hasDeliveringOrder ? 'is-delivering' : 'is-available'}`} aria-hidden="true" />
            <strong>{riderAvailability}</strong>
          </div>
          <p>{activeCount === 0 ? 'You have no active deliveries right now.' : `You have ${activeCount} active ${activeCount === 1 ? 'delivery' : 'deliveries'}.`}</p>
        </div>
        <div className="rider-dashboard-account-menu">
          <button className="rider-account-button" type="button" aria-label="Open rider account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" /></svg>
          </button>
          {accountOpen ? (
            <div className="rider-account-dropdown">
              <div className="rider-account-email">{email || 'Rider account'}</div>
              <button type="button" onClick={openPasswordChange}>Change password</button>
              <button type="button" onClick={() => void handleLogout()} disabled={logoutSaving}>{logoutSaving ? 'Logging out…' : 'Log out'}</button>
            </div>
          ) : null}
        </div>
      </header>

      {error ? <div className="rider-dashboard-message" role="alert">{error}</div> : null}

      <main>
        <section className="rider-dashboard-section">
          <div className="rider-dashboard-tabs" role="tablist" aria-label="Rider deliveries">
            <button className={activeTab === 'active' ? 'is-active' : ''} type="button" role="tab" aria-selected={activeTab === 'active'} onClick={() => setActiveTab('active')}>
              Active <span>{activeCount}</span>
            </button>
            <button className={activeTab === 'history' ? 'is-active' : ''} type="button" role="tab" aria-selected={activeTab === 'history'} onClick={() => setActiveTab('history')}>
              Delivery history <span>{history.length}</span>
            </button>
          </div>

          {activeTab === 'active' ? (
            <>
              <div className="rider-dashboard-section-heading">
                <div><p className="rider-delivery-label">My deliveries</p><h2>Orders assigned to you</h2></div>
              </div>

              {loading ? (
                <div className="rider-dashboard-empty">Loading your deliveries…</div>
              ) : deliveries.length === 0 ? (
                <div className="rider-dashboard-empty"><strong>No active deliveries</strong><span>New orders assigned by the dispatcher will appear here.</span></div>
              ) : (
                <div className="rider-dashboard-list">
                  {deliveries.map((delivery) => (
                    <a className="rider-dashboard-delivery-card" href={`${import.meta.env.BASE_URL}#rider/delivery/${delivery.id}`} key={delivery.id}>
                      <div className="rider-dashboard-delivery-main">
                        <div className="rider-dashboard-delivery-top"><strong>{delivery.orderNumber}</strong><span className={`rider-dashboard-status is-${delivery.status}`}>{statusLabel(delivery.status)}</span></div>
                        <h3>{delivery.customerName}</h3>
                        <p>{delivery.address}</p>
                      </div>
                      <div className="rider-dashboard-delivery-side"><strong>₱{delivery.total.toFixed(2)}</strong><span aria-hidden="true">›</span></div>
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="rider-dashboard-section-heading">
                <div><p className="rider-delivery-label">Delivery history</p><h2>Your delivery history</h2></div>
              </div>

              {loading ? (
                <div className="rider-dashboard-empty">Loading order history…</div>
              ) : history.length === 0 ? (
                <div className="rider-dashboard-empty"><strong>No delivery history yet</strong><span>Completed or failed deliveries will appear here.</span></div>
              ) : (
                <div className="rider-dashboard-list">
                  {history.map((order) => (
                    <a className="rider-dashboard-delivery-card rider-dashboard-history-card" href={`${import.meta.env.BASE_URL}#rider/delivery/${order.id}`} key={order.id}>
                      <div className="rider-dashboard-delivery-main">
                        <div className="rider-dashboard-delivery-top"><strong>{order.orderNumber}</strong><span className={`rider-dashboard-status is-${order.status}`}>{order.status === 'failed' ? 'Delivery failed' : 'Delivered'}</span></div>
                        <h3>{order.customerName}</h3>
                        <p>{order.status === 'failed' ? `Failed on ${formatHistoryDate(order.createdAt)}${order.failureReason ? ` · ${order.failureReason}` : ''}` : `Delivered on ${formatHistoryDate(order.createdAt)}`}</p>
                      </div>
                      <div className="rider-dashboard-delivery-side"><strong>₱{order.total.toFixed(2)}</strong><span aria-hidden="true">›</span></div>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {passwordOpen ? (
        <div className="rider-password-overlay" role="presentation" onMouseDown={() => setPasswordOpen(false)}>
          <section className="rider-password-modal" role="dialog" aria-modal="true" aria-labelledby="rider-dashboard-password-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="rider-password-modal-header">
              <div><p className="rider-delivery-label">Account</p><h2 id="rider-dashboard-password-title">Change password</h2></div>
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
