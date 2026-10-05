import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_OUT_OF_SCOPE_MESSAGE,
  deleteRestaurantDeliveryZone,
  getRestaurantDeliveryZones,
  getRestaurantDeliverySettings,
  updateRestaurantDeliverySettings,
  type RestaurantDeliverySettings,
  type RestaurantDeliveryZone,
  upsertRestaurantDeliveryZone,
} from '../services/restaurantSettingsRepository';
import { DeliveryCoverageMap } from '../components/DeliveryCoverageMap';

type Props = { restaurantId: string };

type ZoneDraft = {
  id: string;
  city: string;
  barangay: string;
  shippingFee: string;
  isSupported: boolean;
  outOfScopeMessage: string;
};

function toDraft(zone: RestaurantDeliveryZone): ZoneDraft {
  return {
    id: zone.id,
    city: zone.city,
    barangay: zone.barangay,
    shippingFee: String(zone.shippingFee),
    isSupported: zone.isSupported,
    outOfScopeMessage: zone.outOfScopeMessage,
  };
}

export function RestaurantShippingFeePage({ restaurantId }: Props) {
  const [zones, setZones] = useState<ZoneDraft[]>([]);
  const [searchDeliveryZones, setSearchDeliveryZones] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<ZoneDraft | null>(null);
  const [deliverySettings, setDeliverySettings] = useState<RestaurantDeliverySettings | null>(null);
  const [deliverySettingsLoading, setDeliverySettingsLoading] = useState(true);
  const [deliverySettingsSaving, setDeliverySettingsSaving] = useState(false);
  const [deliverySettingsMessage, setDeliverySettingsMessage] = useState('');
  const [deliverySettingsError, setDeliverySettingsError] = useState('');

  async function loadSettings() {
    setLoading(true);
    setDeliverySettingsLoading(true);
    setError('');
    setDeliverySettingsError('');
    try {
      const [deliveryZones, radiusSettings] = await Promise.all([
        getRestaurantDeliveryZones(restaurantId),
        getRestaurantDeliverySettings(restaurantId),
      ]);
      setZones(deliveryZones.map(toDraft));
      setDeliverySettings(radiusSettings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load shipping settings.');
    } finally {
      setLoading(false);
      setDeliverySettingsLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, [restaurantId]);

  async function handleSaveDeliverySettings() {
    if (!deliverySettings) return;
    if (deliverySettings.deliveryLatitude == null || deliverySettings.deliveryLongitude == null) {
      setDeliverySettingsError('Pin the restaurant location on the map before saving.');
      return;
    }
    if (!Number.isFinite(deliverySettings.deliveryRadiusKm) || deliverySettings.deliveryRadiusKm <= 0) {
      setDeliverySettingsError('Enter a delivery radius greater than 0 km.');
      return;
    }
    if (!Number.isFinite(deliverySettings.deliveryFee) || deliverySettings.deliveryFee < 0) {
      setDeliverySettingsError('Enter a valid delivery fee of ₱0 or more.');
      return;
    }
    setDeliverySettingsSaving(true);
    setDeliverySettingsError('');
    setDeliverySettingsMessage('');
    try {
      await updateRestaurantDeliverySettings(restaurantId, deliverySettings);
      setDeliverySettingsMessage('Delivery coverage settings saved.');
    } catch (err) {
      setDeliverySettingsError(err instanceof Error ? err.message : 'Unable to save delivery coverage settings.');
    } finally {
      setDeliverySettingsSaving(false);
    }
  }
  function addZone() {
    setEditingIndex(null);
    setEditingDraft({ id: '', city: '', barangay: '', shippingFee: '0', isSupported: true, outOfScopeMessage: DEFAULT_OUT_OF_SCOPE_MESSAGE });
    setMessage('');
    setError('');
  }

  function openEditor(index: number) {
    setEditingIndex(index);
    setEditingDraft({ ...zones[index] });
    setMessage('');
    setError('');
  }

  function updateZone(patch: Partial<ZoneDraft>) {
    setEditingDraft((current) => current ? { ...current, ...patch } : current);
    setMessage('');
    setError('');
  }

  function closeEditor() {
    if (saving) return;
    setEditingIndex(null);
    setEditingDraft(null);
  }

  async function handleSaveZone() {
    const zone = editingDraft;
    if (!zone?.city.trim()) {
      setError('Enter a city before saving.');
      return;
    }
    if (!zone?.barangay.trim()) {
      setError('Enter a delivery area before saving.');
      return;
    }
    const fee = Number(zone.shippingFee);
    if (!Number.isFinite(fee) || fee < 0) {
      setError('Enter a valid delivery zone shipping fee of ₱0 or more.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      await upsertRestaurantDeliveryZone(restaurantId, {
        id: zone.id,
        city: zone.city,
        barangay: zone.barangay,
        shippingFee: Math.round(fee * 100) / 100,
        isSupported: zone.isSupported,
        outOfScopeMessage: zone.outOfScopeMessage,
      });
      await loadSettings();
      setEditingIndex(null);
      setMessage(`${zone.barangay.trim()} delivery zone saved.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save delivery area.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteZone() {
    if (editingIndex === null) {
      setEditingDraft(null);
      return;
    }
    const zone = zones[editingIndex];
    if (!zone) return;
    if (!window.confirm(`Remove ${zone.barangay} from your delivery zones?`)) return;

    setSaving(true);
    setError('');
    try {
      await deleteRestaurantDeliveryZone(restaurantId, zone.id);
      await loadSettings();
      setEditingIndex(null);
      setEditingDraft(null);
      setMessage('Delivery zone removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to remove delivery area.');
    } finally {
      setSaving(false);
    }
  }

  const filteredZones = useMemo(() => {
    const query = searchDeliveryZones.trim().toLowerCase();
    if (!query) return zones;
    return zones.filter((zone) => `${zone.city} ${zone.barangay}`.toLowerCase().includes(query));
  }, [zones, searchDeliveryZones]);

  const editingZone = editingDraft;

  return (
    <section className="restaurant-page restaurant-shipping-page">
      <style>{`
        .restaurant-delivery-radius-layout{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(280px,.8fr);gap:20px;align-items:start}
        .restaurant-delivery-radius-form{display:grid;gap:14px}
        .restaurant-delivery-radius-form label{display:grid;gap:6px;font-weight:600;font-size:14px}
        .restaurant-delivery-radius-form input[type=number]{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:11px 12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-delivery-radius-form input[type=number]:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-delivery-map-help{margin:8px 0 0;color:#64748b;font-size:13px}
        .restaurant-delivery-radius-coordinates{display:grid;gap:3px;padding:12px;border:1px solid #e1e5eb;border-radius:10px;background:#f8fafc}
        .restaurant-delivery-radius-coordinates span{font-size:12px;color:#64748b}
        .restaurant-delivery-radius-coordinates strong{font-size:13px;color:#0f172a}
        .delivery-map{width:100%;min-height:240px;border-radius:14px;overflow:hidden;border:1px solid #dbe2ea;background:#e2e8f0}
        .delivery-map-marker{width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:grid;place-items:center;background:#111827;border:3px solid #fff;box-shadow:0 3px 10px rgba(15,23,42,.3);cursor:grab}
        .delivery-map-marker span{font-size:13px;color:#fff;transform:rotate(45deg)}
        .delivery-map-marker:active{cursor:grabbing}
        .restaurant-shipping-search{display:flex;align-items:center;gap:10px;margin:18px 0 14px}
        .restaurant-shipping-search-input-wrap{position:relative;flex:1;max-width:360px}
        .restaurant-shipping-search input{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:11px 40px 11px 12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-shipping-search input:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-shipping-search-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:0;border-radius:999px;background:#f1f5f9;color:#475569;font-size:18px;line-height:1;cursor:pointer}
        .restaurant-shipping-search-label{font-size:14px;font-weight:600;color:#475569;white-space:nowrap}
        .restaurant-shipping-search-empty{padding:18px 0;color:#64748b}
        .restaurant-delivery-zone-list{display:grid;gap:8px}
        .restaurant-delivery-zone-row{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(130px,.65fr) minmax(190px,.9fr) 28px;align-items:center;gap:18px;width:100%;box-sizing:border-box;padding:14px 16px;border:1px solid #e1e5eb;border-radius:10px;background:#fff;cursor:pointer;text-align:left;transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}
        .restaurant-delivery-zone-row:hover{border-color:#cbd5e1;box-shadow:0 3px 12px rgba(15,23,42,.06);background:#fcfdff}
        .restaurant-delivery-zone-cell{min-width:0}
        .restaurant-delivery-zone-cell-label{display:block;margin-bottom:3px;font-size:11px;font-weight:600;color:#64748b}
        .restaurant-delivery-zone-cell-value{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:600;color:#0f172a}
        .restaurant-delivery-zone-fee{font-variant-numeric:tabular-nums}
        .restaurant-delivery-zone-coverage{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600;color:#0f172a}
        .restaurant-delivery-zone-dot{width:8px;height:8px;border-radius:999px;background:#0f172a;flex:0 0 auto}
        .restaurant-delivery-zone-dot.is-out{background:#94a3b8}
        .restaurant-delivery-zone-chevron{font-size:22px;color:#94a3b8;text-align:right}
        .restaurant-shipping-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55);backdrop-filter:blur(3px)}
        .restaurant-shipping-modal{position:relative;width:min(520px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);padding:24px;color:#0f172a}
        .restaurant-shipping-modal h2{margin:0 42px 18px 0}
        .restaurant-shipping-modal-close{position:absolute;right:14px;top:14px;width:38px;height:38px;border:0;border-radius:999px;background:#f1f5f9;font-size:22px;cursor:pointer}
        .restaurant-shipping-form{display:grid;gap:14px}
        .restaurant-shipping-form label{display:grid;gap:6px;font-weight:600;font-size:14px}
        .restaurant-shipping-form input[type=text],.restaurant-shipping-form input[type=number],.restaurant-shipping-form textarea{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:11px 12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-shipping-form input[type=number]{-moz-appearance:textfield}
        .restaurant-shipping-form input[type=number]::-webkit-inner-spin-button,.restaurant-shipping-form input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
        .restaurant-shipping-form input:focus,.restaurant-shipping-form textarea:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-shipping-form textarea{min-height:90px;resize:vertical}
        .restaurant-shipping-coverage{display:flex;align-items:center;gap:9px;font-weight:600}
        .restaurant-shipping-coverage input{width:18px;height:18px}
        .restaurant-shipping-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:6px}
        .restaurant-shipping-delete{margin-right:auto}
        @media(max-width:900px){.restaurant-delivery-radius-layout{grid-template-columns:1fr}} @media(max-width:700px){.restaurant-delivery-zone-row{grid-template-columns:1fr auto;gap:10px}.restaurant-delivery-zone-row .restaurant-delivery-zone-cell:nth-child(2),.restaurant-delivery-zone-row .restaurant-delivery-zone-cell:nth-child(3){grid-column:1}.restaurant-delivery-zone-chevron{grid-column:2;grid-row:1 / span 3;align-self:center}.restaurant-shipping-modal-backdrop{padding:10px;align-items:flex-end}.restaurant-shipping-modal{max-height:92vh;border-radius:18px 18px 12px 12px;padding:20px}.restaurant-shipping-modal-actions{flex-wrap:wrap}.restaurant-shipping-modal-actions .button{flex:1}.restaurant-shipping-delete{flex-basis:100%;margin-right:0}}
      `}</style>

      {error && <div className="restaurant-shipping-message is-error" role="alert">{error}</div>}
      {message && <div className="restaurant-shipping-message is-success" role="status">{message}</div>}

      <div className="restaurant-shipping-card restaurant-delivery-radius-card">
        <div className="restaurant-shipping-section-header">
          <div>
            <h2>Delivery Coverage</h2>
            <p className="restaurant-shipping-help">Set one delivery radius around your restaurant. Customers inside the radius receive normal restaurant delivery. Customers outside can use their own courier if you allow it.</p>
          </div>
        </div>
        {deliverySettingsLoading || !deliverySettings ? <p>Loading delivery coverage…</p> : (
          <>
            {deliverySettingsError && <div className="restaurant-shipping-message is-error" role="alert">{deliverySettingsError}</div>}
            {deliverySettingsMessage && <div className="restaurant-shipping-message is-success" role="status">{deliverySettingsMessage}</div>}
            <div className="restaurant-delivery-radius-layout">
              <div>
                <DeliveryCoverageMap
                  center={{
                    latitude: deliverySettings.deliveryLatitude ?? 14.5995,
                    longitude: deliverySettings.deliveryLongitude ?? 120.9842,
                  }}
                  marker={deliverySettings.deliveryLatitude == null || deliverySettings.deliveryLongitude == null ? null : {
                    latitude: deliverySettings.deliveryLatitude,
                    longitude: deliverySettings.deliveryLongitude,
                  }}
                  radiusKm={deliverySettings.deliveryRadiusKm}
                  interactive
                  onMarkerChange={(coordinate) => setDeliverySettings((current) => current ? { ...current, deliveryLatitude: coordinate.latitude, deliveryLongitude: coordinate.longitude } : current)}
                  height={360}
                />
                <p className="restaurant-delivery-map-help">Click the map or drag the marker to set the restaurant location.</p>
              </div>
              <div className="restaurant-delivery-radius-form">
                <label className="restaurant-shipping-coverage">
                  <input type="checkbox" checked={deliverySettings.deliveryEnabled} onChange={(event) => setDeliverySettings({ ...deliverySettings, deliveryEnabled: event.target.checked })} />
                  <span>Enable restaurant delivery</span>
                </label>
                <label>
                  Delivery radius (km)
                  <input type="number" min="0.1" max="100" step="0.1" value={deliverySettings.deliveryRadiusKm} onChange={(event) => setDeliverySettings({ ...deliverySettings, deliveryRadiusKm: Number(event.target.value) })} />
                </label>
                <label>
                  Delivery fee
                  <input type="number" min="0" step="0.01" value={deliverySettings.deliveryFee} onChange={(event) => setDeliverySettings({ ...deliverySettings, deliveryFee: Number(event.target.value) })} />
                </label>
                <label className="restaurant-shipping-coverage">
                  <input type="checkbox" checked={deliverySettings.allowThirdPartyCourier} onChange={(event) => setDeliverySettings({ ...deliverySettings, allowThirdPartyCourier: event.target.checked })} />
                  <span>Allow own courier outside delivery area</span>
                </label>
                <div className="restaurant-delivery-radius-coordinates">
                  <span>Restaurant pin</span>
                  <strong>{deliverySettings.deliveryLatitude == null ? 'Not set' : `${deliverySettings.deliveryLatitude.toFixed(6)}, ${deliverySettings.deliveryLongitude?.toFixed(6)}`}</strong>
                </div>
                <button type="button" className="button button-primary" onClick={() => void handleSaveDeliverySettings()} disabled={deliverySettingsSaving}>
                  {deliverySettingsSaving ? 'Saving…' : 'Save Delivery Coverage'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {(!deliverySettings?.deliveryLatitude || !deliverySettings?.deliveryLongitude) && (
              <div className="restaurant-shipping-card restaurant-delivery-zones-card">
                <div className="restaurant-shipping-section-header">
                  <div>
                    <h2>Delivery Zones</h2>
                    <p className="restaurant-shipping-help">Your restaurant's configured delivery areas are shown here. Click an area to edit its city, area, and shipping settings.</p>
                  </div>
                  <button type="button" className="button" onClick={addZone} disabled={loading || saving}>+ Add Delivery Zone</button>
                </div>
        
                <div className="restaurant-shipping-search">
                  <label className="restaurant-shipping-search-label" htmlFor="restaurant-barangay-search">Search delivery zones</label>
                  <div className="restaurant-shipping-search-input-wrap">
                    <input id="restaurant-delivery-zone-search" type="search" value={searchDeliveryZones} onChange={(event) => setSearchDeliveryZones(event.target.value)} placeholder="Search by city or delivery area" />
                    {searchDeliveryZones && <button type="button" className="restaurant-shipping-search-clear" onClick={() => setSearchDeliveryZones('')} aria-label="Clear delivery zone search">×</button>}
                  </div>
                </div>
        
                {loading ? <p>Loading delivery areas…</p> : filteredZones.length === 0 ? (
                  <div className="restaurant-shipping-empty restaurant-shipping-search-empty">
                    {zones.length === 0 ? 'No delivery zones configured yet. Add the areas where your restaurant delivers.' : `No delivery zone found for “${searchDeliveryZones}”.`}
                  </div>
                ) : (
                  <div className="restaurant-delivery-zone-list">
                    {filteredZones.map((zone) => {
                      const index = zones.findIndex((item) => item === zone);
                      return (
                        <button type="button" className="restaurant-delivery-zone-row" key={zone.id || `new-${index}`} onClick={() => openEditor(index)}>
                          <span className="restaurant-delivery-zone-cell">
                            <span className="restaurant-delivery-zone-cell-label">City / Delivery area</span>
                            <span className="restaurant-delivery-zone-cell-value">{zone.city ? `${zone.city} / ` : ''}{zone.barangay || 'New delivery zone'}</span>
                          </span>
                          <span className="restaurant-delivery-zone-cell">
                            <span className="restaurant-delivery-zone-cell-label">Shipping fee</span>
                            <span className="restaurant-delivery-zone-cell-value restaurant-delivery-zone-fee">₱ {Number(zone.shippingFee || 0).toFixed(2)}</span>
                          </span>
                          <span className="restaurant-delivery-zone-cell">
                            <span className="restaurant-delivery-zone-cell-label">Delivery coverage</span>
                            <span className="restaurant-delivery-zone-coverage"><span className={`restaurant-delivery-zone-dot ${zone.isSupported ? '' : 'is-out'}`} />{zone.isSupported ? 'Within our delivery' : 'Outside delivery area'}</span>
                          </span>
                          <span className="restaurant-delivery-zone-chevron" aria-hidden="true">›</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
        
        
      )}
      {editingZone && (editingIndex !== null || !editingZone.id) && (
        <div className="restaurant-shipping-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) closeEditor(); }}>
          <div className="restaurant-shipping-modal" role="dialog" aria-modal="true" aria-labelledby="shipping-zone-modal-title">
            <button className="restaurant-shipping-modal-close" type="button" disabled={saving} onClick={closeEditor}>×</button>
            <h2 id="shipping-zone-modal-title">{editingZone.id ? `Edit ${editingZone.barangay}` : 'Add Delivery Zone'}</h2>
            <form className="restaurant-shipping-form" onSubmit={(event) => { event.preventDefault(); void handleSaveZone(); }}>
              <label>
                City
                <input type="text" value={editingZone.city} onChange={(event) => updateZone({ city: event.target.value })} placeholder="Enter city" autoComplete="address-level2" />
              </label>
              <label>
                Delivery area
                <input type="text" value={editingZone.barangay} readOnly={Boolean(editingZone.id)} onChange={(event) => updateZone({ barangay: event.target.value })} placeholder="e.g. Malinta" autoFocus={!editingZone.id} />
              </label>
              <label>
                Shipping fee
                <input type="number" min="0" step="0.01" value={editingZone.shippingFee} onChange={(event) => updateZone({ shippingFee: event.target.value })} />
              </label>
              <label className="restaurant-shipping-coverage">
                <input type="checkbox" checked={editingZone.isSupported} onChange={(event) => updateZone({ isSupported: event.target.checked })} />
                <span>{editingZone.isSupported ? 'Within our delivery' : 'Outside our delivery area'}</span>
              </label>
              {!editingZone.isSupported && (
                <label>
                  Customer message
                  <textarea rows={3} value={editingZone.outOfScopeMessage} onChange={(event) => updateZone({ outOfScopeMessage: event.target.value })} />
                  <small>Suggested: This area is outside our delivery coverage. If you want to proceed, please book your own courier like Lalamove or Grab Express.</small>
                </label>
              )}
              <div className="restaurant-shipping-modal-actions">
                <button type="button" className="button restaurant-shipping-delete" onClick={() => void handleDeleteZone()} disabled={saving}>Delete</button>
                <button type="button" className="button" onClick={closeEditor} disabled={saving}>Cancel</button>
                <button type="submit" className="button button-primary" disabled={saving || !editingZone.barangay.trim()}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
