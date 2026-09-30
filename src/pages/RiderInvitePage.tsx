import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

function appBaseUrl() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

function getAuthCallbackError() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const errorCode = params.get('error_code');
  const errorDescription = params.get('error_description');

  if (!errorCode && !errorDescription) return '';
  if (errorCode === 'otp_expired') {
    return 'This invitation link has expired or has already been used. Please ask the restaurant owner to send you a new invitation.';
  }
  return errorDescription
    ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
    : 'The invitation link is invalid. Please ask the restaurant owner to send a new invitation.';
}

export function RiderInvitePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteTokenHash, setInviteTokenHash] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadInviteSession() {
      if (!supabase) {
        if (mounted) {
          setError('Supabase is not configured.');
          setLoading(false);
        }
        return;
      }

      const callbackError = getAuthCallbackError();
      if (callbackError) {
        if (mounted) {
          setError(callbackError);
          setLoading(false);
        }
        return;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const tokenHash = searchParams.get('token_hash');
      const tokenType = searchParams.get('type');

      // The invite email uses a token_hash callback so the email provider can
      // safely open the link without consuming the one-time invite token.
      // We only verify the token after the rider explicitly clicks Accept.
      if (tokenHash && tokenType === 'invite') {
        if (mounted) {
          setInviteTokenHash(tokenHash);
          setLoading(false);
        }
        return;
      }

      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const inviteAccessToken = hashParams.get('access_token');
      const inviteRefreshToken = hashParams.get('refresh_token');
      const inviteType = hashParams.get('type');

      if (inviteType === 'invite' && inviteAccessToken && inviteRefreshToken) {
        const { error: inviteSessionError } = await supabase.auth.setSession({
          access_token: inviteAccessToken,
          refresh_token: inviteRefreshToken,
        });

        if (!mounted) return;

        if (inviteSessionError) {
          setError(inviteSessionError.message);
          setLoading(false);
          return;
        }

        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!mounted) return;

      if (sessionError) {
        setError(sessionError.message);
        setLoading(false);
        return;
      }

      const user = data.session?.user;
      if (!user) {
        setError('This invitation is missing or has expired. Please ask the restaurant owner to send a new invitation.');
        setLoading(false);
        return;
      }

      setUserEmail(user.email ?? '');
      setName(String(user.user_metadata?.name ?? ''));
      setLoading(false);
    }

    void loadInviteSession();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleAcceptInvitation() {
    if (!supabase || !inviteTokenHash) return;

    setSaving(true);
    setError('');

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: inviteTokenHash,
      type: 'invite',
    });

    if (verifyError) {
      setSaving(false);
      setError(verifyError.message);
      return;
    }

    const user = data.user;
    if (!user) {
      setSaving(false);
      setError('Supabase accepted the invitation but did not return the rider account.');
      return;
    }

    setUserEmail(user.email ?? '');
    setName(String(user.user_metadata?.name ?? ''));
    setInviteTokenHash('');
    window.history.replaceState({}, document.title, `${appBaseUrl()}?invite=1`);
    setSaving(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    const { data, error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (data.user) {
      setSuccess(true);
      window.history.replaceState({}, document.title, appBaseUrl());
    }
  }

  if (loading) {
    return (
      <section className="restaurant-owner-auth-loading">
        <p>Preparing your invitation…</p>
      </section>
    );
  }

  return (
    <section style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: '48px 20px' }}>
      <div style={{ width: '100%', maxWidth: 520, padding: 32, border: '1px solid #e5e7eb', borderRadius: 20, background: '#fff', boxShadow: '0 16px 40px rgba(15, 23, 42, 0.08)' }}>
        <p className="eyebrow">Rider invitation</p>
        <h1 style={{ marginBottom: 10 }}>{success ? 'Your rider account is ready.' : error ? 'Invitation link problem' : `Welcome${name ? `, ${name}` : ''}.`}</h1>

        {error ? (
          <div>
            <p role="alert" style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: '#fef2f2', color: '#b91c1c' }}>{error}</p>
            <p style={{ marginBottom: 18 }}>The restaurant owner can create a fresh invitation for you.</p>
            <a className="button button-primary" href={appBaseUrl()}>Back to restaurant</a>
          </div>
        ) : success ? (
          <div>
            <p>Your password has been set successfully for <strong>{userEmail}</strong>.</p>
            <p style={{ marginTop: 8 }}>You can now sign in with this email and password.</p>
            <a className="button button-primary" href={`${appBaseUrl()}#rider/dashboard`} style={{ display: 'inline-flex', marginTop: 18 }}>
              Continue to Rider Dashboard
            </a>
          </div>
        ) : inviteTokenHash ? (
          <div>
            <p style={{ marginBottom: 18 }}>Your rider invitation is ready. Click below to accept the invitation and continue to set your password.</p>
            <button className="button button-primary" type="button" onClick={() => void handleAcceptInvitation()} disabled={saving}>
              {saving ? 'Accepting…' : 'Accept Invitation'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ marginBottom: 20 }}>Set a password to finish creating your rider account.</p>

            <label style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              <span>Email</span>
              <input type="email" value={userEmail} readOnly />
            </label>

            <label style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              <span>Password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} autoComplete="new-password" required />
            </label>

            <label style={{ display: 'grid', gap: 8, marginBottom: 18 }}>
              <span>Confirm password</span>
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} autoComplete="new-password" required />
            </label>

            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Set Password'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
