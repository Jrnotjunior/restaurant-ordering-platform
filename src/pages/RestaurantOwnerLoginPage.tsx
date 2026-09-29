import { useState, type FormEvent } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';

function routeForRole(role: string | undefined, hasRestaurant: boolean) {
  if (role === 'rider') return '#rider/delivery-preview';
  if (role === 'customer') return '#menu';
  if (role === 'restaurant_owner' || hasRestaurant) return '#restaurant/orders';
  return '#menu';
}

export function RestaurantOwnerLoginPage() {
  const { signIn, error: authError, restaurant } = useRestaurantOwnerAuth();
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
      const { data } = await supabase?.auth.getUser() ?? { data: { user: null } };
      const role = data.user?.app_metadata?.role ?? data.user?.user_metadata?.role;
      window.location.hash = routeForRole(typeof role === 'string' ? role : undefined, Boolean(restaurant));
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
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" disabled={submitting} />
          </label>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
