import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getCurrentCustomerUser } from '../modules/customer/customerAuthService';

export function CustomerEmailConfirmationPage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    getCurrentCustomerUser()
      .then((currentUser) => {
        if (mounted) setUser(currentUser);
      })
      .catch((authError) => {
        if (mounted) {
          setError(authError instanceof Error ? authError.message : 'Unable to confirm your email.');
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <main className="restaurant-owner-auth-page">
        <section className="restaurant-owner-auth-card">
          <p>Confirming your email…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="restaurant-owner-auth-page">
      <section className="restaurant-owner-auth-card" aria-labelledby="customer-email-confirmed-title">
        <p className="eyebrow">Customer account</p>
        <h1 id="customer-email-confirmed-title">
          {user ? 'Email confirmed' : 'Email confirmation'}
        </h1>

        {user ? (
          <>
            <p>Your customer account is now confirmed. You can continue to the restaurant menu.</p>
            <a className="button button-primary" href="#">
              Continue to menu
            </a>
          </>
        ) : (
          <>
            <p>We could not complete the email confirmation in this browser.</p>
            {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}
            <a className="button button-primary" href="#account">
              Sign in
            </a>
          </>
        )}
      </section>
    </main>
  );
}
