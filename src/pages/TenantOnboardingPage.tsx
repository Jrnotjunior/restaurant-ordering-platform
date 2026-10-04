import { useEffect, useState, type FormEvent } from 'react';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { supabase } from '../services/supabaseClient';

type Invitation = {
  id: string;
  email: string;
  expires_at: string;
};

export function TenantOnboardingPage() {
  const { user, loading: authLoading } = useRestaurantOwnerAuth();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSet, setPasswordSet] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [tagline, setTagline] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [location, setLocation] = useState('');
  const [contactNumber, setContactNumber] = useState('');
  const [restaurantEmail, setRestaurantEmail] = useState('');

  useEffect(() => {
    if (authLoading) return;

    if (!user || !supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const currentUser = user;
    const client = supabase;

    async function loadInvitation() {
      setLoading(true);
      setError('');

      const { data, error: invitationError } = await client.rpc(
        'get_my_pending_tenant_invitation',
      );

      if (cancelled) return;

      if (invitationError) {
        setError(invitationError.message);
        setLoading(false);
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      setInvitation(row ?? null);
      setRestaurantEmail(currentUser.email ?? '');
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

    setPassword('');
    setConfirmPassword('');
    setPasswordSet(true);
    setSaving(false);
  }

  async function createRestaurant(event: FormEvent) {
    event.preventDefault();
    if (!invitation || !supabase) return;

    setSaving(true);
    setError('');

    const { data, error: createError } = await supabase.rpc(
      'create_restaurant_from_tenant_invitation',
      {
        p_invitation_id: invitation.id,
        p_name: name.trim(),
        p_slug: slug.trim().toLowerCase(),
        p_tagline: tagline.trim(),
        p_logo_url: logoUrl.trim() || null,
        p_location_text: location.trim() || null,
        p_contact_number: contactNumber.trim() || null,
        p_email: restaurantEmail.trim() || null,
      },
    );

    if (createError) {
      setError(createError.message);
      setSaving(false);
      return;
    }

    const restaurant = Array.isArray(data) ? data[0] : data;

    if (!restaurant?.restaurant_id) {
      setError('Restaurant was created but no restaurant ID was returned.');
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
        <h1>Create your restaurant.</h1>
        <p>
          Your Web2Table tenant has been invited. This is where you create the
          restaurant identity that belongs to your business.
        </p>

        {!passwordSet ? (
          <form className="restaurant-form" onSubmit={setOwnerPassword}>
            <h2>Set your password</h2>
            <p>Secure your tenant owner account before creating your restaurant identity.</p>

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
                {saving ? 'Saving password…' : 'Set password and continue'}
              </button>
            </div>
          </form>
        ) : (
        <form className="restaurant-form" onSubmit={createRestaurant}>
          <div className="form-grid">
            <label>
              Restaurant name
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>

            <label>
              Restaurant slug
              <input
                value={slug}
                onChange={(event) => setSlug(event.target.value.toLowerCase())}
                placeholder="my-restaurant"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                title="Use lowercase letters, numbers, and single hyphens."
                required
              />
            </label>
          </div>

          <label>
            Tagline
            <input value={tagline} onChange={(event) => setTagline(event.target.value)} placeholder="Fresh food, made for you." />
          </label>

          <label>
            Logo URL
            <input type="url" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://..." />
          </label>

          <label>
            Location
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Branch address or location" />
          </label>

          <div className="form-grid">
            <label>
              Contact number
              <input value={contactNumber} onChange={(event) => setContactNumber(event.target.value)} />
            </label>

            <label>
              Restaurant email
              <input type="email" value={restaurantEmail} onChange={(event) => setRestaurantEmail(event.target.value)} />
            </label>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="modal-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Creating restaurant…' : 'Create my restaurant'}
            </button>
          </div>
        </form>
        )}
      </div>
    </section>
  );
}
