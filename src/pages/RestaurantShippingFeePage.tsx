import { useEffect, useState } from 'react';
import {
  DEFAULT_OUT_OF_SCOPE_MESSAGE,
  deleteRestaurantDeliveryZone,
  getRestaurantDeliveryZones,
  getRestaurantShippingFee,
  type RestaurantDeliveryZone,
  updateRestaurantShippingFee,
  upsertRestaurantDeliveryZone,
} from '../services/restaurantSettingsRepository';

type Props = { restaurantId: string };

type ZoneDraft = {
  id: string;
  barangay: string;
  shippingFee: string;
  isSupported: boolean;
  outOfScopeMessage: string;
};

function toDraft(zone: RestaurantDeliveryZone): ZoneDraft {
  return {
    id: zone.id,
    barangay: zone.barangay,
    shippingFee: String(zone.shippingFee),
    isSupported: zone.isSupported,
    outOfScopeMessage: zone.outOfScopeMessage,
  };
}

export function RestaurantShippingFeePage({ restaurantId }: Props) {
  const [shippingFee, setShippingFee] = useState('0');
  const [zones, setZones] = useState<ZoneDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadSettings() {
    setLoading(true);
    setError('');
    try {
      const [fee, deliveryZones] = await Promise.all([
        getRestaurantShippingFee(restaurantId),
        getRestaurantDeliveryZones(restaurantId),
      ]);
      setShippingFee(String(fee));
      setZones(deliveryZones.map(toDraft));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load shipping settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, [restaurantId]);

  async function handleSaveDefaultFee() {
    const fee = Number(shippingFee);
    if (!Number.isFinite(fee) || fee < 0) {
      setError('Enter a valid default shipping fee of ₱0 or more.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const normalizedFee = Math.round(fee * 100) / 100;
      await updateRestaurantShippingFee(restaurantId, normalizedFee);
      setShippingFee(String(normalizedFee));
      setMessage('Default shipping fee saved successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save shipping fee.');
    } finally {
      setSaving(false);
    }
  }

  function addZone() {
    setZones((current) => [
      ...current,
      { id: '', barangay: '', shippingFee: shippingFee || '0', isSupported: true, outOfScopeMessage: DEFAULT_OUT_OF_SCOPE_MESSAGE },
    ]);
    setMessage('');
    setError('');
  }

  function updateZone(index: number, patch: Partial<ZoneDraft>) {
    setZones((current) => current.map((zone, zoneIndex) => zoneIndex === index ? { ...zone, ...patch } : zone));
    setMessage('');
    setError('');
  }

  async function handleSaveZone(index: number) {
    const zone = zones[index];
    if (!zone?.barangay.trim()) {
      setError('Enter a barangay name before saving.');
      return;
    }
    const fee = Number(zone.shippingFee);
    if (!Number.isFinite(fee) || fee < 0) {
      setError('Enter a valid barangay shipping fee of ₱0 or more.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      await upsertRestaurantDeliveryZone(restaurantId, {
        id: zone.id,
        barangay: zone.barangay,
        shippingFee: Math.round(fee * 100) / 100,
        isSupported: zone.isSupported,
        outOfScopeMessage: zone.outOfScopeMessage,
      });
      await loadSettings();
      setMessage(`${zone.barangay.trim()} delivery setting saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save delivery area.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteZone(index: number) {
    const zone = zones[index];
    if (!zone) return;
    if (!zone.id) {
      setZones((current) => current.filter((_, zoneIndex) => zoneIndex !== index));
      return;
    }
    if (!window.confirm(`Remove ${zone.barangay} from your delivery areas?`)) return;

    setSaving(true);
    setError('');
    try {
      await deleteRestaurantDeliveryZone(restaurantId, zone.id);
      await loadSettings();
      setMessage('Delivery area removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove delivery area.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="restaurant-shipping-page">
      <div className="restaurant-shipping-header">
        <div>
          <a className="restaurant-shipping-back" href="#restaurant/dashboard">← Back to Dashboard</a>
          <p className="eyebrow">Restaurant settings</p>
          <h1>Shipping Fee</h1>
          <p>Set delivery fees by barangay and choose which areas are within your delivery coverage.</p>
        </div>
      </div>

      {error && <div className="restaurant-shipping-message is-error" role="alert">{error}</div>}
      {message && <div className="restaurant-shipping-message is-success" role="status">{message}</div>}

      <div className="restaurant-shipping-card">
        <h2>Default delivery fee</h2>
        <p className="restaurant-shipping-help">This is used when a customer's barangay does not have a specific fee configured.</p>
        <label htmlFor="restaurant-shipping-fee-page">Shipping fee</label>
        <div className="restaurant-shipping-input">
          <span>₱</span>
          <input id="restaurant-shipping-fee-page" type="number" min="0" step="0.01" inputMode="decimal" value={shippingFee} onChange={(event) => setShippingFee(event.target.value)} disabled={loading || saving} />
        </div>
        <button type="button" className="button" onClick={() => void handleSaveDefaultFee()} disabled={loading || saving}>
          {saving ? 'Saving…' : 'Save Default Fee'}
        </button>
      </div>

      <div className="restaurant-shipping-card restaurant-delivery-zones-card">
        <div className="restaurant-shipping-section-header">
          <div>
            <h2>Delivery by Barangay</h2>
            <p className="restaurant-shipping-help">Set a different fee for each barangay. You can mark far areas as outside your delivery coverage.</p>
          </div>
          <button type="button" className="button" onClick={addZone} disabled={loading || saving}>+ Add Barangay</button>
        </div>

        {loading ? <p>Loading delivery areas…</p> : zones.length === 0 ? (
          <div className="restaurant-shipping-empty">No barangays configured yet. Add the areas where your restaurant delivers.</div>
        ) : (
          <div className="restaurant-delivery-zone-list">
            {zones.map((zone, index) => (
              <div className="restaurant-delivery-zone" key={zone.id || `new-${index}`}>
                <div className="restaurant-delivery-zone-grid">
                  <label>
                    <span>Barangay</span>
                    <input type="text" value={zone.barangay} onChange={(event) => updateZone(index, { barangay: event.target.value })} placeholder="e.g. Barangay Bagbag" />
                  </label>
                  <label>
                    <span>Shipping fee</span>
                    <div className="restaurant-shipping-input">
                      <span>₱</span>
                      <input type="number" min="0" step="0.01" value={zone.shippingFee} onChange={(event) => updateZone(index, { shippingFee: event.target.value })} />
                    </div>
                  </label>
                  <label className="restaurant-delivery-zone-toggle">
                    <span>Delivery coverage</span>
                    <span className="restaurant-delivery-zone-toggle-row">
                      <input type="checkbox" checked={zone.isSupported} onChange={(event) => updateZone(index, { isSupported: event.target.checked })} />
                      <strong>{zone.isSupported ? 'Within our delivery' : 'Out of our delivery area'}</strong>
                    </span>
                  </label>
                </div>

                {!zone.isSupported && (
                  <label>
                    <span>Customer message</span>
                    <textarea rows={3} value={zone.outOfScopeMessage} onChange={(event) => updateZone(index, { outOfScopeMessage: event.target.value })} />
                    <small>Suggested: This area is outside our delivery coverage. If you want to proceed, please book your own courier like Lalamove or Grab Express.</small>
                  </label>
                )}

                <div className="restaurant-delivery-zone-actions">
                  <button type="button" className="button button-primary" onClick={() => void handleSaveZone(index)} disabled={saving || !zone.barangay.trim()}>{saving ? 'Saving…' : 'Save'}</button>
                  <button type="button" className="button" onClick={() => void handleDeleteZone(index)} disabled={saving}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
