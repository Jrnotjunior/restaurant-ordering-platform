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
  const tenantFlow = params.get('flow') === 'tenant-owner' || params.get('tenant-owner-access') === '1';

  function getAuthHashParams() {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.hash.replace(/^#/, ''));
  }

  const [accepting, setAccepting] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');

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

      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.hash = '#restaurant/owner';
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

      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.hash = '#restaurant/owner';
      return;
    }

    if (sessionReady) {
      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.hash = '#restaurant/owner';
      return;
    }

    if (confirmationUrl) {
      window.location.assign(confirmationUrl);
      return;
    }

    setError('The secure tenant access link did not create a session. Please open the newest access link directly, without refreshing the page.');
    setAccepting(false);
  }

  return (
    <section className="restaurant-owner-auth-no-restaurant">
      <div className="restaurant-owner-auth-no-restaurant-card" style={{ maxWidth: 620, width: '100%' }}>
        <p className="eyebrow">Tenant access</p>
        <h1>{tenantFlow ? 'Continue to your restaurant.' : 'Accept your restaurant invitation.'}</h1>
        <p>
          Your secure access link is ready. Click the button below to continue.
        </p>

        {error && <div className="error-banner">{error}</div>}

        {confirmationUrl || tokenHash || sessionReady || checkingSession || tenantFlow || (typeof window !== 'undefined' && window.location.hash.includes('access_token=')) ? (
          <div className="modal-actions">
            <button type="button" onClick={() => void acceptInvitation()} disabled={accepting || checkingSession}>
              {accepting ? 'Opening secure access…' : checkingSession ? 'Checking secure access…' : tenantFlow ? 'Continue to restaurant' : 'Accept invitation'}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
