import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../services/supabaseClient';
import { MapboxDeliveryLocationPicker, type MapboxDeliveryAddress } from '../components/MapboxDeliveryLocationPicker';
import { PayMongoLiveOnboardingCard } from '../components/PayMongoLiveOnboardingCard';
import { useOwnerUnsavedChanges } from '../contexts/OwnerUnsavedChangesContext';
import { useOwnerUnsavedChangesTracking } from '../hooks/useOwnerUnsavedChangesTracking';

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

  // Keep the picker open while interacting with native select menus.
  // On some browsers, option selection can dispatch pointer events outside
  // the wrapper and prematurely dismiss the popover. Close only via Done or
  // by toggling the trigger, so hour/minute/AM-PM can all be selected first.

  const [draftHour, draftMinute] = draft.split(':').map(Number);
  const draftPeriod: 'AM' | 'PM' = draftHour >= 12 ? 'PM' : 'AM';
  const displayHour = draftHour % 12 || 12;

  function updateDraft(nextHour = displayHour, nextMinute = draftMinute, nextPeriod = draftPeriod) {
    setDraft(to24Hour(nextHour, nextMinute, nextPeriod));
  }

  function commitDraft() {
    onChange(draft);
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
              onChange={(event) => updateDraft(Number(event.target.value), draftMinute, draftPeriod)}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => (
                <option key={hour} value={hour}>{String(hour).padStart(2, '0')}</option>
              ))}
            </select>
            <span>:</span>
            <select
              aria-label="Minute"
              value={draftMinute}
              onChange={(event) => updateDraft(displayHour, Number(event.target.value), draftPeriod)}
            >
              {Array.from({ length: 60 }, (_, minute) => minute).map((minute) => (
                <option key={minute} value={minute}>{String(minute).padStart(2, '0')}</option>
              ))}
            </select>
            <select
              aria-label="AM or PM"
              value={draftPeriod}
              onChange={(event) => updateDraft(displayHour, draftMinute, event.target.value as 'AM' | 'PM')}
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
          <button
            type="button"
            className="restaurant-time-picker-done"
            onClick={commitDraft}
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
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour = Number(match24[1]);
    const minute = Number(match24[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  const match12 = trimmed.match(/^(\d{1,2}):(\d{2})\\s*(AM|PM)$/i);
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
  const { setUnsavedChanges } = useOwnerUnsavedChanges();
  const [address, setAddress] = useState('');
  const [restaurantAddress, setRestaurantAddress] = useState('');
  const [restaurantTagline, setRestaurantTagline] = useState('');
  const [hours, setHours] = useState<OperatingHours>(DEFAULT_HOURS);
  const [vatRegistered, setVatRegistered] = useState(false);
  const [pricesVatInclusive, setPricesVatInclusive] = useState(false);
  const [vatRate, setVatRate] = useState('12');
  const [cashOnDeliveryEnabled, setCashOnDeliveryEnabled] = useState(true);
  const [cashOnPickupEnabled, setCashOnPickupEnabled] = useState(true);
  const [cashOnTakeOutEnabled, setCashOnTakeOutEnabled] = useState(true);
  const [automaticRiderAssignmentEnabled, setAutomaticRiderAssignmentEnabled] = useState(false);
  const [deliveryBaseFee, setDeliveryBaseFee] = useState('0');
  const [deliveryDistanceIncrementMeters, setDeliveryDistanceIncrementMeters] = useState('500');
  const [deliveryFeePerIncrement, setDeliveryFeePerIncrement] = useState('10');
  const [deliveryMaxDistanceMeters, setDeliveryMaxDistanceMeters] = useState('10000');
  const [deliveryLocationLatitude, setDeliveryLocationLatitude] = useState<number | null>(null);
  const [deliveryLocationLongitude, setDeliveryLocationLongitude] = useState<number | null>(null);
  const [orderingEnabled, setOrderingEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showSaveConfirmation, setShowSaveConfirmation] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState('profile');
  const [hasDispatchDelivery, setHasDispatchDelivery] = useState(false);
  const [hasSelfOrdering, setHasSelfOrdering] = useState(true);
  const [hasOnlinePayments, setHasOnlinePayments] = useState(true);
  const [paymongoTestStatus, setPaymongoTestStatus] = useState("not_connected");
  const [paymongoLiveStatus, setPaymongoLiveStatus] = useState("not_connected");
  const [paymongoLiveAccountId, setPaymongoLiveAccountId] = useState("");
  const [paymongoLiveVerificationUrl, setPaymongoLiveVerificationUrl] = useState("");
  const [paymongoLiveStep, setPaymongoLiveStep] = useState("");
  const [paymongoLiveIdentityStatus, setPaymongoLiveIdentityStatus] = useState("");
  const [paymongoTestAccountId, setPaymongoTestAccountId] = useState("");
  const [paymongoTestInvitationId, setPaymongoTestInvitationId] = useState("");
  const [paymongoTestSignupUrl, setPaymongoTestSignupUrl] = useState("");
  const paymongoTestStorageKey = `web2table.paymongo.test.${restaurantId}`;
  const [paymongoBusy, setPaymongoBusy] = useState(false);
  const [paymongoError, setPaymongoError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadPackageModules() {
      if (!supabase) {
        setHasDispatchDelivery(false);
        setHasSelfOrdering(false);
        setHasOnlinePayments(false);
        return;
      }
      const [{ data: deliveryData, error: deliveryError }, { data: orderingData, error: orderingError }, { data: paymentsData, error: paymentsError }] = await Promise.all([
        supabase.rpc('restaurant_has_module', { p_restaurant_id: restaurantId, p_module_key: 'dispatch_delivery' }),
        supabase.rpc('restaurant_has_module', { p_restaurant_id: restaurantId, p_module_key: 'self_ordering' }),
        supabase.rpc('restaurant_has_module', { p_restaurant_id: restaurantId, p_module_key: 'online_payments' }),
      ]);
      if (cancelled) return;
      setHasDispatchDelivery(!deliveryError && deliveryData === true);
      setHasSelfOrdering(!orderingError && orderingData === true);
      setHasOnlinePayments(!paymentsError && paymentsData === true);
    }
    void loadPackageModules();
    return () => { cancelled = true; };
  }, [restaurantId]);

  useEffect(() => {
    if ((!hasDispatchDelivery && ["delivery", "cod", "rider"].includes(activeSettingsTab)) || (!hasSelfOrdering && ["status", "hours"].includes(activeSettingsTab)) || (!hasOnlinePayments && activeSettingsTab === "payments")) {
      setActiveSettingsTab('profile');
    }
  }, [hasDispatchDelivery, hasSelfOrdering, hasOnlinePayments, activeSettingsTab]);

  useEffect(() => {
    if (!message) return;
    const timeoutId = window.setTimeout(() => setMessage(''), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  async function loadSettings() {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setSettingsLoaded(false);
    setError('');
    try {
      const { data, error: loadError } = await supabase
        .from('restaurants')
        .select('tagline,restaurant_address,store_address,ordering_enabled,operating_hours,tax_vat_registered,tax_prices_vat_inclusive,tax_vat_rate,cash_on_delivery_enabled,cash_on_pickup_enabled,cash_on_take_out_enabled,automatic_rider_assignment_enabled,delivery_base_fee,delivery_distance_increment_meters,delivery_fee_per_increment,delivery_max_distance_meters,delivery_location_latitude,delivery_location_longitude')
         .eq('id', restaurantId)
        .single();

      if (loadError) throw loadError;
      if (!data) throw new Error('Restaurant settings were not returned. Saving is disabled until settings can be loaded.');
      setRestaurantTagline(data?.tagline ?? '');
      setSettingsLoaded(true);
      setAddress(data?.store_address ?? '');
      setRestaurantAddress(data?.restaurant_address ?? '');
      setHours(normalizeHours(data?.operating_hours));
      setOrderingEnabled(data?.ordering_enabled !== false);
      setVatRegistered(Boolean(data?.tax_vat_registered));
      setPricesVatInclusive(Boolean(data?.tax_prices_vat_inclusive));
      setVatRate(String(data?.tax_vat_rate ?? 12));
      setCashOnDeliveryEnabled(data?.cash_on_delivery_enabled !== false);
      setCashOnPickupEnabled(data?.cash_on_pickup_enabled !== false);
      setCashOnTakeOutEnabled(data?.cash_on_take_out_enabled !== false);
      setAutomaticRiderAssignmentEnabled(data?.automatic_rider_assignment_enabled === true);
      setDeliveryBaseFee(String(data?.delivery_base_fee ?? 0));
      setDeliveryDistanceIncrementMeters(String(data?.delivery_distance_increment_meters ?? 500));
      setDeliveryFeePerIncrement(String(data?.delivery_fee_per_increment ?? 10));
      setDeliveryMaxDistanceMeters(String(data?.delivery_max_distance_meters ?? 10000));
      setDeliveryLocationLatitude(data?.delivery_location_latitude ?? null);
      setDeliveryLocationLongitude(data?.delivery_location_longitude ?? null);

      const { data: paymongoConnection, error: paymongoError } = await supabase
        .from('restaurant_paymongo_accounts')
        .select('connection_status,paymongo_account_id,invitation_id')
        .eq('restaurant_id', restaurantId)
        .eq('environment', 'test')
        .maybeSingle();

      if (paymongoError) throw paymongoError;
      const simulatedTestAccount = (() => {
        try {
          const raw = window.localStorage.getItem(paymongoTestStorageKey);
          return raw ? JSON.parse(raw) as { accountId?: string; status?: string } : null;
        } catch {
          return null;
        }
      })();

      if (paymongoConnection?.connection_status && paymongoConnection.connection_status !== 'not_connected') {
        setPaymongoTestStatus(paymongoConnection.connection_status);
        setPaymongoTestAccountId(paymongoConnection.paymongo_account_id ?? '');
      } else if (simulatedTestAccount?.status === 'active' && simulatedTestAccount.accountId) {
        setPaymongoTestStatus('active');
        setPaymongoTestAccountId(simulatedTestAccount.accountId);
      } else {
        setPaymongoTestStatus('not_connected');
        setPaymongoTestAccountId('');
      }
      setPaymongoTestInvitationId(paymongoConnection?.invitation_id ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load store settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, [restaurantId]);

  async function startPayMongoTestConnection() {
    if (!supabase) {
      setPaymongoError('Supabase is not configured.');
      return;
    }

    setPaymongoBusy(true);
    setPaymongoError('');
    setMessage('');
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user?.email) throw new Error('Your account email could not be determined.');

      const { data, error: invokeError } = await supabase.functions.invoke('create-paymongo-linking-invitation', {
        body: {
          restaurantId,
          environment: 'test',
          email: userData.user.email,
        },
      });

      if (invokeError) {
        const response = (invokeError as { context?: Response }).context;
        if (response) {
          const responseBody = await response.clone().json().catch(() => null);
          if (typeof responseBody?.error === 'string' && responseBody.error.trim()) {
            throw new Error(responseBody.error);
          }
        }
        throw invokeError;
      }
      setPaymongoTestStatus(data?.status ?? 'active');
      setPaymongoTestAccountId(data?.paymongoAccountId ?? '');
      setPaymongoTestInvitationId(data?.invitationId ?? '');
      setPaymongoTestSignupUrl(data?.signupUrl ?? data?.verificationUrl ?? '');

      if (data?.testMode && data?.paymongoAccountId) {
        window.localStorage.setItem(paymongoTestStorageKey, JSON.stringify({
          accountId: data.paymongoAccountId,
          status: 'active',
        }));
        setMessage('PayMongo test connection is ready. Test mode uses a simulated merchant account; no real identity verification is required.');
      } else {
        const onboardingUrl = data?.signupUrl ?? data?.verificationUrl ?? '';
        if (onboardingUrl) window.open(onboardingUrl, '_blank', 'noopener,noreferrer');
        setMessage(
          data?.verificationUrl
            ? 'PayMongo test identity verification is ready. Complete the verification flow in the PayMongo window.'
            : 'PayMongo test onboarding link is ready. Complete the PayMongo signup, then return here and check the connection.',
        );
      }
    } catch (connectError) {
      setPaymongoError(connectError instanceof Error ? connectError.message : 'Unable to start PayMongo onboarding.');
    } finally {
      setPaymongoBusy(false);
    }
  }

  async function syncPayMongoTestConnection() {
    if (!supabase) return;
    setPaymongoBusy(true);
    setPaymongoError('');
    try {
      const simulatedTestAccount = (() => {
        try {
          const raw = window.localStorage.getItem(paymongoTestStorageKey);
          return raw ? JSON.parse(raw) as { accountId?: string; status?: string } : null;
        } catch {
          return null;
        }
      })();

      if (simulatedTestAccount?.status === 'active' && simulatedTestAccount.accountId) {
        setPaymongoTestStatus('active');
        setPaymongoTestAccountId(simulatedTestAccount.accountId);
        setPaymongoTestInvitationId('');
        setPaymongoTestSignupUrl('');
        setMessage('PayMongo test connection is ready. Test mode uses a simulated merchant account; no real identity verification is required.');
        return;
      }

      const { data, error: invokeError } = await supabase.functions.invoke('sync-paymongo-linking-invitation', {
        body: { restaurantId, environment: 'test' },
      });
      if (invokeError) throw invokeError;
      setPaymongoTestStatus(data?.status ?? 'not_connected');
      setPaymongoTestAccountId(data?.paymongoAccountId ?? '');
      if (data?.status === 'active') {
        setMessage('PayMongo test account is connected and ready for online payments.');
      } else {
        setMessage(data?.activationStatus ? `PayMongo onboarding status: ${data.activationStatus}.` : 'PayMongo onboarding is still in progress.');
      }
    } catch (syncError) {
      setPaymongoError(syncError instanceof Error ? syncError.message : 'Unable to check PayMongo onboarding.');
    } finally {
      setPaymongoBusy(false);
    }
  }



  async function startPayMongoLiveConnection() {
    if (!supabase) {
      setPaymongoError('Supabase is not configured.');
      return;
    }

    setPaymongoBusy(true);
    setPaymongoError('');
    setMessage('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('create-paymongo-child-account', {
        body: { restaurantId },
      });
      if (invokeError) {
        const response = (invokeError as { context?: Response }).context;
        if (response) {
          const responseBody = await response.clone().json().catch(() => null);
          if (typeof responseBody?.error === 'string' && responseBody.error.trim()) {
            throw new Error(responseBody.error);
          }
        }
        throw invokeError;
      }

      setPaymongoLiveStatus(data?.status ?? 'pending');
      setPaymongoLiveAccountId(data?.paymongoAccountId ?? '');
      setPaymongoLiveVerificationUrl(data?.verificationUrl ?? '');
      setPaymongoLiveStep(data?.onboardingStep ?? 'identity_verification');
      setPaymongoLiveIdentityStatus(data?.identityVerificationStatus ?? 'pending');

      if (data?.verificationUrl) {
        window.open(data.verificationUrl, '_blank', 'noopener,noreferrer');
        setMessage('PayMongo merchant onboarding has started. Complete identity verification in the PayMongo window, then return here and refresh the status.');
      } else if (data?.status === 'active') {
        setMessage('PayMongo live account is already active.');
      }
    } catch (connectError) {
      setPaymongoError(connectError instanceof Error ? connectError.message : 'Unable to start PayMongo live onboarding.');
    } finally {
      setPaymongoBusy(false);
    }
  }

  async function syncPayMongoLiveConnection() {
    if (!supabase) return;
    setPaymongoBusy(true);
    setPaymongoError('');
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('sync-paymongo-child-account', {
        body: { restaurantId },
      });
      if (invokeError) {
        const response = (invokeError as { context?: Response }).context;
        if (response) {
          const responseBody = await response.clone().json().catch(() => null);
          if (typeof responseBody?.error === 'string' && responseBody.error.trim()) {
            throw new Error(responseBody.error);
          }
        }
        throw invokeError;
      }

      setPaymongoLiveStatus(data?.status ?? 'pending');
      setPaymongoLiveAccountId(data?.paymongoAccountId ?? '');
      setPaymongoLiveVerificationUrl(data?.verificationUrl ?? '');
      setPaymongoLiveStep(data?.onboardingStep ?? '');
      setPaymongoLiveIdentityStatus(data?.identityVerificationStatus ?? '');

      if (data?.status === 'active') {
        setMessage('PayMongo live account is active and ready for online payments.');
      } else if (data?.onboardingStep === 'business_information') {
        setMessage('Identity verification passed. The PayMongo business information step is ready.');
      } else {
        setMessage(data?.activationStatus ? `PayMongo onboarding status: ${data.activationStatus}.` : 'PayMongo live onboarding is still in progress.');
      }
    } catch (syncError) {
      setPaymongoError(syncError instanceof Error ? syncError.message : 'Unable to check PayMongo live onboarding.');
    } finally {
      setPaymongoBusy(false);
    }
  }

  function updateDay(day: DayKey, patch: Partial<DayHours>) {
    setHours((current) => ({
      ...current,
      [day]: { ...current[day], ...patch },
    }));
    setMessage('');
    setError('');
  }

  useOwnerUnsavedChangesTracking('.restaurant-settings-page');

  async function saveSettings() {
    if (!settingsLoaded) {
      setError('Restaurant settings could not be loaded. Reload this page before saving so existing opening hours are not overwritten.');
      return;
    }
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    const parsedVatRate = Number(vatRate);
    const parsedBaseFee = Number(deliveryBaseFee);
    const parsedDistanceIncrement = Number(deliveryDistanceIncrementMeters);
    const parsedFeePerIncrement = Number(deliveryFeePerIncrement);
    const parsedMaxDistance = Number(deliveryMaxDistanceMeters);
    if (!Number.isFinite(parsedBaseFee) || parsedBaseFee < 0 || !Number.isFinite(parsedDistanceIncrement) || parsedDistanceIncrement <= 0 || !Number.isFinite(parsedFeePerIncrement) || parsedFeePerIncrement < 0 || !Number.isFinite(parsedMaxDistance) || parsedMaxDistance <= 0) {
      setError('Enter valid distance-based delivery pricing values.');
      return;
    }
    if ((deliveryLocationLatitude === null) !== (deliveryLocationLongitude === null)) {
      setError('Confirm the restaurant location on Google Maps before saving delivery settings.');
      return;
    }
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
          restaurant_address: restaurantAddress.trim() || null,
          store_address: address.trim() || null,
          operating_hours: normalizedHours,
          ordering_enabled: orderingEnabled,
          tax_vat_registered: vatRegistered,
          tax_prices_vat_inclusive: vatRegistered ? pricesVatInclusive : false,
          tax_vat_rate: vatRegistered ? parsedVatRate : 0,
          delivery_location_latitude: deliveryLocationLatitude,
          delivery_location_longitude: deliveryLocationLongitude,
        })
        .eq('id', restaurantId);

      if (saveError) throw saveError;

      const { error: taglineSaveError } = await supabase.rpc('update_restaurant_tagline', {
        p_restaurant_id: restaurantId,
        p_tagline: restaurantTagline.trim(),
      });
      if (taglineSaveError) throw taglineSaveError;

      // Save delivery pricing through an owner-scoped RPC. PostgREST UPDATE can
      // return no error when RLS filters the row, so the RPC must return the
      // exact saved values before the UI reports success.
      const { data: savedPricingRows, error: pricingSaveError } = await supabase.rpc('update_restaurant_delivery_pricing', {
        p_restaurant_id: restaurantId,
        p_base_fee: parsedBaseFee,
        p_distance_increment_meters: Math.round(parsedDistanceIncrement),
        p_fee_per_increment: parsedFeePerIncrement,
        p_max_distance_meters: Math.round(parsedMaxDistance),
      });
      if (pricingSaveError) throw pricingSaveError;
      const savedPricing = Array.isArray(savedPricingRows) ? savedPricingRows[0] : null;
      if (
        !savedPricing ||
        Number(savedPricing.delivery_base_fee) !== parsedBaseFee ||
        Number(savedPricing.delivery_distance_increment_meters) !== Math.round(parsedDistanceIncrement) ||
        Number(savedPricing.delivery_fee_per_increment) !== parsedFeePerIncrement ||
        Number(savedPricing.delivery_max_distance_meters) !== Math.round(parsedMaxDistance)
      ) {
        throw new Error('Delivery pricing was not saved. Please verify your restaurant owner permissions and try again.');
      }

      // Persist the delivery origin through an owner-scoped RPC as well.
      // Direct PostgREST UPDATE can succeed with zero affected rows when RLS
      // filters the restaurant, so do not rely on the absence of an error.
      const { error: originSaveError } = await supabase.rpc('update_restaurant_delivery_origin', {
        p_restaurant_id: restaurantId,
        p_store_address: address.trim() || null,
        p_latitude: deliveryLocationLatitude,
        p_longitude: deliveryLocationLongitude,
      });
      if (originSaveError) throw originSaveError;

      const { data: savedRow, error: verifyError } = await supabase
        .from('restaurants')
        .select('tagline,restaurant_address,store_address,operating_hours,delivery_base_fee,delivery_distance_increment_meters,delivery_fee_per_increment,delivery_max_distance_meters,delivery_location_latitude,delivery_location_longitude')
        .eq('id', restaurantId)
        .single();

      if (verifyError) throw verifyError;
      if (JSON.stringify(normalizeHours(savedRow.operating_hours)) !== JSON.stringify(normalizedHours)) {
        throw new Error('Opening hours did not save exactly as entered. Your settings were not confirmed; reload and check the schedule before trying again.');
      }
      if (
        Number(savedRow.delivery_base_fee) !== parsedBaseFee ||
        Number(savedRow.delivery_distance_increment_meters) !== Math.round(parsedDistanceIncrement) ||
        Number(savedRow.delivery_fee_per_increment) !== parsedFeePerIncrement ||
        Number(savedRow.delivery_max_distance_meters) !== Math.round(parsedMaxDistance)
      ) {
        throw new Error('Saved delivery pricing does not match your settings. Please try again.');
      }
      if (
        deliveryLocationLatitude !== null &&
        deliveryLocationLongitude !== null &&
        (
          Math.abs(Number(savedRow.delivery_location_latitude) - deliveryLocationLatitude) > 0.000001 ||
          Math.abs(Number(savedRow.delivery_location_longitude) - deliveryLocationLongitude) > 0.000001
        )
      ) {
        throw new Error('The restaurant delivery location was not saved. Please try again.');
      }

      const savedHours = normalizeHours(savedRow?.operating_hours);
      const savedAddress = savedRow?.store_address ?? '';
      if ((savedRow?.restaurant_address ?? '') !== (restaurantAddress.trim() || '')) {
        throw new Error('The restaurant address was not stored correctly. Please try again.');
      }
      if (savedAddress !== (address.trim() || '')) {
        throw new Error('The store address was not stored correctly. Please try again.');
      }
      const mismatchedDay = DAYS.find((day) =>
        savedHours[day.key].open !== normalizedHours[day.key].open ||
        savedHours[day.key].close !== normalizedHours[day.key].close ||
        savedHours[day.key].isOpen !== normalizedHours[day.key].isOpen
      );

      if (mismatchedDay) {
        throw new Error(`The ${mismatchedDay.label} operating hours were not stored correctly. Please try again.`);
      }

      setRestaurantTagline(savedRow?.tagline ?? restaurantTagline.trim());
      setAddress(savedAddress);
      setRestaurantAddress(savedRow?.restaurant_address ?? restaurantAddress.trim());
      setHours(savedHours);
      setMessage('Store settings saved successfully.');
      setUnsavedChanges(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save store settings.');
    } finally {
      setSaving(false);
    }
  }

  const openDays = useMemo(() => DAYS.filter((day) => hours[day.key].isOpen).length, [hours]);

  return (
    <section className="restaurant-page restaurant-settings-page">
      <style>{`
        .restaurant-settings-grid{display:grid;gap:16px}
        .restaurant-settings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:0}
        .restaurant-settings-header .eyebrow{margin:0 0 6px;font-size:11px;letter-spacing:.08em}
        .restaurant-settings-header h1{margin:0;font-size:clamp(25px,2.6vw,32px);line-height:1.2;letter-spacing:-.03em}
        .restaurant-settings-header .restaurant-settings-help{max-width:900px;margin-top:6px}
        .restaurant-settings-page{display:grid;gap:16px}

        .owner-feedback-toast{position:fixed;top:22px;left:50%;transform:translateX(-50%);z-index:12000;width:min(520px,calc(100vw - 32px));box-sizing:border-box;display:flex;align-items:flex-start;gap:12px;padding:15px 18px;border:1px solid;border-radius:14px;box-shadow:0 14px 40px rgba(15,23,42,.18);font-size:14px;line-height:1.45;animation:ownerFeedbackToastIn .22s ease-out}
        .owner-feedback-toast strong{display:block;margin:1px 0 3px;font-size:14px;font-weight:750}
        .owner-feedback-toast p{margin:0;font-size:13px}
        .owner-feedback-toast-icon{width:25px;height:25px;flex:0 0 25px;display:grid;place-items:center;border-radius:50%;font-size:13px;font-weight:800}
        .owner-feedback-toast.is-success{background:#f0fdf4;border-color:#86efac;color:#166534}
        .owner-feedback-toast.is-success .owner-feedback-toast-icon{background:#dcfce7;color:#15803d}
        .owner-feedback-toast.is-error{background:#fff7f7;border-color:#fca5a5;color:#991b1b}
        .owner-feedback-toast.is-error .owner-feedback-toast-icon{background:#fee2e2;color:#b91c1c}
        @keyframes ownerFeedbackToastIn{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}
        @media(prefers-reduced-motion:reduce){.owner-feedback-toast{animation:none}}
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
        .restaurant-settings-switch-track{position:relative;width:38px;height:22px;border-radius:999px;background:#cbd5e1;transition:background .2s ease;display:block}
        .restaurant-settings-switch-thumb{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.25);transition:transform .2s ease}
        .restaurant-settings-switch input:checked + .restaurant-settings-switch-track{background:#101b2f}
        .restaurant-settings-switch input:checked + .restaurant-settings-switch-track .restaurant-settings-switch-thumb{transform:translateX(16px)}
        .restaurant-settings-switch input:focus-visible + .restaurant-settings-switch-track{outline:2px solid #101b2f;outline-offset:2px}
        .restaurant-settings-switch input:disabled + .restaurant-settings-switch-track{opacity:.55}
        .restaurant-settings-logo-row{display:flex;align-items:center;gap:16px;margin-top:16px;flex-wrap:wrap}
        .restaurant-settings-logo-preview{width:96px;height:96px;border:1px solid #dbe2ea;border-radius:12px;background:#f8fafc;display:flex;align-items:center;justify-content:center;overflow:hidden;color:#94a3b8;font-size:12px}
        .restaurant-settings-logo-preview img{width:100%;height:100%;object-fit:contain}
        .restaurant-settings-logo-button{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center}
        .restaurant-settings-logo-button input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
        .restaurant-settings-logo-button input:disabled{cursor:not-allowed}
        .restaurant-settings-card{padding:18px;border:1px solid #dce4ee;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.025)}
        .restaurant-settings-card h2{margin:0 0 6px;font-size:18px;line-height:1.3;letter-spacing:-.02em}
        .restaurant-paymongo-status{display:grid;gap:8px;margin-top:16px;padding:14px;border:1px solid #e1e5eb;border-radius:10px;background:#f8fafc}
        .restaurant-paymongo-status>div{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
        .restaurant-paymongo-badge{display:inline-flex;align-items:center;border-radius:999px;padding:4px 9px;font-size:12px;font-weight:700;text-transform:capitalize;background:#e2e8f0;color:#334155}
        .restaurant-paymongo-badge.is-active{background:#dcfce7;color:#166534}
        .restaurant-paymongo-badge.is-pending,.restaurant-paymongo-badge.is-linked{background:#fef3c7;color:#92400e}
        .restaurant-paymongo-badge.is-error,.restaurant-paymongo-badge.is-revoked{background:#fee2e2;color:#991b1b}
        .restaurant-paymongo-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
        .restaurant-settings-help{margin:0;color:#64748b;line-height:1.5;font-size:14px}
        .restaurant-settings-form{display:grid;gap:16px}
        .restaurant-settings-form{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
        .restaurant-settings-tabs{display:flex;align-items:center;gap:26px;flex-wrap:wrap;border-bottom:1px solid #dbe2ea;margin:0}
        .restaurant-settings-tabs button{position:relative;display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 2px;margin:0 0 -1px;border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:#475569;font:inherit;font-size:13px;font-weight:500;white-space:nowrap;cursor:pointer}
        .restaurant-settings-tabs button:hover{color:#0f172a}
        .restaurant-settings-tabs button.is-active{border-bottom-color:#101b2f;color:#101b2f;font-weight:700}
        .restaurant-settings-tabs button:focus-visible{outline:2px solid #64748b;outline-offset:3px}
        .restaurant-settings-form>[role="tabpanel"][hidden],.restaurant-settings-form>#store-live-payments[hidden]{display:none!important}
        .restaurant-settings-card[id],#store-live-payments{scroll-margin-top:24px}
        @media(max-width:700px){.restaurant-settings-tabs{gap:18px;overflow-x:auto;flex-wrap:nowrap}.restaurant-settings-tabs button{flex:0 0 auto}}
        .restaurant-settings-field{display:grid;gap:7px;font-weight:600;font-size:14px}
        .restaurant-settings-field input[type=text]{width:100%;min-height:40px;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:9px;padding:8px 11px;font:inherit;color:#0f172a;background:#fff}
        .restaurant-settings-field input[type=number]{width:64px;min-height:38px;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:9px;padding:8px 10px;font:inherit;color:#0f172a;background:#fff;-moz-appearance:textfield}
        .restaurant-settings-field input[type=number]::-webkit-inner-spin-button,.restaurant-settings-field input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
        .restaurant-settings-field input:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-settings-days{display:grid;border:1px solid #e5e7eb;border-radius:10px;overflow:visible}
        .restaurant-settings-hours-head,.restaurant-settings-day{display:grid;grid-template-columns:140px minmax(120px,1fr) minmax(120px,1fr) 72px;align-items:center;gap:10px;padding:8px 12px}
        .restaurant-settings-hours-head{background:#f8fafc;color:#64748b;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
        .restaurant-settings-day{border-top:1px solid #e5e7eb}
        .restaurant-settings-day-name{font-weight:600}
        .restaurant-settings-day input[type=time]{width:100%;min-height:36px;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:8px;padding:6px 8px;font:inherit;background:#fff}
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
        .restaurant-delivery-pricing-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:18px}
        .restaurant-delivery-pricing-grid input[type=number]{width:100%;box-sizing:border-box}
        @media(max-width:700px){.restaurant-delivery-pricing-grid{grid-template-columns:1fr}}
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
.restaurant-paymongo-card{position:relative}
        .restaurant-paymongo-error{display:grid;gap:4px;margin:0 0 16px;padding:13px 15px;border:1px solid #fecaca;border-radius:10px;background:#fef2f2;color:#991b1b;line-height:1.4}
        .restaurant-paymongo-error strong{font-size:14px}
        .restaurant-paymongo-error span{font-size:13px;font-weight:600;overflow-wrap:anywhere}
        @media(max-width:700px){.restaurant-settings-header h1{font-size:26px}.restaurant-settings-hours-head{display:none}.restaurant-settings-day{grid-template-columns:1fr 1fr;padding:10px}.restaurant-settings-day-name{grid-column:1/-1}.restaurant-settings-toggle{justify-content:flex-start}.restaurant-settings-actions .button{width:100%}}
      `}</style>

      {error && <div className="owner-feedback-toast is-error" role="alert"><span className="owner-feedback-toast-icon" aria-hidden="true">!</span><div><strong>Couldn't complete that action</strong><p>{error}</p></div></div>}
      {message && <div className="owner-feedback-toast is-success" role="status"><span className="owner-feedback-toast-icon" aria-hidden="true">✓</span><div><strong>Changes saved</strong><p>{message}</p></div></div>}

      <form className="restaurant-settings-form" onSubmit={(event) => { event.preventDefault(); setShowSaveConfirmation(true); }}>
        <nav className="restaurant-settings-tabs" aria-label="Store settings tabs" role="tablist">
          {[
            { id: 'profile', label: 'Profile' },
            ...(hasSelfOrdering ? [{ id: 'status', label: 'Store status & hours' }] : []),
            { id: 'delivery', label: 'Delivery pricing' },
            { id: 'cod', label: 'Cash Payment Options' },
            { id: 'rider', label: 'Rider assignment' },
            ...(hasOnlinePayments ? [{ id: 'payments', label: 'Online payments' }] : []),
            { id: 'tax', label: 'Tax & receipts' },
          ].filter((tab) => hasDispatchDelivery || !['delivery', 'cod', 'rider'].includes(tab.id)).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`store-settings-tab-${tab.id}`}
              aria-selected={activeSettingsTab === tab.id}
              aria-controls={`store-settings-panel-${tab.id}`}
              className={activeSettingsTab === tab.id ? 'is-active' : ''}
              onClick={() => setActiveSettingsTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="restaurant-settings-card" id="store-profile" role="tabpanel" aria-labelledby="store-settings-tab-profile" hidden={activeSettingsTab !== 'profile'}>
          <label className="restaurant-settings-field" style={{ display: 'grid', gap: 7, marginTop: 16 }}>
            <span>Restaurant address</span>
            <input
              type="text"
              value={restaurantAddress}
              placeholder="Enter the address customers should see"
              disabled={loading || saving}
              onChange={(event) => { setRestaurantAddress(event.target.value); setMessage(''); setError(''); }}
            />
            <small className="restaurant-settings-help">This address is displayed to customers as the restaurant pickup location. It is separate from the delivery map location.</small>
          </label>
          <label className="restaurant-settings-field" style={{ display: 'grid', gap: 7, marginTop: 16 }}>
            <span>Restaurant tagline</span>
            <input
              type="text"
              maxLength={120}
              value={restaurantTagline}
              placeholder="Enter your restaurant tagline"
              disabled={loading || saving}
              onChange={(event) => { setRestaurantTagline(event.target.value); setMessage(''); setError(''); }}
            />
          </label>
        </div>

        {hasSelfOrdering && <div className="restaurant-settings-card" id="store-status" role="tabpanel" aria-labelledby="store-settings-tab-status" hidden={activeSettingsTab !== 'status'}>
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
        </div>}

                {hasSelfOrdering && <div className="restaurant-settings-card" id="store-hours" role="tabpanel" aria-labelledby="store-settings-tab-status" hidden={activeSettingsTab !== 'status'}>
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
        </div>}

                <div className="restaurant-settings-card" id="store-delivery" role="tabpanel" aria-labelledby="store-settings-tab-delivery" hidden={!hasDispatchDelivery || activeSettingsTab !== 'delivery'}>
          <div className="restaurant-delivery-pricing-grid">
            <label className="restaurant-settings-field"><span>Base delivery fee (₱)</span><input type="number" min="0" step="0.01" value={deliveryBaseFee} onChange={(event) => setDeliveryBaseFee(event.target.value)} disabled={loading || saving} /></label>
            <label className="restaurant-settings-field"><span>Distance increment (meters)</span><input type="number" min="1" step="1" value={deliveryDistanceIncrementMeters} onChange={(event) => setDeliveryDistanceIncrementMeters(event.target.value)} disabled={loading || saving} /></label>
            <label className="restaurant-settings-field"><span>Fee per increment (₱)</span><input type="number" min="0" step="0.01" value={deliveryFeePerIncrement} onChange={(event) => setDeliveryFeePerIncrement(event.target.value)} disabled={loading || saving} /></label>
            <label className="restaurant-settings-field"><span>Maximum driving distance (km)</span><input type="number" min="0.1" step="0.1" value={(Number(deliveryMaxDistanceMeters) / 1000).toString()} onChange={(event) => setDeliveryMaxDistanceMeters(String(Number(event.target.value) * 1000))} disabled={loading || saving} /></label>
          </div>
          <p className="restaurant-settings-help" style={{ marginTop: 12 }}>Example: ₱10 per 500 meters means 1.2 km = 3 distance increments. A base fee, if configured, is added on top.</p>
          <div style={{ marginTop: 18 }}>
            <p className="restaurant-settings-help" style={{ marginBottom: 10 }}><strong>Store address</strong><br />Set your restaurant's address by searching or adjusting the map pin. This location is also the origin Google Routes uses to calculate delivery distances and fees.</p>
            <MapboxDeliveryLocationPicker
              variant="restaurant"
              disabled={loading || saving}
              initialLatitude={deliveryLocationLatitude}
              initialLongitude={deliveryLocationLongitude}
              onSelect={(selected: MapboxDeliveryAddress) => {
                if (selected.latitude === null || selected.longitude === null) throw new Error('Google did not return an exact restaurant location.');
                setDeliveryLocationLatitude(selected.latitude);
                setDeliveryLocationLongitude(selected.longitude);
                // The map is the single source of truth for the restaurant address.
                // Keep the persisted address aligned whenever a search returns one.
                if (selected.formattedAddress.trim()) {
                  setAddress(selected.formattedAddress.trim());
                }
                setMessage('');
                setError('');
              }}
            />
            {deliveryLocationLatitude !== null && deliveryLocationLongitude !== null && <p className="restaurant-settings-help" style={{ marginTop: 10 }}>Confirmed coordinates: {deliveryLocationLatitude.toFixed(6)}, {deliveryLocationLongitude.toFixed(6)}</p>}
          </div>
        </div>

                <div className="restaurant-settings-card" id="store-cod" role="tabpanel" aria-labelledby="store-settings-tab-cod" hidden={!hasDispatchDelivery || activeSettingsTab !== 'cod'}>
          <p className="restaurant-settings-help" style={{ marginTop: 0, marginBottom: 18 }}>Cash Payment Options is controlled by the System Administrator. Contact the System Administrator to request a change.</p>
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
          <div style={{ marginTop: 24 }}>
            <label className="restaurant-settings-switch-row">
              <span>Accept Cash for Pickup</span>
              <span className="restaurant-settings-switch">
                <input type="checkbox" checked={cashOnPickupEnabled} disabled aria-label="Cash for pickup status (System Admin controlled)" />
                <span className="restaurant-settings-switch-track" aria-hidden="true"><span className="restaurant-settings-switch-thumb" /></span>
              </span>
            </label>
            <label className="restaurant-settings-switch-row">
              <span>Accept Cash for Take-out</span>
              <span className="restaurant-settings-switch">
                <input type="checkbox" checked={cashOnTakeOutEnabled} disabled aria-label="Cash for take-out status (System Admin controlled)" />
                <span className="restaurant-settings-switch-track" aria-hidden="true"><span className="restaurant-settings-switch-thumb" /></span>
              </span>
            </label>
          </div>
        </div>

                <div className="restaurant-settings-card" id="store-rider" role="tabpanel" aria-labelledby="store-settings-tab-rider" hidden={!hasDispatchDelivery || activeSettingsTab !== 'rider'}>
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

                {hasOnlinePayments && <div className="restaurant-settings-card restaurant-paymongo-card" id="store-payments" role="tabpanel" aria-labelledby="store-settings-tab-payments" hidden={activeSettingsTab !== 'payments'}>
          {paymongoError && <div className="restaurant-paymongo-error" role="alert">
            <strong>PayMongo connection error</strong>
            <span>{paymongoError}</span>
          </div>}
          <h2>PayMongo Online Payments</h2>
          <p className="restaurant-settings-help">Each restaurant connects its own PayMongo merchant account. Web2Table does not ask you to paste a PayMongo secret key into the website.</p>
          <div className="restaurant-paymongo-status">
            <div>
              <strong>Test environment</strong>
              <span className={`restaurant-paymongo-badge is-${paymongoTestStatus}`}>{paymongoTestStatus.replace('_', ' ')}</span>
            </div>
            {paymongoTestAccountId && <small>Connected account: {paymongoTestAccountId}</small>}
            {paymongoTestInvitationId && !paymongoTestAccountId && <small>Invitation: {paymongoTestInvitationId}</small>}
          </div>
          <div className="restaurant-paymongo-actions">
            {(paymongoTestStatus === 'not_connected' || paymongoTestStatus === 'error' || paymongoTestStatus === 'revoked') && (
              <button type="button" className="button button-primary restaurant-compact-action" disabled={paymongoBusy || loading || saving} onClick={() => void startPayMongoTestConnection()}>
                {paymongoBusy ? 'Starting…' : 'Connect PayMongo'}
              </button>
            )}
            {paymongoTestStatus === 'pending' && (
              <>
                {paymongoTestSignupUrl && (
                  <a className="button button-secondary restaurant-compact-action" href={paymongoTestSignupUrl} target="_blank" rel="noreferrer">
                    {paymongoTestInvitationId ? 'Open PayMongo' : 'Open Verification'}
                  </a>
                )}
                <button type="button" className="button button-primary" disabled={paymongoBusy || loading || saving} onClick={() => void startPayMongoTestConnection()}>
                  {paymongoBusy ? 'Checking…' : 'Refresh Test Connection'}
                </button>
              </>
            )}
            {paymongoTestStatus === 'linked' && (
              <button type="button" className="button button-primary restaurant-compact-action" disabled={paymongoBusy} onClick={() => void syncPayMongoTestConnection()}>
                {paymongoBusy ? 'Checking…' : 'Finish Connection'}
              </button>
            )}
            {paymongoTestStatus === 'active' && (
              <button type="button" className="button button-secondary restaurant-compact-action" disabled={paymongoBusy} onClick={() => void syncPayMongoTestConnection()}>
                {paymongoBusy ? 'Checking…' : 'Refresh Status'}
              </button>
            )}
          </div>
          <p className="restaurant-settings-help" style={{ marginTop: 12 }}>Test mode uses a PayMongo simulated merchant account, so no real identity verification is required. Production live payments will use the same restaurant-specific architecture with real merchant onboarding after the platform is ready for launch.</p>
        </div>}

                {hasOnlinePayments && <div id="store-live-payments" hidden={activeSettingsTab !== 'payments'}><PayMongoLiveOnboardingCard restaurantId={restaurantId} /></div>}



        <div className="restaurant-settings-card" id="store-tax" role="tabpanel" aria-labelledby="store-settings-tab-tax" hidden={activeSettingsTab !== 'tax'}>
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

                {!['cod', 'rider', 'tax'].includes(activeSettingsTab) && (
          <div className="restaurant-settings-actions">
            <button className="button button-primary restaurant-compact-action" type="submit" disabled={loading || saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
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
