import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';

export function CustomerEmailConfirmationPage() {
  const { user, loading, error } = useRestaurantOwnerAuth();

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
