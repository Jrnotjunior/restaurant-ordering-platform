import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_OUT_OF_SCOPE_MESSAGE,
  deleteRestaurantDeliveryZone,
  getRestaurantDeliveryZones,
  type RestaurantDeliveryZone,
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
  const [zones, setZones] = useState<ZoneDraft[]>([]);
  const [searchBarangay, setSearchBarangay] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadSettings() {
    setLoading(true);
    setError('');
    try {
      const deliveryZones = await getRestaurantDeliveryZones(restaurantId);
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

  function addZone() {
    setZones((current) => [
      ...current,
      { id: '', barangay: '', shippingFee: '0', isSupported: true, outOfScopeMessage: DEFAULT_OUT_OF_SCOPE_MESSAGE },
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

  const filteredZones = useMemo(() => {
    const query = searchBarangay.trim().toLowerCase();
    if (!query) return zones;
    return zones.filter((zone) => zone.barangay.toLowerCase().includes(query));
  }, [zones, searchBarangay]);

  return (
    <section className="restaurant-shipping-page">
      <style>{`
        .restaurant-shipping-search{display:flex;align-items:center;gap:10px;margin:18px 0 14px}
        .restaurant-shipping-search-input-wrap{position:relative;flex:1;max-width:620px}
        .restaurant-shipping-search input{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:11px 40px 11px 12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-shipping-search input:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-shipping-search-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:0;border-radius:999px;background:#f1f5f9;color:#475569;font-size:18px;line-height:1;cursor:pointer}
        .restaurant-shipping-search-label{font-size:14px;font-weight:600;color:#475569;white-space:nowrap}
        .restaurant-shipping-search-empty{padding:18px 0;color:#64748b}
        @media(max-width:600px){.restaurant-shipping-search{align-items:stretch;flex-direction:column}.restaurant-shipping-search-label{white-space:normal}.restaurant-shipping-search-input-wrap{max-width:none}}
      `}</style>

      <div className="restaurant-shipping-header">
        <div>
          <p className="eyebrow">Restaurant settings</p>
          <h1>Shipping Fee</h1>
          <p>Set delivery fees by barangay and choose which areas are within your delivery coverage.</p>
        </div>
      </div>

      {error && <div className="restaurant-shipping-message is-error" role="alert">{error}</div>}
      {message && <div className="restaurant-shipping-message is-success" role="status">{message}</div>}

      <div className="restaurant-shipping-card restaurant-delivery-zones-card">
        <div className="restaurant-shipping-section-header">
          <div>
            <h2>Delivery by Barangay</h2>
            <p className="restaurant-shipping-help">Your restaurant's configured delivery areas are shown here. The restaurant owner can edit the shipping fee for each area.</p>
          </div>
          <button type="button" className="button" onClick={addZone} disabled={loading || saving}>+ Add Barangay</button>
        </div>

        <div className="restaurant-shipping-search">
          <label className="restaurant-shipping-search-label" htmlFor="restaurant-barangay-search">Search barangay</label>
          <div className="restaurant-shipping-search-input-wrap">
            <input
              id="restaurant-barangay-search"
              type="search"
              value={searchBarangay}
              onChange={(event) => setSearchBarangay(event.target.value)}
              placeholder="Search by barangay name"
            />
            {searchBarangay && (
              <button type="button" className="restaurant-shipping-search-clear" onClick={() => setSearchBarangay('')} aria-label="Clear barangay search">×</button>
            )}
          </div>
        </div>

        {loading ? <p>Loading delivery areas…</p> : filteredZones.length === 0 ? (
          <div className="restaurant-shipping-empty restaurant-shipping-search-empty">
            {zones.length === 0 ? 'No barangays configured yet. Add the areas where your restaurant delivers.' : `No barangay found for “${searchBarangay}”.`}
          </div>
        ) : (
          <div className="restaurant-delivery-zone-list">
            {filteredZones.map((zone) => {
              const index = zones.findIndex((item) => item === zone);
              return (
                <div className="restaurant-delivery-zone" key={zone.id || `new-${index}`}>
                  <div className="restaurant-delivery-zone-grid">
                    <label>
                      <span>Barangay</span>
                      <input
                        type="text"
                        value={zone.barangay}
                        readOnly={Boolean(zone.id)}
                        onChange={(event) => updateZone(index, { barangay: event.target.value })}
                        placeholder="e.g. Barangay Bagbag"
                        aria-label={`Barangay ${zone.barangay || index + 1}`}
                      />
                    </label>
                    <label>
                      <span>Shipping fee</span>
                      <div className="restaurant-shipping-input">
                        <span>₱</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={zone.shippingFee}
                          onChange={(event) => updateZone(index, { shippingFee: event.target.value })}
                          aria-label={`Shipping fee for ${zone.barangay || 'barangay'}`}
                        />
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
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
