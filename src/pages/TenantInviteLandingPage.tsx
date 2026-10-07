import { useEffect, useMemo, useState } from 'react';
import type { EmailOtpType } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

export function TenantInviteLandingPage() {
  const params = useMemo(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);

  const confirmationUrl = params.get('confirmation_url') ?? '';
  const tokenHash = params.get('token_hash') ?? '';
  const tokenType = params.get('type') ?? '';
  const tenantInviteFlow = params.get('tenant-invite') === '1';
  const tenantFlow = params.get('flow') === 'tenant-owner' || params.get('tenant-owner-access') === '1';
  const authCode = params.get('code') ?? '';
  const isCodeInvite = tenantInviteFlow && !tokenHash && !authCode;

  const [accepting, setAccepting] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  function getAuthHashParams() {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.hash.replace(/^#/, ''));
  }

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

    if (isCodeInvite) {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedCode = inviteCode.replace(/\D/g, '');

      if (!normalizedEmail) {
        setError('Enter the email address that received the invitation.');
        setAccepting(false);
        return;
      }

      if (!/^\d{6}$/.test(normalizedCode)) {
        setError('Enter the 6-digit invitation code from your email.');
        setAccepting(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: normalizedCode,
        type: 'invite',
      });

      if (verifyError) {
        setError(verifyError.message);
        setAccepting(false);
        return;
      }

      window.location.replace(window.location.pathname + '?tenant-invite=1&tenant-onboarding=1');
      return;
    }

    if (authCode) {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(authCode);
      if (exchangeError) {
        setError(exchangeError.message);
        setAccepting(false);
        return;
      }

      window.location.replace(
        window.location.pathname + (tenantInviteFlow ? '?tenant-invite=1&tenant-onboarding=1' : '#restaurant/owner'),
      );
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

      window.location.replace(
        window.location.pathname + (tenantInviteFlow ? '?tenant-invite=1&tenant-onboarding=1' : '#restaurant/owner'),
      );
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

      window.location.replace(
        window.location.pathname + (tenantInviteFlow ? '?tenant-invite=1&tenant-onboarding=1' : '#restaurant/owner'),
      );
      return;
    }

    if (sessionReady) {
      window.location.replace(
        window.location.pathname + (tenantInviteFlow ? '?tenant-invite=1&tenant-onboarding=1' : '#restaurant/owner'),
      );
      return;
    }

    if (confirmationUrl) {
      window.location.assign(confirmationUrl);
      return;
    }

    setError('The invitation could not be opened. Use the 6-digit invitation code from the email.');
    setAccepting(false);
  }

  return (
    <section className="restaurant-owner-auth-no-restaurant">
      <div className="restaurant-owner-auth-no-restaurant-card" style={{ maxWidth: 620, width: '100%' }}>
        <p className="eyebrow">Tenant access</p>

        {isCodeInvite ? (
          <>
            <h1>Accept your restaurant invitation.</h1>
            <p>
              Enter the email address that received the invitation and the 6-digit code from the Web2Table invitation email.
              Opening the email does not activate your account.
            </p>

            <form
              className="restaurant-form"
              onSubmit={(event) => {
                event.preventDefault();
                void acceptInvitation();
              }}
            >
              <label>
                Invitation email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                6-digit invitation code
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </label>

              {error && <div className="error-banner">{error}</div>}

              <div className="modal-actions">
                <button type="submit" disabled={accepting}>
                  {accepting ? 'Accepting invitation…' : 'Accept invitation'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h1>{tenantFlow ? 'Continue to your restaurant.' : 'You’re invited to Web2Table.'}</h1>
            <p>
              {tenantFlow
                ? 'Your secure access link is ready. Click the button below to continue.'
                : 'Your restaurant invitation is ready. Click below to accept it and finish setting up your owner account.'}
            </p>

            {error && <div className="error-banner">{error}</div>}

            {confirmationUrl || tokenHash || sessionReady || checkingSession || tenantFlow || (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) ? (
              <div className="modal-actions">
                <button type="button" onClick={() => void acceptInvitation()} disabled={accepting || checkingSession}>
                  {accepting ? 'Opening secure access…' : checkingSession ? 'Checking invitation…' : tenantFlow ? 'Continue to restaurant' : 'Accept invitation'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}