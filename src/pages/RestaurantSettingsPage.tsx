import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../services/supabaseClient';

type Props = {
  restaurantId: string;
};

type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

type DayHours = {
  isOpen: boolean;
  open: string;
  close: string;
};

type OperatingHours = Record<DayKey, DayHours>;

const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
];

const DEFAULT_HOURS: OperatingHours = {
  monday: { isOpen: true, open: '09:00', close: '21:00' },
  tuesday: { isOpen: true, open: '09:00', close: '21:00' },
  wednesday: { isOpen: true, open: '09:00', close: '21:00' },
  thursday: { isOpen: true, open: '09:00', close: '21:00' },
  friday: { isOpen: true, open: '09:00', close: '21:00' },
  saturday: { isOpen: true, open: '09:00', close: '21:00' },
  sunday: { isOpen: true, open: '09:00', close: '21:00' },
};

function normalizeHours(value: unknown): OperatingHours {
  const source = value && typeof value === 'object' ? value as Record<string, Partial<DayHours>> : {};
  return DAYS.reduce((result, day) => {
    const current = source[day.key] ?? {};
    result[day.key] = {
      isOpen: current.isOpen !== false,
      open: typeof current.open === 'string' && current.open ? current.open : DEFAULT_HOURS[day.key].open,
      close: typeof current.close === 'string' && current.close ? current.close : DEFAULT_HOURS[day.key].close,
    };
    return result;
  }, {} as OperatingHours);
}

