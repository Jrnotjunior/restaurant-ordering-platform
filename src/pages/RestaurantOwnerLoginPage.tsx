import { useEffect, useState } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';
import { getCurrentCustomerRestaurant } from '../modules/customer/customerAuthService';

export function RestaurantOwnerLoginPage({ staffOnly = false }: { staffOnly?: boolean }) {
  const { user, accountType, staffRole, loading: authLoading, signOut, error: authError } = useRestaurantOwnerAuth();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
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
    const storageKey = 'restaurant-ordering-google-customer-signup';

    async function verifyCustomerRegistration() {
      try {
        const restaurant = await getCurrentCustomerRestaurant();
        const rawSignup = window.localStorage.getItem(storageKey);

        // A pending signup may create the profile only after the user has
        // explicitly completed the registration form before Google OAuth.
        if (rawSignup) {
          let signup: { restaurantId?: string; firstName?: string; lastName?: string; phone?: string };
          try {
            signup = JSON.parse(rawSignup);
          } catch {
            window.localStorage.removeItem(storageKey);
            signup = {};
          }

          const completeSignup =
            signup.restaurantId === restaurant.id &&
            Boolean(signup.firstName?.trim()) &&
            Boolean(signup.lastName?.trim()) &&
            /^09[0-9]{9}$/.test(signup.phone ?? '');

          if (completeSignup) {
            const { error: profileError } = await client.rpc('upsert_customer_profile', {
              p_restaurant_id: restaurant.id,
              p_first_name: signup.firstName!.trim(),
              p_last_name: signup.lastName!.trim(),
              p_phone: signup.phone,
            });
            if (profileError) throw profileError;

            // Keep Supabase's Auth dashboard display label aligned with the
            // name the customer entered, rather than Google's brand/account
            // label. The canonical first/last-name fields remain in the
            // customer profile; Auth metadata stores first_name and last_name
            // separately, and uses first_name only for the display label.
            const firstName = signup.firstName!.trim();
            const lastName = signup.lastName!.trim();
            const phone = signup.phone!.trim();
            const { error: metadataError } = await client.auth.updateUser({
              data: {
                first_name: firstName,
                last_name: lastName,
                phone,
                // Supabase Auth's Users table displays the metadata "name"
                // value. Never use the Google provider's app label here.
                name: firstName,
                display_name: firstName,
              },
            });
            if (metadataError) {
              // Do not silently mark registration complete when the Auth
              // display metadata failed to persist.
              throw new Error(`Customer profile was saved, but customer Auth metadata could not be updated: ${metadataError.message}`);
            }
            const { data: refreshedUser, error: refreshError } = await client.auth.getUser();
            if (refreshError || !refreshedUser.user ||
                refreshedUser.user.user_metadata?.name !== firstName ||
                refreshedUser.user.user_metadata?.first_name !== firstName ||
                refreshedUser.user.user_metadata?.last_name !== lastName ||
                refreshedUser.user.user_metadata?.phone !== phone) {
              throw new Error('Customer registration was saved, but Auth name and phone metadata could not be verified. Please try signing in again.');
            }
            window.localStorage.removeItem(storageKey);
          }
        }

        // The database profile, not Google metadata or local storage, is the
        // final authority for customer registration.
        const { data: profileId, error: lookupError } = await client.rpc('get_my_customer_profile_id', {
          p_restaurant_id: restaurant.id,
        });
        if (lookupError) throw lookupError;

        if (!cancelled && !profileId) {
          // Deny access and ask the trusted server to delete an Auth identity
          // that has no registered customer, owner, staff, or pending invite.
          // The server independently checks all application roles before deletion.
          const { error: cleanupError } = await client.functions.invoke('reject-unregistered-customer');
          await client.auth.signOut();

          if (!cancelled) {
            window.sessionStorage.setItem(
              'restaurant-ordering-auth-feedback',
              cleanupError
                ? 'This account is not registered. Access was denied, but automatic account cleanup could not be confirmed. Please contact support.'
                : 'This account is not yet registered. Please create your customer account before signing in.',
            );
            window.location.hash = '#signup';
          }
          return;
        }

        if (!cancelled && profileId) {
          setVerifiedCustomerId(authenticatedUser.id);
        }
      } catch (verificationError) {
        if (cancelled) return;
        // Fail closed. The server deletes only identities that have no
        // registered customer profile, staff/owner role, system-admin access,
        // or pending tenant invitation; otherwise it preserves the identity.
        const { error: cleanupError } = await client.functions.invoke('reject-unregistered-customer');
        await client.auth.signOut();
        window.sessionStorage.setItem(
          'restaurant-ordering-auth-feedback',
          cleanupError
            ? 'We could not verify this account. Access was denied, but automatic account cleanup could not be confirmed. Please contact support.'
            : 'We could not verify this customer account. Please create an account or try signing in again.',
        );
        if (!cancelled) window.location.hash = '#signup';
      }
    }

    void verifyCustomerRegistration();
    return () => { cancelled = true; };
  }, [authLoading, user?.id, accountType]);

  async function handleGoogleSignIn() {
    setError('');
    if (!supabase) {
      setError('Google sign-in is not configured. Please try again later.');
      return;
    }

    setGoogleSubmitting(true);
    try {
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}${staffOnly ? '#staff-login' : '#account'}`;
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

  // OAuth redirects back to #account. This route must show the signed-in
  // state when Supabase has restored a session instead of always showing the
  // sign-in form, which previously made successful logins look unsuccessful.
  // A restored Google session is not enough: keep the account screen hidden
  // until the current restaurant's customer profile has been verified.
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

  if (user && accountType && !submitting && (accountType !== 'customer' || verifiedCustomerId === user.id)) {
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
        <p className="eyebrow">{staffOnly ? 'Restaurant team' : 'Account access'}</p>
        <h1 id="account-login-title">{staffOnly ? 'Welcome back, team.' : 'Welcome back.'}</h1>
        <p className="restaurant-login-description">{staffOnly ? 'Sign in securely to access your restaurant team account and daily tasks.' : 'Sign in to your account to manage your restaurant, view orders, and continue with Web2Table.'}</p>
        {(error || authError) && <div className="restaurant-dashboard-error" role="alert">{error || authError}</div>}

        <button className="customer-google-signup-button" type="button" onClick={() => void handleGoogleSignIn()} disabled={submitting || googleSubmitting}>
          <svg viewBox="0 0 48 48" aria-hidden="true" width="19" height="19"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 3.1 13.22l7.98 6.19C12.97 13.72 18.03 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.75 7.18l7.73 6C44.43 37.98 46.98 31.88 46.98 24.55Z"/><path fill="#FBBC05" d="M11.08 28.59A14.4 14.4 0 0 1 10.3 24c0-1.59.27-3.13.76-4.59L3.1 13.22A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 3.1 10.78l7.98-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.18 2.3-5.97 0-11.03-4.22-12.92-9.91L3.1 34.78C6.51 42.62 14.62 48 24 48Z"/></svg>
          {googleSubmitting ? 'Connecting to Google…' : 'Continue with Google'}
        </button>
        

        {!staffOnly && <p className="restaurant-auth-switch">New customer? <a href="#signup">Create account</a></p>}
        {staffOnly && <p className="restaurant-auth-switch"><a href="#account">Back to sign in</a></p>}
      </section>
    </main>
  );
}
