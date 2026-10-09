import { useEffect, useRef, useState, type FormEvent } from 'react';
import { requestCustomerPasswordReset, updateCustomerPassword } from '../modules/customer/customerAuthService';
import { supabase } from '../services/supabaseClient';

type CustomerPasswordRecoveryPageProps = {
  mode: 'request' | 'reset';
};

export function CustomerPasswordRecoveryPage({ mode }: CustomerPasswordRecoveryPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validResetSession, setValidResetSession] = useState(false);
  const [checkingResetLink, setCheckingResetLink] = useState(mode === 'reset');
  const initialized = useRef(false);

  useEffect(() => {
    if (mode !== 'reset' || initialized.current) return;
    initialized.current = true;
    let active = true;

    async function establishRecoverySession() {
      if (!supabase) {
        if (active) {
          setError('Password recovery is temporarily unavailable. Please try again later.');
          setCheckingResetLink(false);
        }
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const callbackError = params.get('error_description') ?? hashParams.get('error_description');
      if (callbackError) {
        if (active) {
          setError('This password-reset link is invalid or has expired. Request a new one to continue.');
          setCheckingResetLink(false);
        }
        return;
      }

      try {
        const code = params.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else {
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');
          const callbackType = hashParams.get('type');
          if (accessToken && refreshToken && callbackType === 'recovery') {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (sessionError) throw sessionError;
          }
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        const recoveryToken = hashParams.get('type') === 'recovery' || Boolean(code);
        if (!data.session || !recoveryToken) {
          throw new Error('This password-reset link is invalid or has expired.');
        }
        if (active) setValidResetSession(true);
      } catch {
        if (active) {
          setError('This password-reset link is invalid or has expired. Request a new one to continue.');
        }
      } finally {
        if (active) setCheckingResetLink(false);
      }
    }

    void establishRecoverySession();
    return () => {
      active = false;
    };
  }, [mode]);

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!email.trim()) {
      setError('Enter the email address associated with your account.');
      return;
    }

    setSubmitting(true);
    try {
      await requestCustomerPasswordReset(email);
      setMessage('If an account is registered with that email address, a password-reset link will be sent. Please check your inbox and spam folder.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to request a password reset. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (password.length < 6) {
      setError('Your new password must contain at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('The passwords do not match. Please try again.');
      return;
    }

    setSubmitting(true);
    try {
      await updateCustomerPassword(password);
      setPassword('');
      setConfirmPassword('');
      setMessage('Your password has been reset successfully. You can now sign in with your new password.');
      setValidResetSession(false);
      await supabase?.auth.signOut();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset your password. Please request a new reset link.');
    } finally {
      setSubmitting(false);
    }
  }

  if (mode === 'reset' && checkingResetLink) {
    return <main className="restaurant-owner-auth-page"><section className="restaurant-owner-auth-card"><p>Verifying your password-reset link…</p></section></main>;
  }

  return (
    <main className="restaurant-owner-auth-page">
      <section className="restaurant-owner-auth-card" aria-labelledby="customer-password-recovery-title">
        <p className="eyebrow">Customer account</p>
        <h1 id="customer-password-recovery-title">{mode === 'request' ? 'Forgot password?' : 'Reset password'}</h1>
        <p>{mode === 'request'
          ? 'Enter the email address associated with your account. We’ll send instructions to reset your password if an account is registered with that address.'
          : 'Choose a new password for your customer account.'}</p>

        {error && <div className="restaurant-dashboard-error" role="alert">{error}</div>}
        {message && <div className="restaurant-auth-success" role="status">{message}</div>}

        {mode === 'request' ? (
          <form className="restaurant-owner-auth-form" onSubmit={(event) => void handleRequest(event)}>
            <label>
              Email
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required disabled={submitting} />
            </label>
            <button className="button button-primary" type="submit" disabled={submitting}>
              {submitting ? 'Sending instructions…' : 'Send reset link'}
            </button>
          </form>
        ) : validResetSession ? (
          <form className="restaurant-owner-auth-form" onSubmit={(event) => void handleReset(event)}>
            <label>
              New password
              <input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={6} required disabled={submitting} />
            </label>
            <label>
              Confirm new password
              <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={6} required disabled={submitting} />
            </label>
            <button className="button button-primary" type="submit" disabled={submitting}>
              {submitting ? 'Updating password…' : 'Update password'}
            </button>
          </form>
        ) : null}

        <p className="restaurant-auth-switch">
          <a href="#account">Back to sign in</a>
        </p>
      </section>
    </main>
  );
}
