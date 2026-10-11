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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [googleFirstName, setGoogleFirstName] = useState('');
  const [googleLastName, setGoogleLastName] = useState('');
  const [googlePhone, setGooglePhone] = useState('');
  const [personalInfoConsent, setPersonalInfoConsent] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const fieldErrors = {
    firstName: !firstName.trim() ? 'Please enter your first name.' : '',
    lastName: !lastName.trim() ? 'Please enter your last name.' : '',
    phone: !phone.trim() ? 'Please enter your phone number.' : !/^09[0-9]{9}$/.test(phone.trim()) ? 'Enter an 11-digit mobile number starting with 09.' : '',
    email: !email.trim() ? 'Please enter your email address.' : !(email.trim().includes('@') && email.trim().split('@')[1]?.includes('.') && !/\s/.test(email.trim())) ? 'Please enter a valid email address.' : '',
    password: !password ? 'Please create a password.' : getPasswordPolicyError(password) || '',
    consent: !personalInfoConsent ? 'Please agree to the Privacy Notice to create an account.' : '',
  };
  const shouldShow = (field: string) => submitted || Boolean(touched[field]);
  const markTouched = (field: string) => setTouched((current) => ({ ...current, [field]: true }));
  const fieldError = (field: keyof typeof fieldErrors) => shouldShow(field) && fieldErrors[field] ? <small className="customer-field-error" role="alert">{fieldErrors[field]}</small> : null;

  async function handleGoogleSignUp() {
    setError('');
    setMessage('');
    if (!googleFirstName.trim() || !googleLastName.trim()) {
      setError('Enter your first and last name before continuing with Google.');
      return;
    }
    if (!/^09[0-9]{9}$/.test(googlePhone.trim())) {
      setError('Enter an 11-digit mobile number starting with 09.');
      return;
    }
    if (!personalInfoConsent) {
      setError('Please agree to the Privacy Notice to create an account.');
      return;
    }
    if (!supabase) {
      setError('Google sign-in is not configured. Please try again later.');
      return;
    }
    setGoogleSubmitting(true);
    try {
      const restaurant = await getCurrentCustomerRestaurant();
      window.localStorage.setItem('restaurant-ordering-google-customer-signup', JSON.stringify({ restaurantId: restaurant.id, firstName: googleFirstName.trim(), lastName: googleLastName.trim(), phone: googlePhone.trim(), createdAt: Date.now() }));
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}#account`;
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, queryParams: { prompt: 'select_account' } },
      });
      if (oauthError) throw oauthError;
    } catch (err) {
      window.localStorage.removeItem('restaurant-ordering-google-customer-signup');
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

    if (fieldErrors.firstName || fieldErrors.lastName || fieldErrors.phone || fieldErrors.email || fieldErrors.password || fieldErrors.consent) return;

    setSubmitting(true);
    try {
      const result = await signUpCustomer({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
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
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '';
      const normalizedError = errorMessage.toLowerCase();

      // Supabase may return an explicit duplicate-user error when email
      // confirmation is disabled. Give the same helpful feedback as the
      // identities-empty response without exposing raw auth errors.
      if (
        normalizedError.includes('already registered') ||
        normalizedError.includes('user already exists') ||
        normalizedError.includes('email already exists')
      ) {
        setEmailAlreadyRegistered(true);
        setMessage('This email already has an account. Sign in instead, or');
      } else {
        setError(errorMessage || 'Unable to create your account.');
      }
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


                <div className="customer-signup-name-row customer-google-name-row">
          <label>
            First name
            <input type="text" autoComplete="given-name" value={googleFirstName} onChange={(event) => setGoogleFirstName(event.target.value)} required disabled={submitting || googleSubmitting} />
          </label>
          <label>
            Last name
            <input type="text" autoComplete="family-name" value={googleLastName} onChange={(event) => setGoogleLastName(event.target.value)} required disabled={submitting || googleSubmitting} />
          </label>
        </div>
        <label className="customer-google-phone-field">
          Phone number
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={googlePhone}
            onChange={(event) => setGooglePhone(event.target.value.replace(/[^0-9]/g, '').slice(0, 11))}
            required
            disabled={submitting || googleSubmitting}
          />
        </label>
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

        <button className="customer-google-signup-button" type="button" onClick={() => void handleGoogleSignUp()} disabled={submitting || googleSubmitting}>
          <svg viewBox="0 0 48 48" aria-hidden="true" width="19" height="19"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 3.1 13.22l7.98 6.19C12.97 13.72 18.03 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.75 7.18l7.73 6C44.43 37.98 46.98 31.88 46.98 24.55Z"/><path fill="#FBBC05" d="M11.08 28.59A14.4 14.4 0 0 1 10.3 24c0-1.59.27-3.13.76-4.59L3.1 13.22A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 3.1 10.78l7.98-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.18 2.3-5.97 0-11.03-4.22-12.92-9.91L3.1 34.78C6.51 42.62 14.62 48 24 48Z"/></svg>
          {googleSubmitting ? 'Connecting to Google…' : 'Sign up with Google'}
        </button>


        <p className="restaurant-auth-switch">
          Already have an account? <a href="#account">Sign in</a>
        </p>


      </section>
    </main>
  );
}
