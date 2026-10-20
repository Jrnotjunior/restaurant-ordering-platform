import { useEffect, useState } from 'react';
import {
  BRANCH_DAYS, branchToDraft, createRestaurantBranch, listRestaurantBranches, makeDefaultBranchDraft,
  setDefaultRestaurantBranch, updateRestaurantBranch,
} from '../branchService';
import type { BranchDayHours, RestaurantBranch, RestaurantBranchDraft } from '../branchTypes';
import '../branch.css';

type Props = { restaurantId: string; refreshToken?: number; onBranchSettingsChanged?: () => void | Promise<void> };
const numberOrNull = (value: string) => value.trim() === '' ? null : Number(value);

export function BranchManagementPanel({ restaurantId, refreshToken = 0, onBranchSettingsChanged }: Props) {
  const [branches, setBranches] = useState<RestaurantBranch[]>([]);
  const [draft, setDraft] = useState<RestaurantBranchDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function reload() {
    setLoading(true);
    try {
      setBranches(await listRestaurantBranches(restaurantId, true));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load branches.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, [restaurantId, refreshToken]);

  function startNew() {
    setEditingId(null);
    setDraft(makeDefaultBranchDraft());
    setError('');
    setMessage('');
  }

  function edit(branch: RestaurantBranch) {
    setEditingId(branch.id);
    setDraft(branchToDraft(branch));
    setError('');
    setMessage('');
  }

  function updateDraft<K extends keyof RestaurantBranchDraft>(key: K, value: RestaurantBranchDraft[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  function updateHours(day: string, patch: Partial<BranchDayHours>) {
    setDraft((current) => current ? ({
      ...current,
      operating_hours: {
        ...current.operating_hours,
        [day]: { ...current.operating_hours[day], ...patch },
      },
    }) : current);
  }

  async function saveDraft() {
    if (!draft || saving) return;
    const code = draft.branch_code.trim().toUpperCase();
    if (!code || !/^[A-Z0-9_-]{2,20}$/.test(code)) {
      setError('Branch code must be 2–20 characters using only A–Z, 0–9, hyphens or underscores.');
      return;
    }
    if (!draft.name.trim()) { setError('Enter a branch name.'); return; }
    const domain = draft.custom_domain.trim().toLowerCase();
    if (domain && (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain) || domain.includes('..'))) {
      setError('Enter a hostname only, such as north.example.com. Do not include https:// or a path.');
      return;
    }
    if (!draft.store_address.trim() && !draft.restaurant_address.trim()) { setError('Enter this branch’s store / pickup address before saving.'); return; }
    const lat = draft.delivery_location_latitude;
    const lng = draft.delivery_location_longitude;
    if ((lat === null) !== (lng === null)) {
      setError('Enter both delivery coordinates, or leave both blank.');
      return;
    }
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
      setError('Latitude must be between -90 and 90.');
      return;
    }
    if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
      setError('Longitude must be between -180 and 180.');
      return;
    }
    if (!Number.isFinite(draft.delivery_base_fee) || draft.delivery_base_fee < 0
      || !Number.isFinite(draft.delivery_distance_increment_meters) || draft.delivery_distance_increment_meters <= 0
      || !Number.isFinite(draft.delivery_fee_per_increment) || draft.delivery_fee_per_increment < 0
      || !Number.isFinite(draft.delivery_max_distance_meters) || draft.delivery_max_distance_meters <= 0) {
      setError('Enter valid non-negative delivery fees and positive distance values.');
      return;
    }
    if (draft.is_active === false && branches.find((branch) => branch.id === editingId)?.is_default) {
      setError('Set another active branch as the default before deactivating this branch.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const normalized = { ...draft, branch_code: code, custom_domain: domain };
      if (editingId) await updateRestaurantBranch(editingId, restaurantId, normalized);
      else await createRestaurantBranch(restaurantId, normalized);
      setDraft(null);
      setEditingId(null);
      await reload();
      setMessage(editingId ? 'Branch settings saved.' : 'Branch created.');
      await onBranchSettingsChanged?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save branch.');
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(branch: RestaurantBranch) {
    if (saving || !branch.is_active) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await setDefaultRestaurantBranch(restaurantId, branch.id);
      await reload();
      setMessage(`${branch.name} is now the default branch.`);
      await onBranchSettingsChanged?.();
    } catch (defaultBranchError) {
      setError(defaultBranchError instanceof Error ? defaultBranchError.message : 'Unable to change the default branch.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(branch: RestaurantBranch) {
    if (saving) return;
    if (branch.is_default && branch.is_active) {
      setError('Set another active branch as the default before deactivating this branch.');
      return;
    }
    const branchDraft = branchToDraft(branch);
    branchDraft.is_active = !branch.is_active;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await updateRestaurantBranch(branch.id, restaurantId, branchDraft);
      await reload();
      setMessage(`${branch.name} ${branchDraft.is_active ? 'activated' : 'deactivated'}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update branch.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="w2t-branches-manager" aria-label="Branch management">
      <div className="w2t-branches-manager-header">
        <div><h3>Business branches</h3><p>Each branch can have its own storefront domain and styling, managed from this one owner platform. Branches currently share the restaurant menu and PayMongo connection.</p></div>
        <button type="button" className="button button-primary" onClick={startNew} disabled={saving || Boolean(draft)}>Add branch</button>
      </div>
      {error && <div className="w2t-branch-manager-error" role="alert">{error}</div>}
      {message && <div className="w2t-branch-manager-message" role="status">{message}</div>}
      {loading ? <p className="restaurant-settings-help">Loading branches…</p> : (
        <div className="w2t-branches-list">
          {branches.map((branch) => (
            <article className="w2t-branch-admin-card" key={branch.id}>
              <div className="w2t-branch-admin-copy">
                <div className="w2t-branch-admin-title">
                  <strong>{branch.name}</strong>
                  <span className="w2t-branch-admin-badge">{branch.branch_code}</span>
                  {branch.is_default && <span className="w2t-branch-admin-badge is-default">Default</span>}
                  {!branch.is_active && <span className="w2t-branch-admin-badge is-inactive">Inactive</span>}
                </div>
                <p>{branch.restaurant_address || branch.store_address || 'No address configured'}</p>
                <p>{branch.custom_domain ? `Website: ${branch.custom_domain}` : 'Website domain not assigned'}</p>
                <p>{branch.ordering_enabled ? 'Online ordering enabled' : 'Online ordering paused'} · {branch.is_active ? 'Branch active' : 'Branch inactive'}</p>
              </div>
              <div className="w2t-branch-admin-actions">
                <button type="button" onClick={() => edit(branch)} disabled={saving || Boolean(draft)}>Edit</button>
                {!branch.is_default && <button type="button" onClick={() => void makeDefault(branch)} disabled={saving || !branch.is_active}>Make default</button>}
                <button type="button" onClick={() => void toggleActive(branch)} disabled={saving || (branch.is_default && branch.is_active)}>{branch.is_active ? 'Deactivate' : 'Activate'}</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {draft && (
        <div className="w2t-branch-editor">
          <h4>{editingId ? 'Edit branch' : 'Create branch'}</h4>
          <div className="w2t-branch-editor-grid">
            <label className="w2t-branch-editor-field"><span>Branch name</span><input value={draft.name} maxLength={100} onChange={(event) => updateDraft('name', event.target.value)} disabled={saving} placeholder="e.g. Quezon City" /></label>
            <label className="w2t-branch-editor-field"><span>Branch code</span><input value={draft.branch_code} maxLength={20} onChange={(event) => updateDraft('branch_code', event.target.value.toUpperCase())} disabled={saving} placeholder="e.g. QC01" /></label>
            <label className="w2t-branch-editor-field"><span>Storefront website domain</span><input value={draft.custom_domain} maxLength={253} onChange={(event) => updateDraft('custom_domain', event.target.value.toLowerCase())} disabled={saving} placeholder="e.g. north.example.com" /><small className="w2t-branch-domain-hint">Enter the hostname only. DNS and HTTPS hosting must also be configured for this domain to go live.</small></label>
            <label className="w2t-branch-editor-field"><span>Store / pickup address</span><input value={draft.store_address} maxLength={300} onChange={(event) => { updateDraft('store_address', event.target.value); updateDraft('restaurant_address', event.target.value); }} disabled={saving} placeholder="Branch street address" /></label>
            <label className="w2t-branch-editor-field"><span>Contact number</span><input value={draft.contact_number} maxLength={40} onChange={(event) => updateDraft('contact_number', event.target.value)} disabled={saving} placeholder="Branch contact number" /></label>
            <label className="w2t-branch-editor-field"><span>Delivery origin latitude</span><input inputMode="decimal" value={draft.delivery_location_latitude ?? ''} onChange={(event) => updateDraft('delivery_location_latitude', numberOrNull(event.target.value))} disabled={saving} placeholder="e.g. 14.5995" /></label>
            <label className="w2t-branch-editor-field"><span>Delivery origin longitude</span><input inputMode="decimal" value={draft.delivery_location_longitude ?? ''} onChange={(event) => updateDraft('delivery_location_longitude', numberOrNull(event.target.value))} disabled={saving} placeholder="e.g. 120.9842" /></label>
            <label className="w2t-branch-editor-field"><span>Base delivery fee (₱)</span><input type="number" min="0" step="0.01" value={draft.delivery_base_fee} onChange={(event) => updateDraft('delivery_base_fee', Number(event.target.value))} disabled={saving} /></label>
            <label className="w2t-branch-editor-field"><span>Distance increment (meters)</span><input type="number" min="1" step="1" value={draft.delivery_distance_increment_meters} onChange={(event) => updateDraft('delivery_distance_increment_meters', Number(event.target.value))} disabled={saving} /></label>
            <label className="w2t-branch-editor-field"><span>Fee per increment (₱)</span><input type="number" min="0" step="0.01" value={draft.delivery_fee_per_increment} onChange={(event) => updateDraft('delivery_fee_per_increment', Number(event.target.value))} disabled={saving} /></label>
            <label className="w2t-branch-editor-field"><span>Maximum delivery distance (meters)</span><input type="number" min="1" step="1" value={draft.delivery_max_distance_meters} onChange={(event) => updateDraft('delivery_max_distance_meters', Number(event.target.value))} disabled={saving} /></label>
          </div>
          <label className="w2t-branch-toggle"><input type="checkbox" checked={draft.is_active} onChange={(event) => updateDraft('is_active', event.target.checked)} disabled={saving || Boolean(editingId && branches.find((branch) => branch.id === editingId)?.is_default)} /> Branch is active</label>
          <label className="w2t-branch-toggle"><input type="checkbox" checked={draft.ordering_enabled} onChange={(event) => updateDraft('ordering_enabled', event.target.checked)} disabled={saving} /> Accept online orders</label>
          <div className="w2t-branch-hours">
            <strong>Operating hours</strong>
            {BRANCH_DAYS.map((day) => {
              const hours = draft.operating_hours[day.key];
              return <div className="w2t-branch-hours-row" key={day.key}>
                <strong>{day.label}</strong>
                <label><input type="checkbox" checked={hours?.isOpen !== false} onChange={(event) => updateHours(day.key, { isOpen: event.target.checked })} disabled={saving} /> Open</label>
                <input aria-label={day.label + ' opens'} type="time" value={hours?.open ?? '09:00'} onChange={(event) => updateHours(day.key, { open: event.target.value })} disabled={saving || hours?.isOpen === false} />
                <input aria-label={day.label + ' closes'} type="time" value={hours?.close ?? '21:00'} onChange={(event) => updateHours(day.key, { close: event.target.value })} disabled={saving || hours?.isOpen === false} />
              </div>;
            })}
          </div>
          <div className="w2t-branch-form-actions">
            <button type="button" onClick={() => { setDraft(null); setEditingId(null); setError(''); }} disabled={saving}>Cancel</button>
            <button type="button" className="primary" onClick={() => void saveDraft()} disabled={saving}>{saving ? 'Saving…' : 'Save branch'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
