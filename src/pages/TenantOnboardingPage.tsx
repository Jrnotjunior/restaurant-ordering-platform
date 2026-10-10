import { useEffect, useState, type FormEvent } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';
import { getPasswordPolicyError, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '../utils/passwordPolicy';

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
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

  async function setOwnerPassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;

    setSaving(true);
    setError('');

    const passwordPolicyError = getPasswordPolicyError(password);
    if (passwordPolicyError) {
      setError(passwordPolicyError);
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
          {restaurantName || 'Your restaurant'} is ready. Create your password to finish setup and enter your restaurant dashboard.
        </p>

        <form className="tenant-onboarding-form" onSubmit={(event) => void setOwnerPassword(event)}>
          <label>
            Email
            <input
              type="email"
              value={user.email ?? invitation.email}
              readOnly
              autoComplete="email"
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
              placeholder="Create your password"
              disabled={saving}
              required
            />
          </label>

          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH}
              autoComplete="new-password"
              placeholder="Re-enter your password"
              disabled={saving}
              required
            />
          </label>

          <p className="tenant-onboarding-password-hint">Use at least 8 characters, avoid common passwords, and consider mixing letters, numbers, and symbols.</p>

          {error && <div className="tenant-onboarding-error" role="alert">{error}</div>}

          <button className="tenant-onboarding-submit" type="submit" disabled={saving}>
            {saving ? 'Setting up account…' : 'Create account'}
          </button>
        </form>
      </div>
    </section>
  );
}
