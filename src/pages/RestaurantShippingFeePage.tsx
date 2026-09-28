import { useEffect, useState } from 'react';
import { getRestaurantShippingFee, updateRestaurantShippingFee } from '../services/restaurantSettingsRepository';

type Props = { restaurantId: string };

export function RestaurantShippingFeePage({ restaurantId }: Props) {
  const [shippingFee, setShippingFee] = useState('0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getRestaurantShippingFee(restaurantId)
      .then((fee) => {
        if (!cancelled) setShippingFee(String(fee));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load shipping fee.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [restaurantId]);

  async function handleSave() {
    const fee = Number(shippingFee);
    if (!Number.isFinite(fee) || fee < 0) {
      setError('Enter a valid shipping fee of ₱0 or more.');
      setMessage('');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const normalizedFee = Math.round(fee * 100) / 100;
      await updateRestaurantShippingFee(restaurantId, normalizedFee);
      setShippingFee(String(normalizedFee));
      setMessage('Shipping fee saved successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save shipping fee.');
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
          <p>Set the delivery fee customers will pay when ordering from your restaurant.</p>
        </div>
      </div>

      <div className="restaurant-shipping-card">
        <label htmlFor="restaurant-shipping-fee-page">Delivery fee</label>
        <p className="restaurant-shipping-help">This fee is added to eligible delivery orders.</p>
        <div className="restaurant-shipping-input">
          <span>₱</span>
          <input
            id="restaurant-shipping-fee-page"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={shippingFee}
            onChange={(event) => { setShippingFee(event.target.value); setError(''); setMessage(''); }}
            disabled={loading || saving}
          />
        </div>
        {error && <div className="restaurant-shipping-message is-error" role="alert">{error}</div>}
        {message && <div className="restaurant-shipping-message is-success" role="status">{message}</div>}
        <button type="button" className="button" onClick={() => void handleSave()} disabled={loading || saving}>
          {loading ? 'Loading…' : saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </section>
  );
}
