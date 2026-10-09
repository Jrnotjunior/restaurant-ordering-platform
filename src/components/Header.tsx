import { useEffect, useState } from 'react';
import { useRestaurant } from './RestaurantProvider';
import { useRestaurantOwnerAuth } from './RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';
import { getMyLoyaltyPoints } from '../modules/loyalty/loyaltyService';
import '../styles/cart-badge.css';
import '../styles/header-actions.css';

const ACTIVE_ORDER_KEY = 'restaurant-ordering-active-order';

function withBasePath(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  if (path === '/') return `${base}/`;
  if (path === '/menu') return `${base}/`;
  if (path === '/cart') return `${base}/#cart`;
  if (path === '/account') return `${base}/#account`;
  if (path === '/saved-address') return `${base}/#saved-address`;
  if (path === '/order-history') return `${base}/#order-history`;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

type HeaderProps = {
  cartCount?: number;
};

export function Header({ cartCount = 0 }: HeaderProps) {
  const restaurant = useRestaurant();
  const { user, accountType, staffRole, signOut } = useRestaurantOwnerAuth();
  const isRestaurantOwner = accountType === 'owner';
  const isRestaurantStaff = accountType === 'staff';
  const isCustomer = accountType === 'customer';
  const [accountOpen, setAccountOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [logoutMessage, setLogoutMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState<number | null>(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [activeOrderNumber, setActiveOrderNumber] = useState(() => window.localStorage.getItem(ACTIVE_ORDER_KEY));

  async function handleLogout() {
    setLogoutMessage(null);
    try {
      await signOut();
      setAccountOpen(false);
      setChangePasswordOpen(false);
      setLogoutMessage({ type: 'success', text: 'You have been logged out.' });
      if (window.location.hash) window.location.hash = '';
    } catch (error) {
      console.error('Unable to log out.', error);
      setLogoutMessage({ type: 'error', text: 'Unable to log out. Please try again.' });
    }
  }

  useEffect(() => {
    const closeAccount = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.header-account-menu') && !target.closest('.header-account')) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAccountOpen(false); };
    document.addEventListener('mousedown', closeAccount);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeAccount);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadLoyaltyPoints() {
      if (!supabase || !user || !isCustomer || !restaurant.id) {
        setLoyaltyPoints(null);
        return;
      }

      setLoyaltyLoading(true);
      try {
        const points = await getMyLoyaltyPoints(restaurant.id);
        if (mounted) setLoyaltyPoints(points);
      } catch (error) {
        console.error('Unable to load customer loyalty points.', error);
        if (mounted) setLoyaltyPoints(null);
      } finally {
        if (mounted) setLoyaltyLoading(false);
      }
    }

    void loadLoyaltyPoints();

    return () => {
      mounted = false;
    };
  }, [isCustomer, restaurant.id, user?.id]);

  useEffect(() => {
    const refreshActiveOrder = () => setActiveOrderNumber(window.localStorage.getItem(ACTIVE_ORDER_KEY));
    window.addEventListener('storage', refreshActiveOrder);
    window.addEventListener('restaurant-ordering-active-order-change', refreshActiveOrder);
    return () => {
      window.removeEventListener('storage', refreshActiveOrder);
      window.removeEventListener('restaurant-ordering-active-order-change', refreshActiveOrder);
    };
  }, []);

  return (
    <header className="site-header">
      <a className="brand" href={withBasePath('/')} aria-label={`${restaurant.name} home`}>
        {restaurant.logoUrl ? <img src={restaurant.logoUrl} alt="" className="brand-logo" /> : null}
        <span>{restaurant.name}</span>
      </a>

      <div className="header-actions">
        <a className="header-cart" href={withBasePath('/cart')} aria-label={cartCount > 0 ? `View cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'View cart'} title={cartCount > 0 ? `${cartCount} item${cartCount === 1 ? '' : 's'} in cart` : 'Cart'}>
          <svg className="header-cart-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
            <path d="M3 4h2l2.1 10.1a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L20.5 7H6.2M9 19.5h.01M17 19.5h.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {cartCount > 0 ? <span className="header-cart-badge" aria-hidden="true">{cartCount > 99 ? '99+' : cartCount}</span> : null}
        </a>

        {activeOrderNumber ? (
          <a className="header-track-order" href={`${import.meta.env.BASE_URL}?trackOrder=${encodeURIComponent(activeOrderNumber)}`} aria-label={"Track order " + activeOrderNumber} title="Track my order">
            <svg className="header-track-order-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <path d="M4 5.5h16v13H4z" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M8 9h8M8 13h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </a>
        ) : null}

        <div className="header-account-menu">
          {logoutMessage ? <span className={`header-logout-message is-${logoutMessage.type}`} role={logoutMessage.type === 'error' ? 'alert' : 'status'}>{logoutMessage.text}</span> : null}
          <button className="header-account" type="button" aria-label="Account" aria-expanded={user ? accountOpen : undefined} title="Account" onClick={() => {
            if (!user) {
              window.location.hash = '#account';
              return;
            }
            setAccountOpen((open) => !open);
            setChangePasswordOpen(false);
            setPasswordMessage('');
          }}>
            <svg className="header-account-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
              <circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="M5 20c.8-3.5 3.1-5.5 7-5.5s6.2 2 7 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          {accountOpen ? (
            <div className="header-account-dropdown" role="menu">
              <div className="header-account-identity">
                <strong>{isRestaurantOwner ? 'Restaurant Owner' : isRestaurantStaff ? (staffRole ? staffRole.charAt(0).toUpperCase() + staffRole.slice(1) : 'Staff') : (typeof user?.user_metadata?.name === 'string' && user.user_metadata.name.trim() ? user.user_metadata.name.trim() : 'Customer')}</strong>
                <span>{user?.email}</span>
                {isCustomer ? <span className="header-account-points">Loyalty points: {loyaltyLoading ? '…' : loyaltyPoints ?? '—'}</span> : null}
              </div>
              {user ? <>{isCustomer ? <>
                <a className="header-account-menu-item" href={withBasePath('/order-history')} onClick={() => setAccountOpen(false)}>Order history</a>
                <a className="header-account-menu-item" href={withBasePath('/saved-address')} onClick={() => setAccountOpen(false)}>Saved address</a>
              </> : null}
                                <button className="header-account-menu-item" type="button" onClick={() => { setChangePasswordOpen((open) => !open); setPasswordMessage(''); }}>Change password</button>
                {changePasswordOpen ? (
                  <form className="header-account-password-form" onSubmit={async (event) => {
                    event.preventDefault();
                    setPasswordMessage('');
                    if (newPassword.length < 6) { setPasswordMessage('Password must be at least 6 characters.'); return; }
                    if (newPassword !== confirmPassword) { setPasswordMessage('Passwords do not match.'); return; }
                    if (!supabase) { setPasswordMessage('Account service is unavailable.'); return; }
                    const { error } = await supabase.auth.updateUser({ password: newPassword });
                    if (error) { setPasswordMessage(error.message); return; }
                    setNewPassword('');
                    setConfirmPassword('');
                    setPasswordMessage('Password changed.');
                  }}>
                    <input type="password" aria-label="New password" placeholder="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                    <input type="password" aria-label="Confirm password" placeholder="Confirm password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                    <button className="header-account-password-save" type="submit">Save password</button>
                    {passwordMessage ? <span className="header-account-password-message" role="status">{passwordMessage}</span> : null}
                  </form>
                ) : null}
                <button className="header-account-menu-item" type="button" onClick={() => void handleLogout()}>Log out</button>
              </> : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
