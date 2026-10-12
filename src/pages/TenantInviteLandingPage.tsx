import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { getInvitationEntryUrl, resolveInvitationTypeFromMetadata } from '../modules/invitations/invitationResolver';
import { getPasswordPolicyError, getPasswordGuidance, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../utils/passwordPolicy';

export function TenantInviteLandingPage() {
  const params = useMemo(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  const confirmationUrl = params.get('confirmation_url') ?? '';
  const tokenHash = params.get('token_hash') ?? '';
  const tokenType = params.get('type') ?? '';
  const genericInvitationFlow = params.get('invitation') === '1';
  const tenantInviteFlow = params.get('tenant-invite') === '1';
  const tenantFlow = params.get('flow') === 'tenant-owner' || params.get('tenant-owner-access') === '1' || params.get('tenant-invite') === '1';
  const authCode = params.get('code') ?? '';

  async function redirectAfterAuthentication() {
    if (!supabase) return;
    const { data, error: userError } = await supabase.auth.getUser();
    if (userError || !data.user) {
      setError(userError?.message || 'We could not verify the invited account. Please open the invitation link again.');
      setAccepting(false);
      return;
    }
    const invitationType = resolveInvitationTypeFromMetadata(data.user.user_metadata);
    if (invitationType === 'employee_staff') {
      window.location.replace(getInvitationEntryUrl(invitationType));
      return;
    }
    if (invitationType === 'tenant_owner' || tenantFlow) {
      setInvitedEmail(data.user.email ?? '');
      setPasswordSetupRequired(true);
      setAccepting(false);
      return;
    }
    if (invitationType) {
      window.location.replace(getInvitationEntryUrl(invitationType));
      return;
    }

    // Older tenant invitations may not have invitation_type in Auth metadata.
    // The onboarding RPC still validates the signed-in user's pending invitation,
    // so route an explicit tenant flow to onboarding instead of leaving the
    // recipient stuck on the "Continue to restaurant" screen.
    if (tenantFlow) {
      window.location.replace(getInvitationEntryUrl('tenant_owner'));
      return;
    }

    setError('This invitation is missing a valid invitation type. Please contact the sender.');
    setAccepting(false);
  }

  function getAuthHashParams() {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.hash.replace(/^#/, ''));
  }

  const [accepting, setAccepting] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');
  const [passwordSetupRequired, setPasswordSetupRequired] = useState(false);
  const [invitedEmail, setInvitedEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setCheckingSession(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    async function detectAuthSession() {
      const { data, error: sessionError } = await supabase!.auth.getSession();
      if (cancelled) return;

      if (!sessionError && data.session) {
        setSessionReady(true);
        setCheckingSession(false);
        return;
      }

      attempts += 1;
      if (attempts < 20) {
        timer = setTimeout(() => void detectAuthSession(), 200);
      } else {
        const hash = getAuthHashParams();
        const authError = hash.get('error_description') || hash.get('error');
        if (authError) setError(decodeURIComponent(authError.replace(/\+/g, ' ')));
        setCheckingSession(false);
      }
    }

    void detectAuthSession();

    const { data: authState } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === 'INITIAL_SESSION' || event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        setSessionReady(true);
        setCheckingSession(false);
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      authState.subscription.unsubscribe();
    };
  }, []);

  async function acceptInvitation() {
    setError('');
    setAccepting(true);

    if (!supabase) {
      setError('Authentication is temporarily unavailable. Please try again.');
      setAccepting(false);
      return;
    }

    const hash = getAuthHashParams();
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    const hashType = hash.get('type');
    const hashError = hash.get('error_description') || hash.get('error');

    if (hashError) {
      setError(decodeURIComponent(hashError.replace(/\+/g, ' ')));
      setAccepting(false);
      return;
    }

    if (authCode) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);

      if (exchangeError) {
        setError(exchangeError.message);
        setAccepting(false);
        return;
      }

      await redirectAfterAuthentication();
      return;
    }

    if (tokenHash) {
      const verifyType = tokenType || 'recovery';
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: verifyType as EmailOtpType,
      });

      if (verifyError) {
        setError(verifyError.message);
        setAccepting(false);
        return;
      }

      await redirectAfterAuthentication();
      return;
    }

    if (accessToken && refreshToken && (hashType === 'recovery' || hashType === 'invite' || hashType === 'magiclink')) {
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) {
        setError(sessionError.message);
        setAccepting(false);
        return;
      }

      await redirectAfterAuthentication();
      return;
    }

    if (sessionReady) {
      await redirectAfterAuthentication();
      return;
    }

    if (confirmationUrl) {
      window.location.assign(confirmationUrl);
      return;
    }

    setError('The secure tenant access link did not create a session. Please open the newest access link directly, without refreshing the page.');
    setAccepting(false);
  }

  async function saveOwnerPassword(event: FormEvent<HTMLFormElement>) {
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
      window.location.replace(getInvitationEntryUrl('tenant_owner'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save your password. Please try again.');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <section className="restaurant-owner-auth-no-restaurant">
      <div className="restaurant-owner-auth-no-restaurant-card" style={{ maxWidth: 620, width: '100%' }}>
        <p className="eyebrow">{passwordSetupRequired ? 'Secure owner setup' : genericInvitationFlow ? 'Invitation access' : 'Tenant access'}</p>
        {passwordSetupRequired ? <>
          <h1>Create your password.</h1>
          <p>Invitation verified for <strong>{invitedEmail}</strong>. Create a password before setting up two-factor authentication.</p>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <form className="restaurant-owner-auth-form" onSubmit={(event) => void saveOwnerPassword(event)}>
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
              <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required disabled={savingPassword} />
            </label>
            <button className="button button-primary" type="submit" disabled={savingPassword || !password || !confirmPassword}>{savingPassword ? 'Saving password…' : 'Save password and continue'}</button>
          </form>
        </> : <>
        <h1>{tenantFlow ? 'Continue to your restaurant.' : 'You’re invited to Web2Table.'}</h1>
        <p>
          {tenantFlow
            ? 'Your secure access link is ready. Click the button below to continue.'
            : 'Your restaurant invitation is ready. Click below to accept it and finish setting up your owner account.'}
        </p>

        {error && <div className="error-banner">{error}</div>}

        {confirmationUrl || tokenHash || sessionReady || checkingSession || tenantFlow || genericInvitationFlow || (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) ? (
          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'center' }}>
            <button className="button button-primary" type="button" onClick={() => void acceptInvitation()} disabled={accepting || checkingSession}>
              {accepting ? 'Opening secure access…' : checkingSession ? 'Checking invitation…' : tenantFlow ? 'Continue to restaurant' : 'Accept invitation'}
            </button>
          </div>
        ) : null}
        </>}
      </div>
    </section>
  );
}
