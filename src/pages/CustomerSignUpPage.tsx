import { useState, type FormEvent } from 'react';
import { getCurrentCustomerRestaurant, signUpCustomer } from '../modules/customer/customerAuthService';
import { supabase } from '../services/supabaseClient';
import { getPasswordPolicyError, getPasswordGuidance, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../utils/passwordPolicy';

export function CustomerSignUpPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [personalInfoConsent, setPersonalInfoConsent] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const fieldErrors = {
    firstName: !firstName.trim() ? 'Please enter your first name.' : '',
    lastName: !lastName.trim() ? 'Please enter your last name.' : '',
    phone: !phone.trim() ? 'Please enter your phone number.' : !/^09[0-9]{9}$/.test(phone.trim()) ? 'Enter an 11-digit mobile number starting with 09.' : '',
    email: !email.trim() ? 'Please enter your email address.' : !(email.trim().includes('@') && email.trim().split('@')[1]?.includes('.') && !/\s/.test(email.trim())) ? 'Please enter a valid email address.' : '',
    password: !password ? 'Please create a password.' : getPasswordPolicyError(password) || '',
    confirmPassword: !confirmPassword ? 'Please confirm your password.' : confirmPassword !== password ? 'Passwords do not match.' : '',
    consent: !personalInfoConsent ? 'Please agree to the Privacy Notice to create an account.' : '',
  };
  const shouldShow = (field: string) => submitted || Boolean(touched[field]);
  const markTouched = (field: string) => setTouched((current) => ({ ...current, [field]: true }));
  const fieldError = (field: keyof typeof fieldErrors) => shouldShow(field) && fieldErrors[field] ? <small className="customer-field-error" role="alert">{fieldErrors[field]}</small> : null;

  async function handleGoogleSignUp() {
    setError('');
    setMessage('');
    if (!supabase) {
      setError('Google sign-in is not configured yet. Please use email registration for now.');
      return;
    }
    setGoogleSubmitting(true);
    try {
      await getCurrentCustomerRestaurant();
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}#account`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, queryParams: { prompt: 'select_account' } },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start Google sign-up.');
      setGoogleSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setError('');
    setMessage('');
    setEmailAlreadyRegistered(false);

    const trimmedName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const trimmedPhone = phone.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (fieldErrors.firstName || fieldErrors.lastName || fieldErrors.phone || fieldErrors.email || fieldErrors.password || fieldErrors.confirmPassword || fieldErrors.consent) return;

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

        <button className="customer-google-signup-button" type="button" onClick={() => void handleGoogleSignUp()} disabled={submitting || googleSubmitting}>
          <svg viewBox="0 0 48 48" aria-hidden="true" width="19" height="19"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 3.1 13.22l7.98 6.19C12.97 13.72 18.03 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.75 7.18l7.73 6C44.43 37.98 46.98 31.88 46.98 24.55Z"/><path fill="#FBBC05" d="M11.08 28.59A14.4 14.4 0 0 1 10.3 24c0-1.59.27-3.13.76-4.59L3.1 13.22A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 3.1 10.78l7.98-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.18 2.3-5.97 0-11.03-4.22-12.92-9.91L3.1 34.78C6.51 42.62 14.62 48 24 48Z"/></svg>
          {googleSubmitting ? 'Connecting to Google…' : 'Sign up with Google'}
        </button>
        <div className="customer-signup-divider" aria-hidden="true"><span>or sign up with email</span></div>
        <form className="restaurant-owner-auth-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
          <div className="customer-signup-name-row">
            <label>
              First name
              <input type="text" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} onBlur={() => markTouched("firstName")} aria-invalid={shouldShow("firstName") && Boolean(fieldErrors.firstName)} required disabled={submitting} />
              {fieldError("firstName")}
            </label>
            <label>
              Last name
              <input type="text" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} onBlur={() => markTouched("lastName")} aria-invalid={shouldShow("lastName") && Boolean(fieldErrors.lastName)} required disabled={submitting} />
              {fieldError("lastName")}
            </label>
          </div>
          <label>
            Phone number
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
              maxLength={11}
              onBlur={() => markTouched("phone")}
              aria-invalid={shouldShow("phone") && Boolean(fieldErrors.phone)}
              required
              disabled={submitting}
            />
            {fieldError("phone")}
          </label>
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={() => markTouched("email")} aria-invalid={shouldShow("email") && Boolean(fieldErrors.email)} required disabled={submitting} />
            {fieldError("email")}
          </label>
          <label className="customer-signup-password-field">
            Password
            <span className="customer-password-input-wrap">
              <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} onBlur={() => markTouched("password")} aria-invalid={shouldShow("password") && Boolean(fieldErrors.password)} disabled={submitting} required />
              <button className="customer-password-visibility-button" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={submitting}>
                {showPassword ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.7 9.5 6-.3.6-1.4 2.2-3.4 3.7M6.2 6.2C3.9 7.6 2.6 9.7 2.5 11c.7 1.3 4.3 6 9.5 6 1 0 1.9-.2 2.7-.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>}
              </button>
            </span>
            {fieldError("password")}
          </label>
          <label className="customer-signup-password-field">
            Confirm password
            <span className="customer-password-input-wrap">
              <input type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} onBlur={() => markTouched("confirmPassword")} aria-invalid={shouldShow("confirmPassword") && Boolean(fieldErrors.confirmPassword)} disabled={submitting} required />
              <button className="customer-password-visibility-button" type="button" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={showConfirmPassword} disabled={submitting}>
                {showConfirmPassword ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.7 9.5 6-.3.6-1.4 2.2-3.4 3.7M6.2 6.2C3.9 7.6 2.6 9.7 2.5 11c.7 1.3 4.3 6 9.5 6 1 0 1.9-.2 2.7-.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>}
              </button>
            </span>
            {fieldError("confirmPassword")}
          </label>
          <fieldset className="customer-password-checklist" aria-label="Password requirements">
            {[
              { label: 'At least 8 characters', met: password.length >= PASSWORD_MIN_LENGTH, required: true },
              { label: '128 characters or fewer', met: password.length > 0 && password.length <= PASSWORD_MAX_LENGTH, required: true },
              { label: 'Includes a lowercase letter', met: /[a-z]/.test(password), required: true },
              { label: 'Includes an uppercase letter', met: /[A-Z]/.test(password), required: true },
              { label: 'Includes a number', met: /\d/.test(password), required: true },
              { label: 'Includes a symbol', met: /[^A-Za-z0-9]/.test(password), required: true },
            ].map((rule) => (
              <label className={`customer-password-checklist-item${rule.met ? ' is-met' : ''}`} key={rule.label}>
                <input type="checkbox" checked={rule.met} readOnly tabIndex={-1} aria-label={rule.label + (rule.met ? ' met' : ' not met')} />
                <span>{rule.label}</span>
              </label>
            ))}
            {password && getPasswordPolicyError(password) ? <small className="customer-password-policy-error">{getPasswordPolicyError(password)}</small> : null}
          </fieldset>
          <label className="customer-personal-info-consent">
            <input
              type="checkbox"
              checked={personalInfoConsent}
              onChange={(event) => setPersonalInfoConsent(event.target.checked)}
              disabled={submitting}
              onBlur={() => markTouched("consent")}
              aria-invalid={shouldShow("consent") && Boolean(fieldErrors.consent)}
              required
            />
            <span>I agree to the use of my personal information for account creation and order-related services. <a href="#privacy">Privacy Notice</a>.</span>
          </label>
          {fieldError("consent")}
          <button className="button button-primary" type="submit" disabled={submitting}>
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
