import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };

export function RestaurantLoyaltyPage({ restaurantId }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState('500');
  const [points, setPoints] = useState('5');
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
        .select('loyalty_enabled,loyalty_amount_threshold,loyalty_points_awarded')
        .eq('id', restaurantId)
        .single();
      if (loadError) throw loadError;
      setEnabled(Boolean(data?.loyalty_enabled));
      setThreshold(String(data?.loyalty_amount_threshold ?? 500));
      setPoints(String(data?.loyalty_points_awarded ?? 5));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load loyalty settings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSettings(); }, [restaurantId]);

  async function handleSave() {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }
    const parsedThreshold = Number(threshold);
    const parsedPoints = Number(points);
    if (!Number.isFinite(parsedThreshold) || parsedThreshold <= 0) {
      setError('Enter an amount greater than 0.');
      return;
    }
    if (!Number.isInteger(parsedPoints) || parsedPoints <= 0) {
      setError('Enter a whole number of points greater than 0.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { error: saveError } = await supabase
        .from('restaurants')
        .update({
          loyalty_enabled: enabled,
          loyalty_amount_threshold: parsedThreshold,
          loyalty_points_awarded: parsedPoints,
        })
        .eq('id', restaurantId);
      if (saveError) throw saveError;
      setMessage('Loyalty settings saved successfully.');
      await loadSettings();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save loyalty settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="restaurant-page restaurant-shipping-page">
      {error && <div className="restaurant-shipping-message is-error" role="alert">{error}</div>}
      {message && <div className="restaurant-shipping-message is-success" role="status">{message}</div>}

      <div className="restaurant-shipping-card">
        <div className="restaurant-shipping-section-header">
          <div>
            <p className="eyebrow">Customer rewards</p>
            <h2>Loyalty Program</h2>
            <p className="restaurant-shipping-help">
              Set how registered customers earn points from eligible sales. Guest and walk-in orders do not earn points.
            </p>
          </div>
        </div>

        <div className="restaurant-loyalty-form">
          <label className="restaurant-loyalty-toggle">
            <input
              type="checkbox"
              checked={enabled}
              disabled={loading || saving}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setMessage('');
                setError('');
              }}
            />
            <span>
              <strong>Enable Loyalty Program</strong>
              <small>When disabled, completed orders will not award points.</small>
            </span>
          </label>

          <div className="restaurant-loyalty-rule">
            <label>
              <span>Amount threshold (₱)</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={threshold}
                disabled={loading || saving}
                onChange={(event) => {
                  setThreshold(event.target.value);
                  setMessage('');
                  setError('');
                }}
              />
            </label>

            <label>
              <span>Points awarded</span>
              <input
                type="number"
                min="1"
                step="1"
                value={points}
                disabled={loading || saving}
                onChange={(event) => {
                  setPoints(event.target.value);
                  setMessage('');
                  setError('');
                }}
              />
            </label>
          </div>

          <div className="restaurant-loyalty-rule-preview">
            <span>Current earning rule</span>
            <strong>{points || '0'} points for every ₱{threshold || '0'} in eligible sales</strong>
            <small>
              Example: if the rule is ₱500 = 5 points, a ₱1,000 eligible order earns 10 points.
            </small>
          </div>

          <div className="restaurant-loyalty-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => void handleSave()}
              disabled={loading || saving}
            >
              {saving ? 'Saving…' : 'Save Loyalty Settings'}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .restaurant-loyalty-form{display:grid;gap:18px}
        .restaurant-loyalty-toggle{display:flex;align-items:flex-start;gap:10px;padding:.25rem 0;color:var(--color-text);font-size:.85rem;font-weight:700}
        .restaurant-loyalty-toggle input{width:18px;height:18px;margin:1px 0 0;accent-color:var(--color-primary);flex:0 0 auto}
        .restaurant-loyalty-toggle span{display:grid;gap:.25rem}
        .restaurant-loyalty-toggle small{color:var(--color-muted);font-size:.75rem;font-weight:500;line-height:1.4}
        .restaurant-loyalty-rule{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
        .restaurant-loyalty-rule label{display:grid;gap:.4rem;color:var(--color-text);font-size:.85rem;font-weight:700}
        .restaurant-loyalty-rule label > span{color:var(--color-muted);font-size:.8rem;font-weight:800}
        .restaurant-loyalty-rule input{width:100%;box-sizing:border-box;min-height:44px;padding:.7rem .8rem;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-background);color:var(--color-text);font:inherit;appearance:textfield;-moz-appearance:textfield}
        .restaurant-loyalty-rule input::-webkit-inner-spin-button,.restaurant-loyalty-rule input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
        .restaurant-loyalty-rule input:focus{border-color:var(--color-primary);outline:2px solid color-mix(in srgb,var(--color-primary) 15%,transparent)}
        .restaurant-loyalty-rule-preview{display:grid;gap:.25rem;padding:1rem;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-secondary)}
        .restaurant-loyalty-rule-preview span{color:var(--color-muted);font-size:.8rem;font-weight:800}
        .restaurant-loyalty-rule-preview strong{color:var(--color-text);font-size:.95rem}
        .restaurant-loyalty-rule-preview small{color:var(--color-muted);font-size:.75rem;line-height:1.4}
        .restaurant-loyalty-actions{display:flex;justify-content:flex-end}
        @media(max-width:760px){.restaurant-loyalty-rule{grid-template-columns:1fr}.restaurant-loyalty-actions{justify-content:stretch}.restaurant-loyalty-actions .button{width:100%}}
      `}</style>
    </section>
  );
}
