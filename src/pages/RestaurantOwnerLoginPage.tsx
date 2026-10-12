import { useEffect, useState } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';

export function RestaurantOwnerLoginPage({ staffOnly = false }: { staffOnly?: boolean }) {
  const { user, accountType, staffRole, loading: authLoading, signOut, error: authError } = useRestaurantOwnerAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verifiedCustomerId, setVerifiedCustomerId] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user || !accountType || !supabase) return;
    // Capture the narrowed client so TypeScript can safely use it inside the async closure.
    const client = supabase;
    const authenticatedUser = user;

    // Owners and staff are authorized through their database-backed tenant records.
    // Customer Google authentication is not sufficient by itself: a customer
    // must have a complete customer_profiles record for this restaurant.
    if (accountType !== 'customer') return;

    let cancelled = false;

    async function verifyCustomerRegistration() {
      try {
        // The database profile, not Google metadata or local storage, is the
        // final authority for customer registration.
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

  async function handleEmailPasswordSignIn(event: React.FormEvent<HTMLFormElement>) {
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
    if (accountType === 'staff') {
      window.location.hash = staffRole === 'rider' ? '#rider/dashboard' : staffRole === 'kitchen' ? '#restaurant/kitchen' : staffRole === 'dispatcher' ? '#restaurant/dispatcher' : '#restaurant/cashier';
    }
  }, [authLoading, user?.id, accountType, staffRole]);

  if (authLoading) {
    return <main className="restaurant-owner-auth-page"><section className="restaurant-owner-auth-card"><p>Loading account…</p></section></main>;
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
      <section className="restaurant-owner-auth-card" aria-labelledby="account-login-title">
        <p className="eyebrow">{staffOnly ? 'Restaurant team' : 'Account access'}</p>
        <h1 id="account-login-title">{staffOnly ? 'Welcome back, team.' : 'Welcome back.'}</h1>
        <p className="restaurant-login-description">{staffOnly ? 'Sign in securely to access your restaurant team account and daily tasks.' : 'Sign in to your account to manage your restaurant, view orders, and continue with Web2Table.'}</p>
        {(error || authError) && <div className="restaurant-dashboard-error" role="alert">{error || authError}</div>}

        {staffOnly ? (
          <p>Restaurant team members should open the secure sign-in link from their invitation email. If your invitation has expired, ask your restaurant owner to send a new one.</p>
        ) : (
          <form onSubmit={(event) => void handleEmailPasswordSignIn(event)}>
            <label>
              Email address
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={submitting} />
            </label>
            <label>
              Password
              <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={submitting} />
            </label>
            <p className="restaurant-auth-switch"><a href="#forgot-password">Forgot password?</a></p>
            <button className="customer-google-signup-button" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in with email'}</button>
          </form>
        )}

        {!staffOnly && <p className="restaurant-auth-switch">New customer? <a href="#signup">Create account</a></p>}
        {staffOnly && <p className="restaurant-auth-switch"><a href="#account">Back to sign in</a></p>}
      </section>
    </main>
  );
}
