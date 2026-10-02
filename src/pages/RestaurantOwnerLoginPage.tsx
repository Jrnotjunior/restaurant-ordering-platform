import { useState, type FormEvent } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';

export function RestaurantOwnerLoginPage() {
  const { signIn, error: authError } = useRestaurantOwnerAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        window.location.hash = '#menu';
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

      // Rider accounts are identified by their restaurant_riders link.
      // This keeps rider routing working even if older invited accounts
      // do not have the role metadata populated.
      if (user) {
        const { data: riderProfile, error: riderLookupError } = await supabase
          .from('restaurant_riders')
          .select('id')
          .eq('auth_user_id', user.id)
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

  return (
    <main className="restaurant-owner-auth-page">
      <section className="restaurant-owner-auth-card" aria-labelledby="account-login-title">
        <p className="eyebrow">Account access</p>
        <h1 id="account-login-title">Sign in</h1>
        <p>Use your account credentials. Your role determines which area of the system you can access.</p>

        {(error || authError) && <div className="restaurant-dashboard-error" role="alert">{error || authError}</div>}

        <form className="restaurant-owner-auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" disabled={submitting} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={1} placeholder="Enter your password" disabled={submitting} />
          </label>
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
