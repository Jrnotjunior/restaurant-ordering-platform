import { useEffect, useState } from 'react';
import { getMyCustomerProfile, saveMyDefaultDeliveryAddress } from '../services/loyaltyRepository';
import { getRestaurantDeliveryZones, type RestaurantDeliveryZone } from '../services/restaurantSettingsRepository';
import { useRestaurant } from '../components/RestaurantProvider';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import '../styles/saved-address.css';

function normalize(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isValenzuela(value: string) {
  const city = normalize(value);
  return city === 'valenzuela' || city === 'valenzuela city';
}

export function SavedAddressPage() {
  const restaurant = useRestaurant();
  const { user } = useRestaurantOwnerAuth();
  const [city, setCity] = useState('');
  const [barangay, setBarangay] = useState('');
  const [address, setAddress] = useState('');
  const [zones, setZones] = useState<RestaurantDeliveryZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!user || !restaurant.id) {
        if (!cancelled) {
          setLoading(false);
          setError('Please sign in to manage your saved address.');
        }
        return;
      }

      setLoading(true);
      setError('');

      try {
        const [profile, deliveryZones] = await Promise.all([
          getMyCustomerProfile(restaurant.id),
          getRestaurantDeliveryZones(restaurant.id),
        ]);

        if (cancelled) return;

        if (!profile) {
          setError('Your customer profile could not be found. Please sign in again.');
          return;
        }

        setCity(profile.defaultDeliveryCity ?? '');
        setBarangay(profile.defaultDeliveryBarangay ?? '');
        setAddress(profile.defaultDeliveryAddress ?? '');
        setZones(deliveryZones);
      } catch (loadError) {
        if (cancelled) return;
        console.error('Unable to load saved address.', loadError);
        setError(loadError instanceof Error ? loadError.message : 'Unable to load your saved address.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [restaurant.id, user?.id]);

  const cityIsSupported = isValenzuela(city);
  const suggestions = zones.filter((zone) => {
    if (!cityIsSupported) return false;
    const search = normalize(barangay);
    return !search || normalize(zone.barangay).includes(search);
  });
  const selectedZone = zones.find((zone) => normalize(zone.barangay) === normalize(barangay));

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setMessage('');
    setError('');

    const trimmedCity = city.trim();
    const trimmedBarangay = barangay.trim();
    const trimmedAddress = address.trim();

    if (!trimmedCity || !trimmedBarangay || !trimmedAddress) {
      setError('Please complete your city, barangay, and unit/building/street address.');
      return;
    }

    if (cityIsSupported && (!selectedZone || !selectedZone.isSupported)) {
      setError('Please select a supported delivery barangay.');
      return;
    }

    setSaving(true);

    try {
      await saveMyDefaultDeliveryAddress(
        restaurant.id!,
        trimmedCity,
        trimmedBarangay,
        trimmedAddress,
      );
      setCity(trimmedCity);
      setBarangay(trimmedBarangay);
      setAddress(trimmedAddress);
      setMessage('Your default delivery address has been saved.');
    } catch (saveError) {
      console.error('Unable to save default address.', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save your address.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="saved-address-page">
      <div className="saved-address-card">
        <a className="saved-address-back" href="#menu">← Back to menu</a>
        <p className="eyebrow">Customer account</p>
        <h1>Saved address</h1>
        <p className="saved-address-intro">Save your default delivery address so checkout can fill it in automatically.</p>

        {loading ? (
          <div className="saved-address-loading">Loading your saved address…</div>
        ) : (
          <form className="saved-address-form" onSubmit={handleSave}>
            <label>
              <span>City</span>
              <input
                type="text"
                value={city}
                onChange={(event) => {
                  setCity(event.target.value);
                  setBarangay('');
                  setMessage('');
                  setError('');
                }}
                autoComplete="address-level2"
                required
              />
            </label>

            <label>
              <span>Barangay</span>
              <input
                type="text"
                value={barangay}
                onChange={(event) => {
                  setBarangay(event.target.value);
                  setMessage('');
                  setError('');
                }}
                autoComplete="address-level3"
                list="saved-address-barangays"
                required
              />
              {cityIsSupported ? (
                <datalist id="saved-address-barangays">
                  {suggestions.map((zone) => <option key={zone.id} value={zone.barangay} />)}
                </datalist>
              ) : null}
            </label>

            <label>
              <span>Unit/Bldg./Street Address</span>
              <textarea
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setMessage('');
                  setError('');
                }}
                placeholder="Enter your unit, building, house number, and street"
                rows={4}
                required
              />
            </label>

            {cityIsSupported && selectedZone && !selectedZone.isSupported ? (
              <p className="saved-address-error" role="alert">This barangay is outside the restaurant's delivery area.</p>
            ) : null}

            {error ? <p className="saved-address-error" role="alert">{error}</p> : null}
            {message ? <p className="saved-address-success" role="status">{message}</p> : null}

            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Address'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
