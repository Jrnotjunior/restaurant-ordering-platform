import { useState, type FormEvent } from 'react';
import { signUpCustomer } from '../modules/customer/customerAuthService';
import { getPasswordPolicyError, getPasswordGuidance, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../utils/passwordPolicy';

export function CustomerSignUpPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
          <label className="customer-signup-password-field">
            Password
            <span className="customer-password-input-wrap">
              <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} disabled={submitting} required />
              <button className="customer-password-visibility-button" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={submitting}>
                {showPassword ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.7 9.5 6-.3.6-1.4 2.2-3.4 3.7M6.2 6.2C3.9 7.6 2.6 9.7 2.5 11c.7 1.3 4.3 6 9.5 6 1 0 1.9-.2 2.7-.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>}
              </button>
            </span>
          </label>
          <fieldset className="customer-password-checklist" aria-describedby="customer-password-checklist-note">
            <legend>Password standard</legend>
            <p id="customer-password-checklist-note">All requirements below must be met before you can create an account.</p>
            {[
              { label: 'At least 8 characters', met: password.length >= PASSWORD_MIN_LENGTH, required: true },
              { label: '128 characters or fewer', met: password.length > 0 && password.length <= PASSWORD_MAX_LENGTH, required: true },
              { label: 'Uppercase and lowercase letters', met: /[a-z]/.test(password) && /[A-Z]/.test(password), required: false },
              { label: 'Includes a number', met: /\d/.test(password), required: false },
              { label: 'Includes a symbol', met: /[^A-Za-z0-9]/.test(password), required: false },
            ].map((rule) => (
              <label className={`customer-password-checklist-item${rule.met ? ' is-met' : ''}`} key={rule.label}>
                <input type="checkbox" checked={rule.met} readOnly tabIndex={-1} aria-label={rule.label + (rule.met ? ' met' : ' not met')} />
                <span>{rule.label} (required)</span>
              </label>
            ))}
            {password && getPasswordPolicyError(password) ? <small className="customer-password-policy-error">{getPasswordPolicyError(password)}</small> : null}
          </fieldset>
          <label className="customer-signup-password-field">
            Confirm password
            <span className="customer-password-input-wrap">
              <input type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} disabled={submitting} required />
              <button className="customer-password-visibility-button" type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={showConfirmPassword} disabled={submitting}>
                {showConfirmPassword ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.7 9.5 6-.3.6-1.4 2.2-3.4 3.7M6.2 6.2C3.9 7.6 2.6 9.7 2.5 11c.7 1.3 4.3 6 9.5 6 1 0 1.9-.2 2.7-.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>}
              </button>
            </span>
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
