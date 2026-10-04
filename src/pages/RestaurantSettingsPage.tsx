import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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

function formatTimeLabel(value: string): string {
  const [rawHour, rawMinute] = value.split(':').map(Number);
  const period = rawHour >= 12 ? 'PM' : 'AM';
  const hour = rawHour % 12 || 12;
  return `${String(hour).padStart(2, '0')}:${String(rawMinute).padStart(2, '0')} ${period}`;
}

function to24Hour(hour: number, minute: number, period: 'AM' | 'PM'): string {
  let h = hour % 12;
  if (period === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

type TimePickerProps = {
  value: string;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
};

function TimePicker({ value, disabled, label, onChange }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const [draftHour, draftMinute] = draft.split(':').map(Number);
  const draftPeriod: 'AM' | 'PM' = draftHour >= 12 ? 'PM' : 'AM';
  const displayHour = draftHour % 12 || 12;

  function commit(nextHour = displayHour, nextMinute = draftMinute, nextPeriod = draftPeriod) {
    const next = to24Hour(nextHour, nextMinute, nextPeriod);
    setDraft(next);
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="restaurant-time-picker" ref={ref}>
      <button
        type="button"
        className="restaurant-time-picker-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{formatTimeLabel(value)}</span>
      </button>

      {open && (
        <div className="restaurant-time-picker-popover" role="dialog" aria-label={label}>
          <div className="restaurant-time-picker-heading">{label}</div>
          <div className="restaurant-time-picker-selects">
            <select
              aria-label="Hour"
              value={displayHour}
              onChange={(event) => commit(Number(event.target.value), draftMinute, draftPeriod)}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
                <option key={hour} value={hour}>{String(hour).padStart(2, '0')}</option>
              ))}
            </select>
            <span>:</span>
            <select
              aria-label="Minute"
              value={draftMinute}
              onChange={(event) => commit(displayHour, Number(event.target.value), draftPeriod)}
            >
              {Array.from({ length: 60 }, (_, minute) => minute).map((minute) => (
                <option key={minute} value={minute}>{String(minute).padStart(2, '0')}</option>
              ))}
            </select>
            <select
              aria-label="AM or PM"
              value={draftPeriod}
              onChange={(event) => commit(displayHour, draftMinute, event.target.value as 'AM' | 'PM')}
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <button
            type="button"
            className="restaurant-time-picker-done"
            onClick={() => setOpen(false)}
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

function normalizeTimeForStorage(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  const match24 = trimmed.match(/^(\\d{1,2}):(\\d{2})$/);
  if (match24) {
    const hour = Number(match24[1]);
    const minute = Number(match24[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  const match12 = trimmed.match(/^(\\d{1,2}):(\\d{2})\\s*(AM|PM)$/i);
  if (match12) {
    let hour = Number(match12[1]);
    const minute = Number(match12[2]);
    const meridiem = match12[3].toUpperCase();
    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      if (meridiem === 'AM') {
        if (hour === 12) hour = 0;
      } else if (hour !== 12) {
        hour += 12;
      }
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  return fallback;
}

function normalizeHours(value: unknown): OperatingHours {
  const source = value && typeof value === 'object' ? value as Record<string, Partial<DayHours>> : {};
  return DAYS.reduce((result, day) => {
    const current = source[day.key] ?? {};
    result[day.key] = {
      isOpen: current.isOpen !== false,
      open: normalizeTimeForStorage(current.open, DEFAULT_HOURS[day.key].open),
      close: normalizeTimeForStorage(current.close, DEFAULT_HOURS[day.key].close),
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
  const [automaticRiderAssignmentEnabled, setAutomaticRiderAssignmentEnabled] = useState(false);
  const [orderingEnabled, setOrderingEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);

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
        .select('store_address,location_text,ordering_enabled,operating_hours,tax_vat_registered,tax_prices_vat_inclusive,tax_vat_rate,cash_on_delivery_enabled,automatic_rider_assignment_enabled')
         .eq('id', restaurantId)
        .single();

      if (loadError) throw loadError;
      setAddress(data?.store_address ?? data?.location_text ?? '');
      setHours(normalizeHours(data?.operating_hours));
      setOrderingEnabled(data?.ordering_enabled !== false);
      setVatRegistered(Boolean(data?.tax_vat_registered));
      setPricesVatInclusive(Boolean(data?.tax_prices_vat_inclusive));
      setVatRate(String(data?.tax_vat_rate ?? 12));
      setCashOnDeliveryEnabled(data?.cash_on_delivery_enabled !== false);
      setAutomaticRiderAssignmentEnabled(data?.automatic_rider_assignment_enabled === true);

      });
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

  async function saveSettings() {
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
      const normalizedHours = DAYS.reduce((result, day) => {
        result[day.key] = {
          isOpen: Boolean(hours[day.key].isOpen),
          open: normalizeTimeForStorage(hours[day.key].open, DEFAULT_HOURS[day.key].open),
          close: normalizeTimeForStorage(hours[day.key].close, DEFAULT_HOURS[day.key].close),
        };
        return result;
      }, {} as OperatingHours);

      const { error: saveError } = await supabase
        .from('restaurants')
        .update({
          store_address: address.trim(),
          operating_hours: normalizedHours,
          ordering_enabled: orderingEnabled,
          tax_vat_registered: vatRegistered,
          tax_prices_vat_inclusive: vatRegistered ? pricesVatInclusive : false,
          tax_vat_rate: vatRegistered ? parsedVatRate : 0,
        })
        .eq('id', restaurantId);

      if (saveError) throw saveError;

      const { data: savedRow, error: verifyError } = await supabase
        .from('restaurants')
        .select('operating_hours')
        .eq('id', restaurantId)
        .single();

      if (verifyError) throw verifyError;

      const savedHours = normalizeHours(savedRow?.operating_hours);
      const mismatchedDay = DAYS.find((day) =>
        savedHours[day.key].open !== normalizedHours[day.key].open ||
        savedHours[day.key].close !== normalizedHours[day.key].close ||
        savedHours[day.key].isOpen !== normalizedHours[day.key].isOpen
      );

      if (mismatchedDay) {
        throw new Error(`The ${mismatchedDay.label} operating hours were not stored correctly. Please try again.`);
      }

      setHours(savedHours);
      setMessage('Store settings saved successfully.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save store settings.');
    } finally {
      setSaving(false);
    }
  }

  const openDays = useMemo(() => DAYS.filter((day) => hours[day.key].isOpen).length, [hours]);

  return (
    <section className="restaurant-page restaurant-shipping-page">
      <div className="restaurant-settings-card">
        <p className="eyebrow">Restaurant configuration</p>
        <h1 style={{ margin: 0 }}>Store Settings</h1>
        <p className="restaurant-settings-help" style={{ marginTop: 8 }}>Manage store operations, ordering status, tax configuration, and operating hours. Website branding and customer-facing content are managed separately.</p>
      </div>
      <style>{`
        .restaurant-settings-grid{display:grid;gap:20px}
        .restaurant-settings-theme-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:18px}
        .restaurant-settings-theme-field{display:grid;gap:7px;font-weight:600;font-size:14px}
        .restaurant-settings-theme-field input[type=color]{width:100%;height:44px;padding:4px;border:1px solid #dbe2ea;border-radius:10px;background:#fff;cursor:pointer}
        .restaurant-settings-theme-field select{width:100%;height:44px;padding:0 10px;border:1px solid #dbe2ea;border-radius:10px;background:#fff;color:#0f172a;font:inherit}
        .restaurant-settings-theme-preview{margin-top:20px;padding:20px;border:1px solid #e1e5eb;border-radius:14px;background:var(--color-background);color:var(--color-text)}
        .restaurant-settings-theme-preview-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:1px solid var(--color-border)}
        .restaurant-settings-theme-brand{display:flex;align-items:center;gap:10px;font-weight:800}
        .restaurant-settings-theme-dot{width:30px;height:30px;border-radius:var(--radius-sm);background:var(--color-primary)}
        .restaurant-settings-theme-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
        .restaurant-settings-theme-swatch{height:46px;border-radius:var(--radius-md);border:1px solid var(--color-border)}
        @media(max-width:700px){.restaurant-settings-theme-grid{grid-template-columns:1fr}}
        .restaurant-settings-switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:14px;font-weight:700;color:#0f172a}
        .restaurant-settings-switch{position:relative;display:inline-flex;flex:0 0 auto}
        .restaurant-settings-switch input{position:absolute;opacity:0;pointer-events:none}
        .restaurant-settings-switch-track{position:relative;width:48px;height:28px;border-radius:999px;background:#cbd5e1;transition:background .2s ease;display:block}
        .restaurant-settings-switch-thumb{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.25);transition:transform .2s ease}
        .restaurant-settings-switch input:checked + .restaurant-settings-switch-track{background:#101b2f}
        .restaurant-settings-switch input:checked + .restaurant-settings-switch-track .restaurant-settings-switch-thumb{transform:translateX(20px)}
        .restaurant-settings-switch input:focus-visible + .restaurant-settings-switch-track{outline:2px solid #101b2f;outline-offset:2px}
        .restaurant-settings-switch input:disabled + .restaurant-settings-switch-track{opacity:.55}
        .restaurant-settings-logo-row{display:flex;align-items:center;gap:16px;margin-top:16px;flex-wrap:wrap}
        .restaurant-settings-logo-preview{width:96px;height:96px;border:1px solid #dbe2ea;border-radius:12px;background:#f8fafc;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#94a3b8;font-size:12px}
        .restaurant-settings-logo-preview img{width:100%;height:100%;object-fit:contain}
        .restaurant-settings-logo-button{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center}
        .restaurant-settings-logo-button input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
        .restaurant-settings-logo-button input:disabled{cursor:not-allowed}
        .restaurant-settings-card{padding:24px;border:1px solid #e1e5eb;border-radius:14px;background:#fff}
        .restaurant-settings-card h2{margin:0 0 8px}
        .restaurant-settings-help{margin:0;color:#64748b;line-height:1.6}
        .restaurant-settings-form{display:grid;gap:22px}
        .restaurant-settings-field{display:grid;gap:7px;font-weight:600;font-size:14px}
        .restaurant-settings-field input[type=text]{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:12px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-settings-field input[type=number]{width:64px;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:12px;font:inherit;color:#0f172a;background:#fff;-moz-appearance:textfield}
        .restaurant-settings-field input[type=number]::-webkit-inner-spin-button,.restaurant-settings-field input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
        .restaurant-settings-field input:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-settings-days{display:grid;border:1px solid #e5e7eb;border-radius:10px;overflow:visible}
        .restaurant-settings-hours-head,.restaurant-settings-day{display:grid;grid-template-columns:140px minmax(120px,1fr) minmax(120px,1fr) 72px;align-items:center;gap:12px;padding:10px 14px}
        .restaurant-settings-hours-head{background:#f8fafc;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
        .restaurant-settings-day{border-top:1px solid #e5e7eb}
        .restaurant-settings-day-name{font-weight:600}
        .restaurant-settings-day input[type=time]{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:8px;padding:8px 9px;font:inherit;background:#fff}
        .restaurant-time-picker{position:relative;width:100%}
        .restaurant-time-picker-trigger{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #dbe2ea;border-radius:8px;padding:8px 10px;font:inherit;background:#fff;color:#0f172a;text-align:left;cursor:pointer}
        .restaurant-time-picker-trigger:disabled{background:#f8fafc;color:#94a3b8;cursor:not-allowed}
        .restaurant-time-picker-popover{position:absolute;z-index:30;top:calc(100% + 6px);left:0;width:260px;box-sizing:border-box;padding:12px;border:1px solid #dbe2ea;border-radius:10px;background:#fff;box-shadow:0 12px 30px rgba(15,23,42,.16)}
        .restaurant-time-picker-heading{font-size:12px;font-weight:700;color:#64748b;margin-bottom:10px}
        .restaurant-time-picker-selects{display:grid;grid-template-columns:1fr auto 1fr 1.1fr;align-items:center;gap:5px}
        .restaurant-time-picker-selects select{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:7px;padding:8px 6px;font:inherit;background:#fff;color:#0f172a}
        .restaurant-time-picker-done{border:1px solid #dbe2ea;border-radius:7px;background:#f8fafc;color:#0f172a;padding:7px 5px;font:inherit;cursor:pointer}
        .restaurant-time-picker-done:hover{background:#eef2f7}
        .restaurant-time-picker-done{width:100%;margin-top:9px;font-weight:700}
        .restaurant-settings-day input[type=time]:disabled{background:#f8fafc;color:#94a3b8}
        .restaurant-settings-toggle{display:flex;align-items:center;justify-content:center;gap:6px;font-size:14px;font-weight:600;white-space:nowrap}
        .restaurant-settings-day .restaurant-settings-switch{justify-content:center}
        .restaurant-settings-toggle input{margin:0}
        .restaurant-settings-tax-grid{display:grid;grid-template-columns:1fr;gap:16px}
        .restaurant-settings-tax-grid .restaurant-settings-switch-row{width:100%}
        .restaurant-settings-tax-grid .restaurant-settings-field{width:100%}
        .restaurant-settings-tax-grid .restaurant-settings-toggle{min-height:44px;justify-content:flex-start}
        @media(max-width:700px){.restaurant-settings-tax-grid{grid-template-columns:1fr}}
        .restaurant-settings-confirm-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.45)}
        .restaurant-settings-confirm-modal{width:min(420px,100%);box-sizing:border-box;padding:24px;border:1px solid #dbe2ea;border-radius:14px;background:#fff;box-shadow:0 20px 60px rgba(15,23,42,.2)}
        .restaurant-settings-confirm-modal h2{margin:0 0 8px;color:#0f172a;font-size:20px}
        .restaurant-settings-confirm-modal p{margin:0;color:#64748b;line-height:1.5}
        .restaurant-settings-confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
        @media(max-width:480px){.restaurant-settings-confirm-actions{flex-direction:column-reverse}.restaurant-settings-confirm-actions .button{width:100%}}
        .restaurant-settings-actions{display:flex;justify-content:flex-end}
        @media(max-width:700px){.restaurant-settings-hours-head{display:none}.restaurant-settings-day{grid-template-columns:1fr 1fr;padding:12px}.restaurant-settings-day-name{grid-column:1/-1}.restaurant-settings-toggle{justify-content:flex-start}.restaurant-settings-actions .button{width:100%}}
      `}</style>

      {error && <div className="restaurant-shipping-message is-error" role="alert">{error}</div>}
      {message && <div className="restaurant-shipping-message is-success" role="status">{message}</div>}

      <form className="restaurant-settings-form" onSubmit={(event) => { event.preventDefault(); setShowSaveConfirmation(true); }}>
        <div className="restaurant-settings-card">
          <h2>Store address</h2>
          <p className="restaurant-settings-help">This address is shown to customers for pickup orders. It is stored per restaurant, so the platform can be reused by different restaurant owners.</p>
          <label className="restaurant-settings-field">
            <span>Full store address</span>
            <input
              type="text"
              value={address}
              onChange={(event) => { setAddress(event.target.value); setMessage(''); setError(''); }}
              disabled={loading || saving}
              required
            />
          </label>
        </div>

        <div className="restaurant-settings-card">
          <h2>Store status</h2>
          <p className="restaurant-settings-help">Operating hours automatically control the normal opening and closing schedule. Use this switch when you need to manually close the store outside that schedule.</p>
          <label className="restaurant-settings-switch-row">
            <span>{orderingEnabled ? 'Store is open' : 'Store is manually closed'}</span>
            <span className="restaurant-settings-switch">
              <input
                type="checkbox"
                checked={orderingEnabled}
                disabled={loading || saving}
                onChange={(event) => { setOrderingEnabled(event.target.checked); setMessage(''); setError(''); }}
                aria-label="Manual store closure"
              />
              <span className="restaurant-settings-switch-track" aria-hidden="true">
                <span className="restaurant-settings-switch-thumb" />
              </span>
            </span>
          </label>
          <p className="restaurant-settings-help" style={{ marginTop: 10 }}>Turn it off to close ordering immediately. Turn it back on to return control to the automatic operating hours.</p>
        </div>

        <div className="restaurant-settings-card">
          <h2>Tax &amp; receipt settings</h2>
          <p className="restaurant-settings-help">These settings control POS tax calculations. The selected settings are copied into each finalized POS order so historical receipts remain unchanged if you update the store later.</p>
          <div className="restaurant-settings-tax-grid">
            <label className="restaurant-settings-switch-row">
              <span>VAT registered</span>
              <span className="restaurant-settings-switch">
                <input
                  type="checkbox"
                  checked={vatRegistered}
                  disabled
                  onChange={() => undefined}
                />
                <span className="restaurant-settings-switch-track" aria-hidden="true">
                  <span className="restaurant-settings-switch-thumb" />
                </span>
              </span>
            </label>
            {vatRegistered && (
              <>
                <label className="restaurant-settings-field">
                  <span>VAT rate (%)</span>
                  <input type="number" min="0" max="100" step="0.01" value={vatRate} disabled onChange={() => undefined} />
                </label>
                <label className="restaurant-settings-toggle">
                  <input type="checkbox" checked={pricesVatInclusive} disabled onChange={() => undefined} />
                  Menu prices are VAT-inclusive
                </label>
              </>
            )}
          </div>
          <p className="restaurant-settings-help" style={{ marginTop: 12 }}>Controlled by the System Administrator. Contact the System Administrator to request a tax configuration change.</p>
          <p className="restaurant-settings-help" style={{ marginTop: 12 }}>For Senior Citizen/PWD transactions, the POS applies the 20% discount to the eligible VAT-exclusive share and removes the corresponding VAT when the restaurant is VAT-registered. Verify the restaurant’s actual BIR registration and pricing treatment before enabling VAT settings.</p>
        </div>

        <div className="restaurant-settings-card">
          <h2>Cash on Delivery</h2>
          <p className="restaurant-settings-help">Allow customers to place delivery orders and pay in cash when the order is received. Turning this off requires delivery customers to use Online Payment.</p>
          <label className="restaurant-settings-switch-row">
            <span>Accept Cash on Delivery</span>
            <span className="restaurant-settings-switch">
              <input
                type="checkbox"
                checked={cashOnDeliveryEnabled}
                disabled
                aria-label="Cash on Delivery status"
              />
              <span className="restaurant-settings-switch-track" aria-hidden="true">
                <span className="restaurant-settings-switch-thumb" />
              </span>
            </span>
          </label>
          <p className="restaurant-settings-help" style={{ marginTop: 10 }}>Controlled by the System Administrator. Contact the System Administrator to request a workflow change.</p>
        </div>

        <div className="restaurant-settings-card">
          <h2>Automatic Rider Assignment</h2>
          <p className="restaurant-settings-help">Automatically assign a ready delivery order to an available rider. The system chooses an eligible rider according to the restaurant's configured delivery-zone workflow.</p>
          <label className="restaurant-settings-switch-row">
            <span>Auto-assign delivery orders</span>
            <span className="restaurant-settings-switch">
              <input
                type="checkbox"
                checked={automaticRiderAssignmentEnabled}
                disabled
                aria-label="Automatic Rider Assignment status"
              />
              <span className="restaurant-settings-switch-track" aria-hidden="true">
                <span className="restaurant-settings-switch-thumb" />
              </span>
            </span>
          </label>
          <p className="restaurant-settings-help" style={{ marginTop: 10 }}>Controlled by the System Administrator. Contact the System Administrator to request a workflow change.</p>
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
                  <TimePicker
                    label={day.label + ' opening time'}
                    value={value.open}
                    disabled={!value.isOpen || loading || saving}
                    onChange={(next) => updateDay(day.key, { open: next })}
                  />
                  <TimePicker
                    label={day.label + ' closing time'}
                    value={value.close}
                    disabled={!value.isOpen || loading || saving}
                    onChange={(next) => updateDay(day.key, { close: next })}
                  />
                  <label className="restaurant-settings-switch" aria-label={day.label + ' open'}>
                    <input
                      type="checkbox"
                      checked={value.isOpen}
                      disabled={loading || saving}
                      onChange={(event) => updateDay(day.key, { isOpen: event.target.checked })}
                    />
                    <span className="restaurant-settings-switch-track" aria-hidden="true">
                      <span className="restaurant-settings-switch-thumb" />
                    </span>
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

      {showSaveConfirmation && (
        <div
          className="restaurant-settings-confirm-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restaurant-settings-confirm-title"
        >
          <div className="restaurant-settings-confirm-modal">
            <h2 id="restaurant-settings-confirm-title">Save Store Settings?</h2>
            <p>Are you sure you want to save these store settings?</p>
            <div className="restaurant-settings-confirm-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={saving}
                onClick={() => setShowSaveConfirmation(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={saving}
                onClick={() => {
                  setShowSaveConfirmation(false);
                  void saveSettings();
                }}
              >
                {saving ? 'Saving…' : 'Confirm Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
