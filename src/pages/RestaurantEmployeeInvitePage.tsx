import { useEffect, useState, type FormEvent } from 'react';
import { getPasswordPolicyError, getPasswordGuidance, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../utils/passwordPolicy';
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
  const [passwordSetupRequired, setPasswordSetupRequired] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

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
      setPasswordSetupRequired(true);
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
    setPasswordSetupRequired(true);
    window.history.replaceState({}, document.title, appBaseUrl() + '?employee-invite=1');
    setAccepting(false);
  }

  async function saveStaffPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const policyError = getPasswordPolicyError(password);
    if (policyError) { setError(policyError); return; }
    if (password !== confirmPassword) { setError('The passwords do not match.'); return; }
    if (!supabase) { setError('Authentication is temporarily unavailable. Please try again.'); return; }
    setSavingPassword(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw new Error(userError?.message || 'Your invitation session has expired. Open the invitation email again.');
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      window.location.replace(appBaseUrl() + '#staff-login');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save your password. Please try again.');
    } finally {
      setSavingPassword(false);
    }
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
        </> : accepted && passwordSetupRequired ? <>
          <h1>Create your password.</h1>
          <p>Invitation verified for <strong>{email}</strong>. Create a password before setting up two-factor authentication.</p>
          {error && <p className="restaurant-employee-invite-error" role="alert">{error}</p>}
          <form className="restaurant-owner-auth-form" onSubmit={(event) => void saveStaffPassword(event)}>
            <label>New password
              <span className="customer-password-input-row">
                <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={savingPassword} />
                <button className="customer-password-visibility" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, minWidth: 36, background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer' }}>
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.2 10 7-.5 1.2-1.4 2.7-2.8 4M6.2 6.3C3.9 7.7 2.5 10 2 12c1.2 2.8 4.8 7 10 7 1.2 0 2.4-.3 3.4-.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/></svg>
                  )}
                </button>
              </span>
              {password.length > 0 && <ul className="customer-password-requirements" aria-label="Password requirements">{getPasswordGuidance(password).map((item) => <li key={item.label} className={item.met ? 'is-met' : ''}><span className="customer-password-requirement-check" aria-hidden="true">{item.met ? '✓' : ''}</span><span>{item.label}</span></li>)}</ul>}
            </label>
            <label>Confirm password
              <span className="customer-password-input-row">
                <input type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required disabled={savingPassword} />
                <button className="customer-password-visibility" type="button" onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} title={showConfirmPassword ? 'Hide password' : 'Show password'} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0, minWidth: 36, background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer' }}>
                  {showConfirmPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.8 4.2 10 7-.5 1.2-1.4 2.7-2.8 4M6.2 6.3C3.9 7.7 2.5 10 2 12c1.2 2.8 4.8 7 10 7 1.2 0 2.4-.3 3.4-.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/></svg>
                  )}
                </button>
              </span>
            </label>
            <button className="button button-primary" type="submit" disabled={savingPassword || !password || !confirmPassword}>{savingPassword ? 'Creating password…' : 'Create password'}</button>
          </form>
          <p className="restaurant-auth-switch">Role: {role || 'Restaurant staff'}</p>
        </> : accepted ? <>
          <p>Your invitation for <strong>{email}</strong> has been accepted.</p>
          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'center' }}>
            <a className="button button-primary" href={appBaseUrl() + '#staff-login'}>Continue to staff sign in</a>
          </div>
        </> : <>
          <p>Accept your invitation to activate your restaurant team account.</p>
          <button className="button button-primary" type="button" onClick={() => void acceptInvitation()} disabled={accepting}>
            {accepting ? 'Accepting…' : 'Accept Invitation'}
          </button>
        </>}
      </div>
    </section>
  );
}
