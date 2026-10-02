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
        .restaurant-loyalty-settings-form{display:grid;gap:22px}
        .restaurant-loyalty-settings-form .restaurant-settings-toggle{justify-content:flex-start;align-items:flex-start;padding:14px 0;border:0;background:transparent}
        .restaurant-loyalty-settings-form .restaurant-settings-toggle input{width:18px;height:18px;margin-top:2px;flex:0 0 auto}
        .restaurant-loyalty-settings-form .restaurant-settings-toggle span{display:grid;gap:4px}
        .restaurant-loyalty-settings-form .restaurant-settings-toggle strong{font-size:14px}
        .restaurant-loyalty-settings-form .restaurant-settings-toggle small{color:#64748b;font-size:13px;font-weight:400}
        .restaurant-loyalty-rule-preview{display:grid;gap:4px;padding:14px 16px;border:1px solid #e1e5eb;border-radius:10px;background:#f8fafc}
        .restaurant-loyalty-rule-preview span{font-size:11px;font-weight:600;color:#64748b}
        .restaurant-loyalty-rule-preview strong{font-size:15px;color:#0f172a}
        .restaurant-loyalty-rule-preview small{color:#64748b;line-height:1.5}
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
