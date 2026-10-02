import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

export type RestaurantNavigationRole = 'owner' | 'cashier' | 'kitchen' | 'dispatcher' | 'rider';

type NavigationItem = {
  label: string;
  href: string;
  icon: 'dashboard' | 'orders' | 'products' | 'riders' | 'shipping' | 'sales' | 'dispatch' | 'settings' | 'loyalty';
};

const ownerNavigationItems: NavigationItem[] = [
  { label: 'Dashboard', href: '#restaurant/owner', icon: 'dashboard' },
  { label: 'Orders', href: '#restaurant/orders', icon: 'orders' },
  { label: 'Products', href: '#restaurant/menu', icon: 'products' },
  { label: 'Employees', href: '#restaurant/employees', icon: 'riders' },
  { label: 'Dispatch', href: '#restaurant/delivery-dispatch', icon: 'dispatch' },
  { label: 'Shipping Fee', href: '#restaurant/shipping-fee', icon: 'shipping' },
  { label: 'Sales', href: '#restaurant/sales', icon: 'sales' },
  { label: 'Loyalty', href: '#restaurant/loyalty', icon: 'loyalty' },
  { label: 'Store Settings', href: '#restaurant/settings', icon: 'settings' },
];

function NavigationIcon({ type }: { type: NavigationItem['icon'] }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (type === 'dashboard') {
    return <svg {...common}><path d="M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-3H4z" /></svg>;
  }

  if (type === 'orders') {
    return <svg {...common}><path d="M6 3.5h9l3 3V20.5H6z" /><path d="M14 3.5v4h4" /><path d="M9 12h6M9 15.5h6" /></svg>;
  }

  if (type === 'products') {
    return <svg {...common}><path d="m12 3 7 4v10l-7 4-7-4V7z" /><path d="m5 7 7 4 7-4M12 11v10" /></svg>;
  }

  if (type === 'riders') {
    return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.7-3.2 2.5-5 5.5-5s4.8 1.8 5.5 5" /><path d="M16 6.5h4M18 4.5v4" /></svg>;
  }

  if (type === 'dispatch') {
    return <svg {...common}><path d="M4 18h16M6 14l4-4 3 3 5-6" /><path d="M17 7h3v3" /></svg>;
  }

  if (type === 'shipping') {
    return <svg {...common}><path d="M3.5 6.5h10v10h-10zM13.5 10h4l3 3v3.5h-7z" /><circle cx="7.5" cy="18" r="2" /><circle cx="17.5" cy="18" r="2" /></svg>;
  }

  if (type === 'loyalty') {
    return <svg {...common}><path d="M12 3.5l2.1 2.2 3-.2.8 2.9 2.5 1.7-1.4 2.7 1.4 2.7-2.5 1.7-.8 2.9-3-.2-2.1 2.2-2.1-2.2-3 .2-.8-2.9-2.5-1.7 1.4-2.7-1.4-2.7 2.5-1.7.8-2.9 3 .2z"/><circle cx="12" cy="12" r="2.5"/></svg>;
  }

  if (type === 'settings') {
    return <svg {...common}><path d="M12 3v2M12 19v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M3 12h2M19 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /><circle cx="12" cy="12" r="3.5" /></svg>;
  }

  return <svg {...common}><path d="M4 19.5V10M10 19.5V6M16 19.5v-9M22 19.5V3" /><path d="M2.5 19.5h20" /></svg>;
}

function getCurrentRoute() {
  return window.location.hash || '#restaurant/dashboard';
}

const roleNavigationItems: Record<RestaurantNavigationRole, NavigationItem[]> = {
  owner: ownerNavigationItems,
  cashier: [
    { label: 'POS', href: '#restaurant/cashier-pos', icon: 'orders' },
    { label: 'Orders', href: '#restaurant/cashier', icon: 'orders' },
    { label: 'Sales', href: '#restaurant/sales', icon: 'sales' },
  ],
  kitchen: [
    { label: 'Orders', href: '#restaurant/kitchen', icon: 'orders' },
    { label: 'Menu', href: '#restaurant/kitchen-menu', icon: 'products' },
  ],
  dispatcher: [{ label: 'Dispatch', href: '#restaurant/dispatcher', icon: 'dispatch' }],
  rider: [{ label: 'Deliveries', href: '#rider/dashboard', icon: 'dispatch' }],
};

