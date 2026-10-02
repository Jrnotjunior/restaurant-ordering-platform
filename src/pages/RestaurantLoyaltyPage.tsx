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
    <section className="restaurant-loyalty-page">
      <style>{`
        .restaurant-loyalty-page{max-width:920px}
        .restaurant-loyalty-card{padding:28px;border:1px solid #e1e5eb;border-radius:14px;background:#fff}
        .restaurant-loyalty-card h1{margin:0 0 8px}
        .restaurant-loyalty-help{margin:0 0 24px;color:#64748b;line-height:1.6}
        .restaurant-loyalty-form{display:grid;gap:20px}
        .restaurant-loyalty-toggle{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc}
        .restaurant-loyalty-toggle-copy{display:grid;gap:4px}
        .restaurant-loyalty-toggle-copy strong{font-size:15px}
        .restaurant-loyalty-toggle-copy span{color:#64748b;font-size:13px}
        .restaurant-loyalty-switch{width:48px;height:26px}
        .restaurant-loyalty-rule{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .restaurant-loyalty-field{display:grid;gap:7px;font-weight:600;font-size:14px}
        .restaurant-loyalty-field input{width:100%;box-sizing:border-box;border:1px solid #dbe2ea;border-radius:10px;padding:12px;font:inherit;background:#fff}
        .restaurant-loyalty-field input:focus{outline:none;border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
        .restaurant-loyalty-preview{padding:16px;border-radius:12px;background:#f8fafc;color:#334155;line-height:1.6}
        .restaurant-loyalty-actions{display:flex;justify-content:flex-end}
        .restaurant-loyalty-message{margin-bottom:16px;padding:12px 14px;border-radius:10px}
        .restaurant-loyalty-message.is-success{background:#ecfdf5;color:#166534}
        .restaurant-loyalty-message.is-error{background:#fef2f2;color:#b91c1c}
        @media(max-width:700px){.restaurant-loyalty-rule{grid-template-columns:1fr}.restaurant-loyalty-actions .button{width:100%}}
      `}</style>
      {error && <div className="restaurant-loyalty-message is-error" role="alert">{error}</div>}
      {message && <div className="restaurant-loyalty-message is-success" role="status">{message}</div>}
      <div className="restaurant-loyalty-card">
        <p className="eyebrow">Customer rewards</p>
        <h1>Loyalty Program</h1>
        <p className="restaurant-loyalty-help">
          Set the rules customers use to earn points. Only customers with a registered account can earn loyalty points. Guest and walk-in orders remain at 0 points.
        </p>
        <div className="restaurant-loyalty-form">
          <div className="restaurant-loyalty-toggle">
            <div className="restaurant-loyalty-toggle-copy">
              <strong>Enable Loyalty Program</strong>
              <span>When disabled, completed orders will not award points.</span>
            </div>
            <input className="restaurant-loyalty-switch" type="checkbox" checked={enabled} disabled={loading || saving}
              onChange={(event) => { setEnabled(event.target.checked); setMessage(''); setError(''); }} />
          </div>
          <div className="restaurant-loyalty-rule">
            <label className="restaurant-loyalty-field">
              <span>Amount threshold (₱)</span>
              <input type="number" min="0.01" step="0.01" value={threshold} disabled={loading || saving}
                onChange={(event) => { setThreshold(event.target.value); setMessage(''); setError(''); }} />
            </label>
            <label className="restaurant-loyalty-field">
              <span>Points awarded</span>
              <input type="number" min="1" step="1" value={points} disabled={loading || saving}
                onChange={(event) => { setPoints(event.target.value); setMessage(''); setError(''); }} />
            </label>
          </div>
          <div className="restaurant-loyalty-preview">
            Customers earn <strong>{points || '0'} points</strong> for every <strong>₱{threshold || '0'}</strong> in eligible sales.
            For example, if the rule is ₱500 = 5 points, a ₱1,000 eligible order earns 10 points.
          </div>
          <div className="restaurant-loyalty-actions">
            <button className="button button-primary" type="button" onClick={() => void handleSave()} disabled={loading || saving}>
              {saving ? 'Saving…' : 'Save Loyalty Settings'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
