import { useState, type FormEvent } from 'react';
import { currentRestaurantLookup } from '../config/restaurant';
import { supabase } from '../services/supabaseClient';

export function CustomerSignUpPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [personalInfoConsent, setPersonalInfoConsent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName || !trimmedPhone || !trimmedEmail || !password || !confirmPassword) {
      setError('Complete all required fields.');
      return;
    }

    if (!/^09\d{9}$/.test(trimmedPhone)) {
      setError('Phone number must start with 09 and contain exactly 11 digits.');
      return;
    }

    if (!personalInfoConsent) {
      setError('Please agree to provide your personal information before creating an account.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setSubmitting(true);
    try {
      const { data: restaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .select('id')
        .eq('slug', currentRestaurantLookup.slug)
        .eq('is_active', true)
        .maybeSingle();

      if (restaurantError) throw restaurantError;
      if (!restaurant?.id) throw new Error('Restaurant could not be found.');

      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}#menu`;
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: {
            role: 'customer',
            name: trimmedName,
            phone: trimmedPhone || null,
            restaurant_id: restaurant.id,
          },
          emailRedirectTo: redirectTo,
        },
      });

      if (signUpError) throw signUpError;

      if (data.session) {
        const { error: profileError } = await supabase.rpc('upsert_customer_profile', {
          p_restaurant_id: restaurant.id,
          p_name: trimmedName,
          p_phone: trimmedPhone || null,
        });

        if (profileError) throw profileError;

        window.location.hash = '#menu';
        return;
      }

      setMessage('Account created. Check your email to confirm your account, then sign in.');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create your account.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="restaurant-owner-auth-page">
      <section className="restaurant-owner-auth-card" aria-labelledby="customer-signup-title">
        <p className="eyebrow">Customer account</p>
        <h1 id="customer-signup-title">Create account</h1>
        <p>Create your customer account to sign in and place orders.</p>

        {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}
        {message && <div className="restaurant-auth-success" role="status">{message}</div>}

        <form className="restaurant-owner-auth-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            Full name
            <input type="text" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} disabled={submitting} />
          </label>
          <label>
            Phone number
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
              maxLength={11}
              required
              disabled={submitting}
            />
          </label>
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={submitting} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} />
          </label>
          <label>
            Confirm password
            <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={submitting} />
          </label>
          <label className="customer-personal-info-consent">
            <input
              type="checkbox"
              checked={personalInfoConsent}
              onChange={(event) => setPersonalInfoConsent(event.target.checked)}
              disabled={submitting}
              required
            />
            <span>I agree to the collection and processing of the personal information I provide for account creation and order-related services in accordance with Republic Act No. 10173 (Data Privacy Act of 2012). I understand that I have rights as a data subject under applicable privacy laws. <a href="#privacy">Read our Privacy Notice</a>.</span>
          </label>
          <button className="button button-primary" type="submit" disabled={submitting || !personalInfoConsent}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="restaurant-auth-switch">
          Already have an account? <a href="#account">Sign in</a>
        </p>
      </section>
    </main>
  );
}
