import { useEffect, useState } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';

type Invitation = {
  id: string;
  email: string;
  expires_at: string;
  restaurant_id: string | null;
  restaurant_name: string | null;
};

export function TenantOnboardingPage() {
  const { user, loading: authLoading, error: authError } = useRestaurantOwnerAuth();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restaurantName, setRestaurantName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user || !supabase) {
      if (authError) setError(authError);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const client = supabase;

    async function loadInvitation() {
      setLoading(true);
      setError('');

      const { data, error: invitationError } = await client.rpc('get_my_pending_tenant_invitation');

      if (cancelled) return;

      if (invitationError) {
        setError(invitationError.message);
        setLoading(false);
        return;
      }

      const row = (Array.isArray(data) ? data[0] : data) as Invitation | undefined;
      setInvitation(row ?? null);
      setRestaurantName(row?.restaurant_name ?? '');
      setLoading(false);
    }

    void loadInvitation();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id, authError]);

  async function finishOwnerSetup() {
    if (!supabase) {
      setError('Authentication is unavailable. Please refresh the page and try again.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const { data: setupData, error: setupError } = await supabase.rpc('complete_tenant_owner_setup');

      if (setupError) {
        setError(setupError.message);
        return;
      }

      const setup = Array.isArray(setupData) ? setupData[0] : setupData;
      if (!setup?.restaurant_id) {
        setError('Setup could not confirm your restaurant. Please contact the System Administrator before trying again.');
        return;
      }

      // Remove invitation callback/query parameters and force the app to resolve
      // the authenticated owner route instead of remaining on the onboarding page.
      window.location.replace(`${window.location.pathname}#restaurant/owner`);
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : 'Unable to finish setup. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading || loading) {
    return <section className="restaurant-owner-auth-loading">Preparing your tenant setup…</section>;
  }

  if (!user) {
    return (
      <section className="tenant-onboarding-page">
        <div className="tenant-onboarding-card">
          <p className="eyebrow">Tenant access</p>
          <h1>{authError ? 'Invitation link problem' : 'Sign in to continue.'}</h1>
          <p>{authError || 'Open the invitation email again to complete your tenant setup.'}</p>
          {authError ? <p>Ask the System Administrator to send a new tenant invitation if this link has expired or was already used.</p> : null}
        </div>
      </section>
    );
  }

  if (!invitation) {
    return (
      <section className="tenant-onboarding-page">
        <div className="tenant-onboarding-card">
          <p className="eyebrow">Tenant access</p>
          <h1>Invitation not available.</h1>
          <p>This invitation may have expired, already been used, or been revoked.</p>
          <p><strong>Signed in as:</strong> {user.email ?? user.id}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="tenant-onboarding-page">
      <div className="tenant-onboarding-card" aria-labelledby="tenant-onboarding-title">
        <p className="eyebrow">Tenant access</p>
        <h1 id="tenant-onboarding-title">Set up your owner account.</h1>
        <p className="tenant-onboarding-intro">
          {restaurantName || 'Your restaurant'} is ready. Your email invitation verifies your identity, so you do not need to create a password.
        </p>
        <p><strong>Email:</strong> {user.email ?? invitation.email}</p>
        <p>You will sign in using a one-time email code and complete authenticator verification before accessing your dashboard.</p>
        {error && <div className="tenant-onboarding-error" role="alert">{error}</div>}
        <button className="tenant-onboarding-submit" type="button" onClick={() => void finishOwnerSetup()} disabled={saving}>
          {saving ? 'Finishing setup…' : 'Finish setup'}
        </button>
      </div>
    </section>
  );
}
