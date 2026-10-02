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
        .select('store_address,location_text,operating_hours')
        .eq('id', restaurantId)
        .single();

      if (loadError) throw loadError;
      setAddress(data?.store_address ?? data?.location_text ?? '');
      setHours(normalizeHours(data?.operating_hours));
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

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const { error: saveError } = await supabase
        .from('restaurants')
        .update({
          store_address: address.trim(),
          operating_hours: hours,
        })
        .eq('id', restaurantId);

      if (saveError) throw saveError;
      setMessage('Store address and operating hours saved.');
      await loadSettings();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save store settings.');
    } finally {
      setSaving(false);
    }
  }

  const openDays = useMemo(() => DAYS.filter((day) => hours[day.key].isOpen).length, [hours]);

  return (
    <section className="restaurant-shipping-page">
      <style>{`
        .restaurant-settings-grid{display:grid;gap:20px}
        .restaurant-settings-card{padding:24px;border:1px solid #e1e5eb;border-radius:14px;background:#fff}
        .restaurant-settings-card h2{margin:0 0 8px}
        .restaurant-settings-help{margin:0;color:#64748b;line-height:1.6}
        .restaurant-settings-form{display:grid;gap:22px}
        .restaurant-settings-field{display:grid;gap:7px;font-weight:600;font-size:14px}
        .restaurant-settings-field input[type=text]{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-settings-field input:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-settings-days{display:grid;gap:10px}
        .restaurant-settings-day{display:grid;grid-template-columns:150px minmax(90px,1fr) minmax(90px,1fr) auto;align-items:center;gap:12px;padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px}
        .restaurant-settings-day-name{font-weight:600}
        .restaurant-settings-day input[type=time]{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:8px;padding:9px;font:inherit}
        .restaurant-settings-day input[type=time]:disabled{background:#f8fafc;color:#94a3b8}
        .restaurant-settings-toggle{display:flex;align-items:center;gap:7px;font-size:14px;font-weight:600;white-space:nowrap}
        .restaurant-settings-summary{font-size:14px;color:#64748b}
        .restaurant-settings-actions{display:flex;justify-content:flex-end}
        @media(max-width:700px){.restaurant-settings-day{grid-template-columns:1fr 1fr}.restaurant-settings-day-name{grid-column:1/-1}.restaurant-settings-toggle{grid-column:1/-1}.restaurant-settings-actions .button{width:100%}}
      `}</style>

      <div className="restaurant-shipping-header">
        <div>
          <p className="eyebrow">Restaurant settings</p>
          <h1>Store Settings</h1>
          <p>Set the store address and operating hours customers should use for pickup.</p>
        </div>
      </div>

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
          <h2>Operating hours</h2>
          <p className="restaurant-settings-help">Set the hours customers can visit the store. {openDays} of 7 days are currently open.</p>
          <div className="restaurant-settings-days">
            {DAYS.map((day) => {
              const value = hours[day.key];
              return (
                <div className="restaurant-settings-day" key={day.key}>
                  <span className="restaurant-settings-day-name">{day.label}</span>
                  <label>
                    <span className="sr-only">Opening time for {day.label}</span>
                    <input type="time" value={value.open} disabled={!value.isOpen || loading || saving} onChange={(event) => updateDay(day.key, { open: event.target.value })} />
                  </label>
                  <label>
                    <span className="sr-only">Closing time for {day.label}</span>
                    <input type="time" value={value.close} disabled={!value.isOpen || loading || saving} onChange={(event) => updateDay(day.key, { close: event.target.value })} />
                  </label>
                  <label className="restaurant-settings-toggle">
                    <input type="checkbox" checked={value.isOpen} disabled={loading || saving} onChange={(event) => updateDay(day.key, { isOpen: event.target.checked })} />
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
