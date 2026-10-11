import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

function appBaseUrl() {
  return `${window.location.origin}${import.meta.env.BASE_URL}`;
}

function readParams() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    tokenHash: search.get('token_hash') ?? hash.get('token_hash') ?? '',
    tokenType: search.get('type') ?? hash.get('type') ?? '',
    errorCode: search.get('error_code') ?? hash.get('error_code') ?? '',
    errorDescription: search.get('error_description') ?? hash.get('error_description') ?? '',
  };
}

export function RestaurantEmployeeInvitePage() {
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [tokenHash, setTokenHash] = useState('');
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (!supabase) {
        if (mounted) { setError('Supabase is not configured.'); setLoading(false); }
        return;
      }
      const params = readParams();
      if (params.errorCode || params.errorDescription) {
        if (mounted) { setError(params.errorDescription || 'This invitation is invalid or has expired.'); setLoading(false); }
        return;
      }
      if (params.tokenHash && params.tokenType === 'invite') {
        if (mounted) { setTokenHash(params.tokenHash); setLoading(false); }
        return;
      }

      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const type = hash.get('type');
      if (type === 'invite' && accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (sessionError) {
          if (mounted) { setError(sessionError.message); setLoading(false); }
          return;
        }
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!mounted) return;
      if (sessionError || !data.session?.user) {
        setError(sessionError?.message || 'This invitation is missing or has expired.');
        setLoading(false);
        return;
      }
      setEmail(data.session.user.email ?? '');
      setName(String(data.session.user.user_metadata?.name ?? ''));
      setRole(String(data.session.user.user_metadata?.role ?? ''));
      setAccepted(true);
      setLoading(false);
    }
    void load();
    return () => { mounted = false; };
  }, []);

  async function acceptInvitation() {
    if (!supabase || !tokenHash) return;
    setAccepting(true);
    setError('');
    const { data, error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'invite' });
    if (verifyError || !data.user) {
      setError(verifyError?.message || 'The invitation could not be accepted. Please request a new invitation.');
      setAccepting(false);
      return;
    }
    setEmail(data.user.email ?? '');
    setName(String(data.user.user_metadata?.name ?? ''));
    setRole(String(data.user.user_metadata?.role ?? ''));
    setTokenHash('');
    setAccepted(true);
    window.history.replaceState({}, document.title, appBaseUrl() + '?employee-invite=1');
    setAccepting(false);
  }

  if (loading) return <section className="restaurant-owner-auth-loading"><p>Preparing your invitation…</p></section>;

  return (
    <section className="restaurant-employee-invite-page">
      <div className="restaurant-employee-invite-card">
        <p className="eyebrow">Employee invitation</p>
        <h1>{error ? 'Invitation link problem' : accepted ? `Welcome${name ? `, ${name}` : ''}.` : 'Accept your invitation'}</h1>
        {error ? <>
          <p className="restaurant-employee-invite-error" role="alert">{error}</p>
          <p>Ask the restaurant owner to send you a new invitation.</p>
          <a className="button button-primary" href={appBaseUrl()}>Back to restaurant</a>
        </> : accepted ? <>
          <p>Your invitation for <strong>{email}</strong> has been accepted. No password is needed.</p>
          <p>Continue to sign in with an email verification code. Your required authenticator setup will be completed before you access staff tools.</p>
          <a className="button button-primary" href={appBaseUrl() + '#staff-login'}>Continue to staff sign in</a>
          <p className="restaurant-auth-switch">Role: {role || 'Restaurant staff'}</p>
        </> : <>
          <p>Accept your invitation to activate passwordless access for your restaurant team account.</p>
          <button className="button button-primary" type="button" onClick={() => void acceptInvitation()} disabled={accepting}>
            {accepting ? 'Accepting…' : 'Accept Invitation'}
          </button>
        </>}
      </div>
    </section>
  );
}
