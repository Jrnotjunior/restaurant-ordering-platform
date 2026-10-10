import { useState, type FormEvent } from 'react';
import { signUpCustomer } from '../modules/customer/customerAuthService';
import { getPasswordPolicyError, getPasswordGuidance, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../utils/passwordPolicy';

export function CustomerSignUpPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [personalInfoConsent, setPersonalInfoConsent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setEmailAlreadyRegistered(false);

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

    const passwordPolicyError = getPasswordPolicyError(password);
    if (passwordPolicyError) {
      setError(passwordPolicyError);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await signUpCustomer({
        name: trimmedName,
        phone: trimmedPhone,
        email: trimmedEmail,
        password,
      });

      if (result.hasSession) {
        window.location.hash = '';
        return;
      }

      if (result.emailAlreadyRegistered) {
        setEmailAlreadyRegistered(true);
        setMessage("This email already has an account. If you don't remember your password, you can");
      } else {
        setMessage('Check your inbox for an account confirmation email to complete your registration.');
      }
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
        {message && (
          <div className="restaurant-auth-success" role="status">
            {message}{emailAlreadyRegistered && <> <a className="restaurant-auth-success-link" href="#forgot-password">reset your password</a>.</>}
          </div>
        )}

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
            <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} disabled={submitting} required />
            <small>{password ? getPasswordGuidance(password).join(" · ") : "Use at least 8 characters. Longer, unique passwords are safer. Avoid common passwords."}</small>
          </label>
          <label>
            Confirm password
            <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} disabled={submitting} required />
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
