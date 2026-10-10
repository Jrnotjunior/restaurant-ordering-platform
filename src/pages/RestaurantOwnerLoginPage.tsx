import { useState, type FormEvent } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';

export function RestaurantOwnerLoginPage() {
  const { loading: authLoading, signIn, error: authError } = useRestaurantOwnerAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <main className="restaurant-owner-auth-page">
      <section className="restaurant-owner-auth-card" aria-labelledby="account-login-title">
        <p className="eyebrow">Account access</p>
        <h1 id="account-login-title">Sign in</h1>
        {(error || authError) && <div className="restaurant-dashboard-error" role="alert">{error || authError}</div>}

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
          <p className="customer-password-forgot-link"><a href="#forgot-password">Forgot password?</a></p>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="restaurant-auth-switch">
          Don't have an account? <a href="#signup">Create account</a>
        </p>
      </section>
    </main>
  );
}
