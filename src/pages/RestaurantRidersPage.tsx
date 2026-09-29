import { FormEvent, useEffect, useState } from 'react';
import { supabase, supabaseGet } from '../services/supabaseClient';

type RiderAccount = {
  id: string;
  name: string;
  mobileNumber: string;
  email: string;
  scopes: string[];
};

type RiderRow = {
  id: string;
  name: string;
  mobile_number: string;
  email: string | null;
};

type ScopeRow = {
  rider_id: string;
  scope_name: string;
};

export function RestaurantRidersPage({ restaurantId }: { restaurantId: string }) {
  const [riders, setRiders] = useState<RiderAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingRider, setEditingRider] = useState<RiderAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [riderToDelete, setRiderToDelete] = useState<RiderAccount | null>(null);

  async function loadRiders() {
    setLoading(true);
    setError('');

    try {
      const [riderRows, scopeRows] = await Promise.all([
        supabaseGet<RiderRow>('restaurant_riders', {
          select: 'id,name,mobile_number,email',
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

  function parseScopes(scopeText: string) {
    return [...new Set(scopeText.split(',').map((scope) => scope.trim()).filter(Boolean))];
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setSaving(true);
    setError('');

    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const mobileNumber = String(form.get('mobileNumber') || '').trim();
    const email = String(form.get('email') || '').trim();
    const scopes = parseScopes(String(form.get('scope') || ''));

    try {
      const { data, error: functionError } = await supabase.functions.invoke('create-rider', {
        body: {
          restaurantId,
          name,
          mobileNumber,
          email,
          scopes,
        },
      });

      if (functionError) {
        let message = functionError.message || 'Unable to create rider account.';
        if (functionError.context instanceof Response) {
          try {
            const payload = await functionError.context.clone().json();
            if (payload?.error) message = payload.error;
          } catch {
            // Keep the function error message when the response is not JSON.
          }
        }
        throw new Error(message);
      }

      if (!data?.rider?.auth_user_id) {
        throw new Error('Rider was created, but the Supabase Auth account was not linked.');
      }

      event.currentTarget.reset();
      setShowForm(false);
      await loadRiders();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to add rider.');
    } finally {
      setSaving(false);
    }
  }

  async function handleEditRider(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !editingRider) {
      return;
    }

    setSaving(true);
    setError('');

    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const mobileNumber = String(form.get('mobileNumber') || '').trim();
    const email = String(form.get('email') || '').trim();
    const scopes = parseScopes(String(form.get('scope') || ''));

    try {
      const { error: riderError } = await supabase
        .from('restaurant_riders')
        .update({
          name,
          mobile_number: mobileNumber,
          email: email || null,
        })
        .eq('id', editingRider.id)
        .eq('restaurant_id', restaurantId);

      if (riderError) throw riderError;

      const { error: deleteScopesError } = await supabase
        .from('rider_delivery_scopes')
        .delete()
        .eq('rider_id', editingRider.id);

      if (deleteScopesError) throw deleteScopesError;

      if (scopes.length) {
        const { error: scopeError } = await supabase
          .from('rider_delivery_scopes')
          .insert(scopes.map((scope_name) => ({ rider_id: editingRider.id, scope_name })));
        if (scopeError) throw scopeError;
      }

      setEditingRider(null);
      await loadRiders();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'Unable to update rider.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRider() {
    if (!supabase || !riderToDelete) return;

    setDeleting(true);
    setError('');

    try {
      const { error: deleteError } = await supabase
        .from('restaurant_riders')
        .delete()
        .eq('id', riderToDelete.id)
        .eq('restaurant_id', restaurantId);

      if (deleteError) throw deleteError;

      setRiderToDelete(null);
      await loadRiders();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete rider.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="restaurant-riders-page">
      <div className="restaurant-riders-header">
        <div>
          <p className="eyebrow">Delivery team</p>
          <h1>Riders</h1>
          <p>Manage the in-house riders who deliver this restaurant's orders.</p>
          <p className="restaurant-riders-count">
            {riders.length} {riders.length === 1 ? 'rider' : 'riders'}
          </p>
        </div>
        <button className="button button-primary" type="button" onClick={() => setShowForm((current) => !current)}>
          {showForm ? 'Close' : 'Add Rider'}
        </button>
      </div>

      {error ? <div className="restaurant-riders-error" role="alert">{error}</div> : null}

      {showForm ? (
        <form className="restaurant-rider-form" onSubmit={handleSubmit}>
          <div className="restaurant-rider-form-heading">
            <div>
              <p className="eyebrow">New rider</p>
              <h2>Add rider</h2>
            </div>
            <p>The restaurant owner creates the rider record and sends the rider an Auth invitation.</p>
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
              <input name="email" type="email" placeholder="rider@example.com" required />
            </label>
            <label>
              Delivery scope
              <input name="scope" type="text" placeholder="Dalandanan, Malinta, Arkong Bato" />
            </label>
          </div>

          <p className="restaurant-rider-form-help">A Supabase Auth account is created automatically and an invitation email is sent to the rider so they can set their password.</p>

          <div className="restaurant-rider-form-actions">
            <button className="button button-secondary" type="button" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
            <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Creating…' : 'Add Rider'}</button>
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
              </div>
              <p>{rider.mobileNumber}</p>
              {rider.email ? <p>{rider.email}</p> : null}
              <div className="restaurant-rider-scope">
                <span>Delivery scope</span>
                <strong>{rider.scopes.length ? rider.scopes.join(' · ') : 'Not assigned'}</strong>
              </div>
            </div>
            <div className="restaurant-rider-actions">
              <button className="button button-secondary" type="button" onClick={() => setEditingRider(rider)} disabled={saving || deleting}>Edit</button>
              <button className="button button-danger" type="button" onClick={() => setRiderToDelete(rider)} disabled={deleting || saving}>
                Delete Rider
              </button>
            </div>
          </article>
        ))}
      </div>

      {editingRider ? (
        <div className="restaurant-rider-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setEditingRider(null);
        }}>
          <form className="restaurant-rider-modal restaurant-rider-edit-modal" onSubmit={handleEditRider}>
            <div className="restaurant-rider-modal-header">
              <div>
                <p className="eyebrow">Edit rider</p>
                <h2>Update rider details</h2>
              </div>
              <button className="restaurant-rider-modal-close" type="button" onClick={() => setEditingRider(null)} disabled={saving} aria-label="Close edit rider dialog">
                ×
              </button>
            </div>

            <div className="restaurant-rider-form-grid">
              <label>
                Rider name
                <input name="name" type="text" defaultValue={editingRider.name} required />
              </label>
              <label>
                Mobile number
                <input name="mobileNumber" type="tel" defaultValue={editingRider.mobileNumber} required />
              </label>
              <label>
                Login email
                <input name="email" type="email" defaultValue={editingRider.email} />
              </label>
              <label>
                Delivery scope
                <input name="scope" type="text" defaultValue={editingRider.scopes.join(', ')} placeholder="Dalandanan, Malinta, Arkong Bato" />
              </label>
            </div>

            <p className="restaurant-rider-form-help">Separate multiple delivery areas with commas.</p>

            <div className="restaurant-rider-modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setEditingRider(null)} disabled={saving}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {riderToDelete ? (
        <div className="restaurant-rider-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !deleting) setRiderToDelete(null);
        }}>
          <div className="restaurant-rider-modal" role="dialog" aria-modal="true" aria-labelledby="delete-rider-title">
            <div className="restaurant-rider-modal-icon" aria-hidden="true">!</div>
            <h2 id="delete-rider-title">Delete this rider?</h2>
            <p>
              You are about to permanently remove <strong>{riderToDelete.name}</strong> from your restaurant's rider list.
            </p>
            <p className="restaurant-rider-modal-warning">
              This action cannot be undone. The rider's delivery scope will also be removed. Existing orders will not be deleted.
            </p>
            <div className="restaurant-rider-modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setRiderToDelete(null)} disabled={deleting}>
                Keep Rider
              </button>
              <button className="button button-danger" type="button" onClick={() => void handleDeleteRider()} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete Rider'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
