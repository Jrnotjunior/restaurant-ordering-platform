import { useState, type FormEvent } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { getCurrentCustomerRestaurant } from '../modules/customer/customerAuthService';
import { supabase } from '../services/supabaseClient';

export function RestaurantOwnerLoginPage({ staffOnly = false }: { staffOnly?: boolean }) {
  const { user, loading: authLoading, signIn, signOut, error: authError } = useRestaurantOwnerAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  async function handleGoogleSignIn() {
    setError('');
    if (!supabase) {
      setError('Google sign-in is not configured. Please try again later.');
      return;
    }

    setGoogleSubmitting(true);
    try {
      await getCurrentCustomerRestaurant();
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}#account`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, queryParams: { prompt: 'select_account' } },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Google sign-in.');
      setGoogleSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      await signIn(email, password);
      if (!supabase) throw new Error('Supabase is not configured.');

      const { data } = await supabase.auth.getUser();
      const user = data.user;
      const role = user?.app_metadata?.role ?? user?.user_metadata?.role;

      if (role === 'customer') {
        if (staffOnly) throw new Error('Customer accounts cannot use staff sign-in. Please use Continue with Google on the customer sign-in page.');
        window.location.hash = '';
        return;
      }

      // Employee accounts are identified by their restaurant_staff link.
      // The staff table is authoritative for employee role and restaurant.
      if (user) {
        const { data: staffProfile, error: staffLookupError } = await supabase
          .from('restaurant_staff')
          .select('restaurant_id,role')
          .eq('auth_user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffLookupError) throw staffLookupError;
        if (staffProfile?.role === 'cashier') {
          window.location.hash = '#restaurant/cashier';
          return;
        }
        if (staffProfile?.role === 'kitchen') {
          window.location.hash = '#restaurant/kitchen';
          return;
        }
        if (staffProfile?.role === 'dispatcher') {
          window.location.hash = '#restaurant/dispatcher';
          return;
        }
      }

      // Rider accounts are employees in restaurant_staff.
      // The staff table is authoritative for the rider role.
      if (user) {
        const { data: riderProfile, error: riderLookupError } = await supabase
          .from('restaurant_staff')
          .select('id')
          .eq('auth_user_id', user.id)
          .eq('role', 'rider')
          .eq('is_active', true)
          .maybeSingle();

        if (riderLookupError) throw riderLookupError;
        if (riderProfile) {
          window.location.hash = '#rider/dashboard';
          return;
        }
      }

      const { data: ownerRestaurant, error: ownerLookupError } = await supabase
        .from('restaurants')
        .select('id')
        .eq('owner_id', user?.id ?? '')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (ownerLookupError) throw ownerLookupError;
      if (ownerRestaurant) {
        window.location.hash = '#restaurant/orders';
        return;
      }

      throw new Error('Your account is not assigned to a supported system role yet.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return <main className="restaurant-owner-auth-page"><section className="restaurant-owner-auth-card"><p>Loading account…</p></section></main>;
  }

  // OAuth redirects back to #account. This route must show the signed-in
  // state when Supabase has restored a session instead of always showing the
  // sign-in form, which previously made successful logins look unsuccessful.
  // During email/password login, Supabase publishes the authenticated user
  // before handleSubmit finishes resolving the role and navigating away.
  // Keep the login screen in its submitting state during that transition so
  // the account page (and its sign-out button) does not flash briefly.
  if (user && !submitting) {
    return (
      <main className="restaurant-owner-auth-page">
        <section className="restaurant-owner-auth-card" aria-labelledby="account-signed-in-title">
          <p className="eyebrow">Your account</p>
          <h1 id="account-signed-in-title">You're signed in</h1>
          <p>{user.email ?? 'Your account is active.'}</p>
          {authError && <div className="restaurant-dashboard-error" role="alert">{authError}</div>}
          <nav aria-label="Account links" className="restaurant-owner-auth-form">
            <a className="button button-primary" href="#order-history">View order history</a>
            <a className="button" href="#saved-address">Saved addresses</a>
            <a className="button" href="#">Back to menu</a>
          </nav>
          <button
            className="button"
            type="button"
            onClick={() => {
              setSubmitting(true);
              void signOut()
                .then(() => { window.location.hash = '#account'; })
                .catch((err) => setError(err instanceof Error ? err.message : 'Unable to sign out.'))
                .finally(() => setSubmitting(false));
            }}
            disabled={submitting}
          >
            {submitting ? 'Signing out…' : 'Sign out'}
          </button>
          {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="restaurant-owner-auth-page">
      <section className="restaurant-owner-auth-card" aria-labelledby="account-login-title">
        <p className="eyebrow">Account access</p>
        <h1 id="account-login-title">Sign in</h1>
        {(error || authError) && <div className="restaurant-dashboard-error" role="alert">{error || authError}</div>}

        {!staffOnly && <button className="customer-google-signup-button" type="button" onClick={() => void handleGoogleSignIn()} disabled={submitting || googleSubmitting}>
          <svg viewBox="0 0 48 48" aria-hidden="true" width="19" height="19"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 3.1 13.22l7.98 6.19C12.97 13.72 18.03 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.75 7.18l7.73 6C44.43 37.98 46.98 31.88 46.98 24.55Z"/><path fill="#FBBC05" d="M11.08 28.59A14.4 14.4 0 0 1 10.3 24c0-1.59.27-3.13.76-4.59L3.1 13.22A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 3.1 10.78l7.98-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.18 2.3-5.97 0-11.03-4.22-12.92-9.91L3.1 34.78C6.51 42.62 14.62 48 24 48Z"/></svg>
          {googleSubmitting ? 'Connecting to Google…' : 'Continue with Google'}
        </button>}
        {!staffOnly && <div className="customer-signup-divider" aria-hidden="true"><span>or sign in with email</span></div>}

        <form className="restaurant-owner-auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} />
          </label>
          <label>
            Password
            <span className="customer-password-input-wrap">
              <input type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={1} disabled={submitting} />
              <button
                className="customer-password-visibility-button"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                disabled={submitting}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.7 9.5 6-.3.6-1.4 2.2-3.4 3.7M6.2 6.2C3.9 7.6 2.6 9.7 2.5 11c.7 1.3 4.3 6 9.5 6 1 0 1.9-.2 2.7-.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>
                )}
              </button>
            </span>
          </label>
          {!staffOnly && <p className="customer-password-forgot-link"><a href="#forgot-password">Forgot password?</a></p>}
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {staffOnly ? <p className="restaurant-auth-switch"><a href="#account">Customer sign in</a></p> : <p className="restaurant-auth-switch">Restaurant team? <a href="#staff-login">Staff sign in</a></p>}
      </section>
    </main>
  );
}
