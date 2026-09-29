import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseGet } from '../services/supabaseClient';

type RiderStatus = 'available' | 'delivering' | 'offline';

type RiderAccount = {
  id: string;
  name: string;
  mobileNumber: string;
  email: string;
  status: RiderStatus;
  scopes: string[];
};

type RiderRow = {
  id: string;
  name: string;
  mobile_number: string;
  email: string | null;
  status: RiderStatus;
};

type ScopeRow = {
  rider_id: string;
  scope_name: string;
};

function displayStatus(status: RiderStatus) {
  if (status === 'available') return 'Available';
  if (status === 'delivering') return 'Delivering';
  return 'Offline';
}

export function RestaurantRidersPage({ restaurantId }: { restaurantId: string }) {
  const [riders, setRiders] = useState<RiderAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableCount = useMemo(
    () => riders.filter((rider) => rider.status === 'available').length,
    [riders],
  );

  async function loadRiders() {
    setLoading(true);
    setError('');

    try {
      const [riderRows, scopeRows] = await Promise.all([
        supabaseGet<RiderRow>('restaurant_riders', {
          select: 'id,name,mobile_number,email,status',
          restaurant_id: `eq.${restaurantId}`,
          order: 'created_at.asc',
        }),
        supabaseGet<ScopeRow>('rider_delivery_scopes', {
          select: 'rider_id,scope_name',
          order: 'scope_name.asc',
        }),
      ]);

      const scopesByRider = new Map<string, string[]>();
      for (const scope of scopeRows) {
        const current = scopesByRider.get(scope.rider_id) ?? [];
        current.push(scope.scope_name);
        scopesByRider.set(scope.rider_id, current);
      }

      setRiders(riderRows.map((rider) => ({
        id: rider.id,
        name: rider.name,
        mobileNumber: rider.mobile_number,
        email: rider.email ?? '',
        status: rider.status,
        scopes: scopesByRider.get(rider.id) ?? [],
      })));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load riders.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRiders();
  }, [restaurantId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    const formElement = event.currentTarget;
    setSaving(true);
    setError('');

    const form = new FormData(formElement);
    const name = String(form.get('name') || '').trim();
    const mobileNumber = String(form.get('mobileNumber') || '').trim();
    const email = String(form.get('email') || '').trim();
    const scopeText = String(form.get('scope') || '');
    const scopes = [...new Set(scopeText.split(',').map((scope) => scope.trim()).filter(Boolean))];

    try {
      const { data: rider, error: riderError } = await supabase
        .from('restaurant_riders')
        .insert({
          restaurant_id: restaurantId,
          name,
          mobile_number: mobileNumber,
          email: email || null,
          status: 'available',
        })
        .select('id,name,mobile_number,email,status')
        .single();

      if (riderError) throw riderError;

      if (scopes.length) {
        const { error: scopeError } = await supabase
          .from('rider_delivery_scopes')
          .insert(scopes.map((scope_name) => ({ rider_id: rider.id, scope_name })));
        if (scopeError) throw scopeError;
      }

      formElement.reset();
      setShowForm(false);
      await loadRiders();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to add rider.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="restaurant-riders-page">
      <div className="restaurant-riders-header">
        <div>
          <p className="eyebrow">Delivery team</p>
          <h1>Riders</h1>
          <p>Manage the in-house riders who deliver this restaurant's orders.</p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setShowForm((current) => !current)}>
          {showForm ? 'Close' : 'Add Rider'}
        </button>
      </div>

      <div className="restaurant-riders-summary" aria-label="Rider summary">
        <div>
          <strong>{availableCount}</strong>
          <span>Available now</span>
        </div>
        <div>
          <strong>{riders.length}</strong>
          <span>Total riders</span>
        </div>
      </div>

      {error ? <div className="restaurant-riders-error" role="alert">{error}</div> : null}

      {showForm ? (
        <form className="restaurant-rider-form" onSubmit={handleSubmit}>
          <div className="restaurant-rider-form-heading">
            <div>
              <p className="eyebrow">New rider</p>
              <h2>Add rider</h2>
            </div>
            <p>The restaurant owner creates the rider record and assigns the delivery scope.</p>
          </div>

          <div className="restaurant-rider-form-grid">
            <label>
              Rider name
              <input name="name" type="text" placeholder="e.g. Juan Dela Cruz" required />
            </label>
            <label>
              Mobile number
              <input name="mobileNumber" type="tel" placeholder="09XX XXX XXXX" required />
            </label>
            <label>
              Login email
              <input name="email" type="email" placeholder="rider@example.com" />
            </label>
            <label>
              Delivery scope
              <input name="scope" type="text" placeholder="Dalandanan, Malinta, Arkong Bato" />
            </label>
          </div>

          <p className="restaurant-rider-form-help">Separate multiple delivery areas with commas. Rider login will be connected to Supabase Auth separately.</p>

          <div className="restaurant-rider-form-actions">
            <button className="button button-secondary" type="button" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add Rider'}</button>
          </div>
        </form>
      ) : null}

      <div className="restaurant-riders-list">
        {loading ? <div className="restaurant-riders-empty">Loading riders…</div> : riders.length === 0 ? <div className="restaurant-riders-empty">No riders have been added yet.</div> : riders.map((rider) => (
          <article className="restaurant-rider-card" key={rider.id}>
            <div className="restaurant-rider-avatar" aria-hidden="true">{rider.name.charAt(0).toUpperCase()}</div>
            <div className="restaurant-rider-details">
              <div className="restaurant-rider-name-row">
                <h2>{rider.name}</h2>
                <span className={`restaurant-rider-status restaurant-rider-status-${rider.status}`}>
                  {displayStatus(rider.status)}
                </span>
              </div>
              <p>{rider.mobileNumber}</p>
              {rider.email ? <p>{rider.email}</p> : null}
              <div className="restaurant-rider-scope">
                <span>Delivery scope</span>
                <strong>{rider.scopes.length ? rider.scopes.join(' · ') : 'Not assigned'}</strong>
              </div>
            </div>
            <div className="restaurant-rider-actions">
              <button className="button button-secondary" type="button" disabled>Edit</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
