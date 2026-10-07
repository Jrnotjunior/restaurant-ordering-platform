import { useMemo, useState } from 'react';
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
  const tenantFlow = params.get('flow') === 'tenant-owner';

  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  async function acceptInvitation() {
    setError('');
    setAccepting(true);

    if (tokenHash) {
      if (!supabase) {
        setError('Authentication is temporarily unavailable. Please try again.');
        setAccepting(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: (tokenType || 'magiclink') as EmailOtpType,
      });

      if (verifyError) {
        setError(verifyError.message);
        setAccepting(false);
        return;
      }

      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.hash = tenantFlow ? '#restaurant/owner' : '';
      return;
    }

    // Backward-compatible path for the original scanner-safe landing page.
    // New tenant access emails should use token_hash instead.
    if (confirmationUrl) {
      window.location.assign(confirmationUrl);
      return;
    }

    setError('This access link is incomplete. Please use the latest email from the Web2Table System Administrator.');
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

        {confirmationUrl || tokenHash ? (
          <div className="modal-actions">
            <button type="button" onClick={() => void acceptInvitation()} disabled={accepting}>
              {accepting ? 'Opening secure access…' : tenantFlow ? 'Continue to restaurant' : 'Accept invitation'}
            </button>
          </div>
        ) : (
          <div className="error-banner">
            This access link is incomplete. Please use the latest email from the Web2Table System Administrator.
          </div>
        )}
      </div>
    </section>
  );
}
