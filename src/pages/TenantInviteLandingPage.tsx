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

  const [accepting, setAccepting] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState('');

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

    return (
    <section className="restaurant-owner-auth-no-restaurant">
      <div className="restaurant-owner-auth-no-restaurant-card" style={{ maxWidth: 620, width: '100%' }}>
        <p className="eyebrow">Tenant access</p>

        <h1>{tenantFlow ? 'Continue to your restaurant.' : 'Accept your restaurant invitation.'}</h1>
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
      </div>
    </section>
  );
}
