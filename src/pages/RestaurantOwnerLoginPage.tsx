import { useEffect, useState, type FormEvent } from 'react';
import { useRestaurant } from '../components/RestaurantProvider';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';
import { getCurrentCustomerRestaurant } from '../modules/customer/customerAuthService';

export function RestaurantOwnerLoginPage({ staffOnly = false }: { staffOnly?: boolean }) {
  const restaurant = useRestaurant();
  const { user, accountType, staffRole, staffRestaurantId, loading: authLoading, signOut, error: authError } = useRestaurantOwnerAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [verifiedCustomerId, setVerifiedCustomerId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user || !accountType || !supabase) return;
    // Capture the narrowed client so TypeScript can safely use it inside the async closure.
    const client = supabase;
    const authenticatedUser = user;

    // Owners and staff are authorized through their database-backed tenant records.
    // Customer authentication is not sufficient by itself: a customer must
    // have a complete customer_profiles record for this restaurant.
    if (accountType !== 'customer') return;

    let cancelled = false;

    async function verifyCustomerRegistration() {
      try {
        const restaurant = await getCurrentCustomerRestaurant();
        // The database profile is the final authority for customer registration.
        const { data: profileId, error: lookupError } = await client.rpc('get_my_customer_profile_id', {
          p_restaurant_id: restaurant.id,
        });
        if (lookupError) throw lookupError;

        if (!cancelled && !profileId) {
          await client.auth.signOut();
          if (!cancelled) {
            setVerifiedCustomerId(null);
            setError('This email does not have a customer account for this restaurant. Please create an account first.');
          }
          return;
        }

        if (!cancelled && profileId) {
          setVerifiedCustomerId(authenticatedUser.id);
          // Customers should land directly on the storefront menu after
          // successful authentication and registration verification.
          if (window.location.hash === '#account') {
            window.location.hash = '';
          }
        }
      } catch (verificationError) {
        if (cancelled) return;
        await client.auth.signOut();
        if (!cancelled) {
          setVerifiedCustomerId(null);
          setError('We could not verify this customer account. Please try again or contact support.');
        }
      }
    }

    void verifyCustomerRegistration();
    return () => { cancelled = true; };
  }, [authLoading, user?.id, accountType]);

  async function handleEmailPasswordSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!supabase) {
      setError('Sign-in is temporarily unavailable. Please try again later.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Enter your email address and password.');
      return;
    }
    setSubmitting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) throw signInError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (authLoading || !user || !accountType) return;
    if (accountType === 'owner') { window.location.hash = '#restaurant/orders'; return; }
    if (accountType !== 'staff') return;

    let cancelled = false;
    async function redirectStaff() {
      let cashierPosOnly = false;
      if (staffRole === 'cashier' && staffRestaurantId && supabase) {
        const { data, error } = await supabase.rpc('public_restaurant_has_module', {
          p_restaurant_id: staffRestaurantId,
          p_module_key: 'self_ordering',
        });
        if (!cancelled && !error) cashierPosOnly = data === false;
      }
      if (cancelled) return;
      window.location.hash = staffRole === 'rider'
        ? '#rider/dashboard'
        : staffRole === 'kitchen'
          ? '#restaurant/kitchen'
          : staffRole === 'dispatcher'
            ? '#restaurant/dispatcher'
            : cashierPosOnly
              ? '#restaurant/cashier-pos'
              : '#restaurant/cashier';
    }
    void redirectStaff();
    return () => { cancelled = true; };
  }, [authLoading, user?.id, accountType, staffRole, staffRestaurantId]);

  if (authLoading) {
    return <main className="restaurant-owner-auth-page tenant-auth-page"><section className="restaurant-owner-auth-card"><p>Loading account…</p></section></main>;
  }

  // Keep the account screen hidden until the current restaurant's customer profile is verified.
  const customerVerificationPending = Boolean(user && (!accountType || (accountType === 'customer' && verifiedCustomerId !== user.id)));

  if (customerVerificationPending) {
    return (
      <main className="restaurant-owner-auth-page">
        <section className="restaurant-owner-auth-card" aria-live="polite">
          <p>Verifying your customer registration…</p>
        </section>
      </main>
    );
  }


  return (
    <main className="restaurant-owner-auth-page">
      <section className="restaurant-owner-auth-card tenant-auth-card" aria-labelledby="account-login-title">
        <div className="tenant-auth-brand">
          {restaurant.logoUrl?.trim() ? <img className="tenant-auth-logo" src={restaurant.logoUrl} alt={`${restaurant.name || 'Restaurant'} logo`} /> : <span className="tenant-auth-logo-fallback" aria-hidden="true">{(restaurant.name || 'R').trim().slice(0, 1).toUpperCase()}</span>}
          <span className="tenant-auth-brand-name">{restaurant.name?.trim() || 'Welcome'}</span>
        </div>
        <p className="tenant-auth-intro">{staffOnly ? 'Sign in to your restaurant team account.' : 'Welcome back. Sign in to continue your ordering experience.'}</p>
        <h1 className="restaurant-login-title" id="account-login-title">{staffOnly ? 'Team Sign In' : 'Sign In'}</h1>
        {(error || authError) && <div className="restaurant-dashboard-error" role="alert">{error || authError}</div>}

        {staffOnly ? (
          <p>Restaurant team members should open the secure sign-in link from their invitation email. If your invitation has expired, ask your restaurant owner to send a new one.</p>
        ) : (
          <form className="restaurant-owner-auth-form" onSubmit={(event) => void handleEmailPasswordSignIn(event)}>
            <label className="restaurant-auth-input-label">
              <span>Email address</span>
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-label="Email address" required disabled={submitting} />
            </label>
            <label className="restaurant-auth-input-label">
              <span>Password</span>
              <span className="customer-password-input-row">
                <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} aria-label="Password" required disabled={submitting} />
                <button className="customer-password-visibility" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={submitting}>
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.2 9.5 7-.4 1.1-1.2 2.3-2.4 3.4M6.2 6.2C4.2 7.4 2.9 9.5 2.5 12c.7 2 2.5 4.3 5.1 5.8A10.7 10.7 0 0012 19c1.2 0 2.3-.2 3.3-.6" /></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </span>
            </label>
            <div className="restaurant-auth-options-row">
              <label className="restaurant-auth-remember"><input type="checkbox" name="remember-me" /> <span>Remember me</span></label>
              <div className="restaurant-auth-forgot-password-row">
                <a href="#forgot-password">Forgot password?</a>
              </div>
            </div>
            <button className="button" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign In'}</button>
          </form>
        )}

        {!staffOnly && <p className="restaurant-auth-switch">New customer? <a href="#signup">Sign Up</a></p>}
        {staffOnly && <p className="restaurant-auth-switch"><a href="#account">Back to sign in</a></p>}
      </section>
    </main>
  );
}