export function RestaurantSettingsPage({ restaurantId }: Props) {
  const [address, setAddress] = useState('');
  const [hours, setHours] = useState<OperatingHours>(DEFAULT_HOURS);
  const [vatRegistered, setVatRegistered] = useState(false);
  const [pricesVatInclusive, setPricesVatInclusive] = useState(false);
  const [vatRate, setVatRate] = useState('12');
  const [cashOnDeliveryEnabled, setCashOnDeliveryEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadSettings() {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { data, error: loadError } = await supabase
        .from('restaurants')
        .select('store_address,location_text,operating_hours,tax_vat_registered,tax_prices_vat_inclusive,tax_vat_rate,cash_on_delivery_enabled')
        .eq('id', restaurantId)
        .single();

      if (loadError) throw loadError;
      setAddress(data?.store_address ?? data?.location_text ?? '');
      setHours(normalizeHours(data?.operating_hours));
      setVatRegistered(Boolean(data?.tax_vat_registered));
      setPricesVatInclusive(Boolean(data?.tax_prices_vat_inclusive));
      setVatRate(String(data?.tax_vat_rate ?? 12));
      setCashOnDeliveryEnabled(data?.cash_on_delivery_enabled !== false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load store settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, [restaurantId]);

  function updateDay(day: DayKey, patch: Partial<DayHours>) {
    setHours((current) => ({
      ...current,
      [day]: { ...current[day], ...patch },
    }));
    setMessage('');
    setError('');
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    if (!address.trim()) {
      setError('Enter the restaurant store address.');
      return;
    }

    const parsedVatRate = Number(vatRate);
    if (vatRegistered && (!Number.isFinite(parsedVatRate) || parsedVatRate < 0 || parsedVatRate > 100)) {
      setError('Enter a valid VAT rate between 0 and 100.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const { error: saveError } = await supabase
        .from('restaurants')
        .update({
          store_address: address.trim(),
          operating_hours: hours,
          tax_vat_registered: vatRegistered,
          tax_prices_vat_inclusive: vatRegistered ? pricesVatInclusive : false,
          tax_vat_rate: vatRegistered ? parsedVatRate : 0,
          cash_on_delivery_enabled: cashOnDeliveryEnabled,
        })
        .eq('id', restaurantId);

      if (saveError) throw saveError;
      setMessage('Store and tax settings saved successfully.');
      await loadSettings();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save store settings.');
    } finally {
      setSaving(false);
    }
  }

  const openDays = useMemo(() => DAYS.filter((day) => hours[day.key].isOpen).length, [hours]);

  return (
    <section className="restaurant-page restaurant-shipping-page">
      <style>{`
        .restaurant-settings-grid{display:grid;gap:20px}
        .restaurant-settings-card{padding:24px;border:1px solid #e1e5eb;border-radius:14px;background:#fff}
        .restaurant-settings-card h2{margin:0 0 8px}
        .restaurant-settings-help{margin:0;color:#64748b;line-height:1.6}
        .restaurant-settings-form{display:grid;gap:22px}
        .restaurant-settings-field{display:grid;gap:7px;font-weight:600;font-size:14px}
        .restaurant-settings-field input[type=text]{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-settings-field input[type=number]{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:12px;font:inherit;color:#0f172a;background:#fff;-moz-appearance:textfield}
        .restaurant-settings-field input[type=number]::-webkit-inner-spin-button,.restaurant-settings-field input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
        .restaurant-settings-field input:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-settings-days{display:grid;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}
        .restaurant-settings-hours-head,.restaurant-settings-day{display:grid;grid-template-columns:140px minmax(120px,1fr) minmax(120px,1fr) 72px;align-items:center;gap:12px;padding:10px 14px}
        .restaurant-settings-hours-head{background:#f8fafc;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
        .restaurant-settings-day{border-top:1px solid #e5e7eb}
        .restaurant-settings-day-name{font-weight:600}
        .restaurant-settings-day input[type=time]{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:8px;padding:8px 9px;font:inherit;background:#fff}
        .restaurant-settings-day input[type=time]:disabled{background:#f8fafc;color:#94a3b8}
        .restaurant-settings-toggle{display:flex;align-items:center;justify-content:center;gap:6px;font-size:14px;font-weight:600;white-space:nowrap}
        .restaurant-settings-toggle input{margin:0}
        .restaurant-settings-tax-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:end}
        .restaurant-settings-tax-grid .restaurant-settings-toggle{min-height:44px;justify-content:flex-start}
        @media(max-width:700px){.restaurant-settings-tax-grid{grid-template-columns:1fr}}
        .restaurant-settings-actions{display:flex;justify-content:flex-end}
        @media(max-width:700px){.restaurant-settings-hours-head{display:none}.restaurant-settings-day{grid-template-columns:1fr 1fr;padding:12px}.restaurant-settings-day-name{grid-column:1/-1}.restaurant-settings-toggle{justify-content:flex-start}.restaurant-settings-actions .button{width:100%}}
      `}</style>

      {error && <div className="restaurant-shipping-message is-error" role="alert">{error}</div>}
      {message && <div className="restaurant-shipping-message is-success" role="status">{message}</div>}

      <form className="restaurant-settings-form" onSubmit={handleSave}>
        <div className="restaurant-settings-card">
          <h2>Store address</h2>
          <p className="restaurant-settings-help">This address is shown to customers for pickup orders. It is stored per restaurant, so the platform can be reused by different restaurant owners.</p>
          <label className="restaurant-settings-field">
            <span>Full store address</span>
            <input
              type="text"
              value={address}
              onChange={(event) => { setAddress(event.target.value); setMessage(''); setError(''); }}
              placeholder="e.g. 123 Main Street, Barangay Example, City"
              disabled={loading || saving}
              required
            />
          </label>
        </div>

        <div className="restaurant-settings-card">
          <h2>Tax &amp; receipt settings</h2>
          <p className="restaurant-settings-help">These settings control POS tax calculations. The selected settings are copied into each finalized POS order so historical receipts remain unchanged if you update the store later.</p>
          <div className="restaurant-settings-tax-grid">
            <label className="restaurant-settings-toggle">
              <input type="checkbox" checked={vatRegistered} disabled={loading || saving} onChange={(event) => { setVatRegistered(event.target.checked); setMessage(''); setError(''); }} />
              VAT registered
            </label>
            {vatRegistered && (
              <>
                <label className="restaurant-settings-field">
                  <span>VAT rate (%)</span>
                  <input type="number" min="0" max="100" step="0.01" value={vatRate} onChange={(event) => { setVatRate(event.target.value); setMessage(''); setError(''); }} disabled={loading || saving} />
                </label>
                <label className="restaurant-settings-toggle">
                  <input type="checkbox" checked={pricesVatInclusive} disabled={loading || saving} onChange={(event) => { setPricesVatInclusive(event.target.checked); setMessage(''); setError(''); }} />
                  Menu prices are VAT-inclusive
                </label>
              </>
            )}
          </div>
          <p className="restaurant-settings-help" style={{ marginTop: 12 }}>For Senior Citizen/PWD transactions, the POS applies the 20% discount to the eligible VAT-exclusive share and removes the corresponding VAT when the restaurant is VAT-registered. Verify the restaurant’s actual BIR registration and pricing treatment before enabling VAT settings.</p>
        </div>

        <div className="restaurant-settings-card">
          <h2>Cash on Delivery</h2>
          <p className="restaurant-settings-help">Allow customers to place delivery orders and pay in cash when the order is received. Turning this off requires delivery customers to use Online Payment.</p>
          <label className="restaurant-settings-toggle" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
            <input
              type="checkbox"
              checked={cashOnDeliveryEnabled}
              disabled={loading || saving}
              onChange={(event) => { setCashOnDeliveryEnabled(event.target.checked); setMessage(''); setError(''); }}
            />
            Accept Cash on Delivery
          </label>
        </div>

        <div className="restaurant-settings-card">
          <h2>Operating hours</h2>
          <p className="restaurant-settings-help">Set the hours customers can visit the store. {openDays} of 7 days are currently open.</p>
          <div className="restaurant-settings-days">
            <div className="restaurant-settings-hours-head" aria-hidden="true">
              <span>Day</span>
              <span>Opens</span>
              <span>Closes</span>
              <span>Status</span>
            </div>
            {DAYS.map((day) => {
              const value = hours[day.key];
              return (
                <div className="restaurant-settings-day" key={day.key}>
                  <span className="restaurant-settings-day-name">{day.label}</span>
                  <input
                    aria-label={day.label + ' opening time'}
                    type="time"
                    value={value.open}
                    disabled={!value.isOpen || loading || saving}
                    onChange={(event) => updateDay(day.key, { open: event.target.value })}
                  />
                  <input
                    aria-label={day.label + ' closing time'}
                    type="time"
                    value={value.close}
                    disabled={!value.isOpen || loading || saving}
                    onChange={(event) => updateDay(day.key, { close: event.target.value })}
                  />
                  <label className="restaurant-settings-toggle">
                    <input
                      aria-label={day.label + ' open'}
                      type="checkbox"
                      checked={value.isOpen}
                      disabled={loading || saving}
                      onChange={(event) => updateDay(day.key, { isOpen: event.target.checked })}
                    />
                    Open
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        <div className="restaurant-settings-actions">
          <button className="button button-primary" type="submit" disabled={loading || saving}>
            {saving ? 'Saving…' : 'Save Store Settings'}
          </button>
        </div>
      </form>
    </section>
  );
}