export function RestaurantNavigation({ role = 'owner', ownerDashboard = false }: { role?: RestaurantNavigationRole; ownerDashboard?: boolean }) {
  const [currentRoute, setCurrentRoute] = useState(getCurrentRoute);
  const [accountOpen, setAccountOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('Restaurant Owner');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [logoutSaving, setLogoutSaving] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      const metadata = user?.user_metadata as Record<string, unknown> | undefined;
      const name = typeof metadata?.full_name === 'string' ? metadata.full_name : typeof metadata?.name === 'string' ? metadata.name : '';
      setEmail(user?.email ?? '');
      setDisplayName(name || user?.email?.split('@')[0] || 'Restaurant Owner');
    });
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
    if (!supabase) { setPasswordError('Supabase is not configured.'); return; }
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match.'); return; }
    setPasswordSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);
    if (error) { setPasswordError(error.message); return; }
    setPasswordOpen(false);
  }

  async function handleLogout() {
    if (!supabase) return;
    setLogoutSaving(true);
    const { error } = await supabase.auth.signOut();
    setLogoutSaving(false);
    if (error) { setPasswordError(error.message); return; }
    window.location.href = `${window.location.origin}${import.meta.env.BASE_URL}`;
  }

  useEffect(() => {
    const handleHashChange = () => setCurrentRoute(getCurrentRoute());
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (role === 'owner' && ownerDashboard) {
    return (
      <>
        <aside className="restaurant-owner-sidebar" aria-label="Restaurant management navigation">
          <a className="restaurant-owner-brand" href="#restaurant/owner" aria-label="Restaurant Dashboard">
            <span className="restaurant-owner-brand-mark" aria-hidden="true">🍴</span>
            <span><strong>Restaurant</strong><small>Management System</small></span>
          </a>
          <nav className="restaurant-owner-sidebar-nav">
            {ownerNavigationItems.map((item) => {
              const active = currentRoute === item.href;
              return (
                <a key={item.href} className={active ? 'is-active' : ''} href={item.href} aria-current={active ? 'page' : undefined}>
                  <NavigationIcon type={item.icon} />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>
        </aside>
        <header className="restaurant-owner-topbar">
          <div className="restaurant-owner-topbar-status"><span /> <div><strong>Live</strong><small>System Online</small></div></div>
          <div className="restaurant-owner-topbar-divider" />
          <div className="restaurant-account-menu">
            <button className="restaurant-owner-user" type="button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
              <span className="restaurant-owner-avatar">{displayName.slice(0, 2).toUpperCase()}</span>
              <span className="restaurant-owner-user-copy"><strong>{displayName}</strong><small>Store Owner</small></span>
              <span className="restaurant-owner-chevron" aria-hidden="true">⌄</span>
            </button>
            {accountOpen ? (
              <div className="restaurant-account-dropdown">
                <div className="restaurant-account-email">{email || 'Restaurant account'}</div>
                <button type="button" onClick={openPasswordChange}>Change password</button>
                <button type="button" onClick={() => void handleLogout()} disabled={logoutSaving}>{logoutSaving ? 'Logging out…' : 'Log out'}</button>
              </div>
            ) : null}
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <div className={`restaurant-navigation-row${role === 'dispatcher' ? ' is-dispatcher' : ''}`}>
        {role !== 'dispatcher' ? (
          <nav className="restaurant-navigation" aria-label="Restaurant operations navigation">
            {roleNavigationItems[role].map((item) => {
              const active = currentRoute === item.href;
              return (
                <a
                  key={item.href}
                  className={`restaurant-navigation-item${active ? ' is-active' : ''}`}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="restaurant-navigation-icon"><NavigationIcon type={item.icon} /></span>
                  <span>{item.label}</span>
                </a>
              );
            })}
          </nav>
        ) : null}

        <div className="restaurant-account-menu">
          <button className="restaurant-account-button" type="button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" />
            </svg>
          </button>
          {accountOpen ? (
            <div className="restaurant-account-dropdown">
              <div className="restaurant-account-email">{email || 'Restaurant account'}</div>
              <button type="button" onClick={openPasswordChange}>Change password</button>
              <button type="button" onClick={() => void handleLogout()} disabled={logoutSaving}>{logoutSaving ? 'Logging out…' : 'Log out'}</button>
            </div>
          ) : null}
        </div>
      </div>

      {passwordOpen ? (
        <div className="restaurant-password-overlay" role="presentation" onMouseDown={() => setPasswordOpen(false)}>
          <section className="restaurant-password-modal" role="dialog" aria-modal="true" aria-labelledby="restaurant-password-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="restaurant-password-modal-header">
              <div><p className="eyebrow">Account</p><h2 id="restaurant-password-title">Change password</h2></div>
              <button className="restaurant-password-close" type="button" aria-label="Close" onClick={() => setPasswordOpen(false)}>×</button>
            </div>
            <p className="restaurant-password-helper">Choose a new password with at least 8 characters.</p>
            <form onSubmit={handleChangePassword}>
              <label className="restaurant-password-field"><span>New password</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
              <label className="restaurant-password-field"><span>Confirm new password</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
              {passwordError ? <p className="restaurant-password-error" role="alert">{passwordError}</p> : null}
              <div className="restaurant-password-actions"><button className="button" type="button" onClick={() => setPasswordOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={passwordSaving}>{passwordSaving ? 'Saving…' : 'Change password'}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
