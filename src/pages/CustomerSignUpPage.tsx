import { useState, type FormEvent } from 'react';
import { signUpCustomer } from '../modules/customer/customerAuthService';
import { getPasswordPolicyError, getPasswordGuidance, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../utils/passwordPolicy';

export function CustomerSignUpPage() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(() => {
    const feedback = window.sessionStorage.getItem('restaurant-ordering-auth-feedback') ?? '';
    window.sessionStorage.removeItem('restaurant-ordering-auth-feedback');
    return feedback;
  });
  const [emailAlreadyRegistered, setEmailAlreadyRegistered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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


        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="customer-signup-name-row">
            <label>
              First name
              <input type="text" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} onBlur={() => markTouched('firstName')} aria-invalid={shouldShow('firstName') && Boolean(fieldErrors.firstName)} required disabled={submitting} />
              {fieldError('firstName')}
            </label>
            <label>
              Last name
              <input type="text" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} onBlur={() => markTouched('lastName')} aria-invalid={shouldShow('lastName') && Boolean(fieldErrors.lastName)} required disabled={submitting} />
              {fieldError('lastName')}
            </label>
          </div>
          <label>
            Phone number
            <input type="tel" inputMode="numeric" autoComplete="tel-national" value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^0-9]/g, '').slice(0, 11))} onBlur={() => markTouched('phone')} aria-invalid={shouldShow('phone') && Boolean(fieldErrors.phone)} required disabled={submitting} />
            {fieldError('phone')}
          </label>
          <label>
            Email address
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} onBlur={() => markTouched('email')} aria-invalid={shouldShow('email') && Boolean(fieldErrors.email)} required disabled={submitting} />
            {fieldError('email')}
          </label>
          <label>
            Password
            <span className="customer-password-input-row">
              <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} onBlur={() => markTouched('password')} aria-invalid={shouldShow('password') && Boolean(fieldErrors.password)} required disabled={submitting} />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} disabled={submitting}>{showPassword ? 'Hide' : 'Show'}</button>
            </span>
            <small>{getPasswordGuidance()}</small>
            {fieldError('password')}
          </label>
          <label className="customer-personal-info-consent">
            <input type="checkbox" checked={personalInfoConsent} onChange={(event) => setPersonalInfoConsent(event.target.checked)} disabled={submitting} onBlur={() => markTouched('consent')} aria-invalid={shouldShow('consent') && Boolean(fieldErrors.consent)} required />
            <span>I agree to the use of my personal information for account creation and order-related services. <a href="#privacy">Privacy Notice</a>.</span>
          </label>
          {fieldError('consent')}
          <button className="customer-google-signup-button" type="submit" disabled={submitting}>{submitting ? 'Creating account…' : 'Create account'}</button>
        </form>

        <p className="restaurant-auth-switch">
          Already have an account? <a href="#account">Sign in</a>
        </p>


      </section>
    </main>
  );
}
