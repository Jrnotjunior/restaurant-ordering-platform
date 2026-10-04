import { useEffect, useState, type FormEvent } from 'react';
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
  const { user, loading: authLoading } = useRestaurantOwnerAuth();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!user || !supabase) {
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
  }, [authLoading, user?.id]);

  async function setOwnerPassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;

    setSaving(true);
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      setSaving(false);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      setSaving(false);
      return;
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password });

    if (passwordError) {
      setError(passwordError.message);
      setSaving(false);
      return;
    }

    const { data: setupData, error: setupError } = await supabase.rpc('complete_tenant_owner_setup');

    if (setupError) {
      setError(setupError.message);
      setSaving(false);
      return;
    }

    const setup = Array.isArray(setupData) ? setupData[0] : setupData;
    if (!setup?.restaurant_id) {
      setError('Account setup completed, but the restaurant could not be confirmed.');
      setSaving(false);
      return;
    }

    window.history.replaceState({}, document.title, window.location.pathname);
    window.location.hash = '#restaurant/owner';
  }

  if (authLoading || loading) {
    return <section className="restaurant-owner-auth-loading">Preparing your tenant setup…</section>;
  }

  if (!user) {
    return (
      <section className="restaurant-owner-auth-no-restaurant">
        <div className="restaurant-owner-auth-no-restaurant-card">
          <p className="eyebrow">Tenant invitation</p>
          <h1>Sign in to continue.</h1>
          <p>Open the invitation email again to complete your tenant setup.</p>
        </div>
      </section>
    );
  }

  if (!invitation) {
    return (
      <section className="restaurant-owner-auth-no-restaurant">
        <div className="restaurant-owner-auth-no-restaurant-card">
          <p className="eyebrow">Tenant invitation</p>
          <h1>Invitation not available.</h1>
          <p>This invitation may have expired, already been used, or been revoked.</p>
          <p><strong>Signed in as:</strong> {user.email ?? user.id}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="restaurant-owner-auth-no-restaurant">
      <div className="restaurant-owner-auth-no-restaurant-card" style={{ maxWidth: 760, width: '100%' }}>
        <p className="eyebrow">Tenant onboarding</p>
        <h1>Finish your restaurant setup.</h1>
        <p>
          <strong>{restaurantName || 'Your restaurant'}</strong> has already been created by the
          Web2Table System Administrator, and its package access is already configured.
        </p>

        <form className="restaurant-form" onSubmit={setOwnerPassword}>
          <h2>Set your password</h2>
          <p>Secure your owner account, then you will be taken directly to your restaurant dashboard.</p>

          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>

          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={8}
              autoComplete="new-password"
              required
            />
          </label>

          {error && <div className="error-banner">{error}</div>}

          <div className="modal-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Finishing setup…' : 'Set password and enter restaurant'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
