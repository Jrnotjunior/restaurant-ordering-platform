import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };
type InventoryItem = { id: string; name: string; category: string; unit: string; quantity_on_hand: number | string; low_stock_threshold: number | string; updated_at: string };
type StockMovement = { id: string; item_name: string; quantity_change: number | string; reason: string; created_at: string; unit: string };
type ItemForm = { name: string; category: string; unit: string; quantity: string; threshold: string };
const emptyForm: ItemForm = { name: '', category: 'Ingredients', unit: 'pcs', quantity: '0', threshold: '5' };
const numberFormat = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 });
const dateTime = (value: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' }).format(new Date(value));

export function RestaurantInventoryPage({ restaurantId }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [adjustments, setAdjustments] = useState<Record<string, { quantity: string; reason: string }>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function loadInventory() {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [itemResult, movementResult] = await Promise.all([
        supabase.from('restaurant_inventory_items').select('id,name,category,unit,quantity_on_hand,low_stock_threshold,updated_at').eq('restaurant_id', restaurantId).order('name'),
        supabase.from('restaurant_inventory_movements').select('id,item_name,quantity_change,reason,created_at,unit').eq('restaurant_id', restaurantId).order('created_at', { ascending: false }).limit(50),
      ]);
      if (itemResult.error) throw itemResult.error;
      if (movementResult.error) throw movementResult.error;
      setItems((itemResult.data ?? []) as InventoryItem[]);
      setMovements((movementResult.data ?? []) as StockMovement[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load inventory. Check that the inventory migration has been applied.');
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadInventory(); }, [restaurantId]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => !query || item.name.toLowerCase().includes(query) || item.category.toLowerCase().includes(query));
  }, [items, search]);
  const outOfStockItems = items.filter((item) => Number(item.quantity_on_hand) <= 0);
  const lowStockItems = items.filter((item) => Number(item.quantity_on_hand) > 0 && Number(item.quantity_on_hand) <= Number(item.low_stock_threshold));
  const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity_on_hand), 0);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (!supabase) { setError('Supabase is not configured.'); return; }
    const name = form.name.trim();
    const quantity = Number(form.quantity);
    const threshold = Number(form.threshold);
    if (!name || !form.unit.trim() || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(threshold) || threshold < 0) {
      setError('Enter a name, valid unit, and non-negative stock and low-stock threshold.'); return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error: insertError } = await supabase.from('restaurant_inventory_items').insert({
        restaurant_id: restaurantId, name, category: form.category.trim() || 'Other', unit: form.unit.trim(),
        quantity_on_hand: quantity, low_stock_threshold: threshold, created_by: user?.id ?? null,
      }).select('id').single();
      if (insertError) throw insertError;
      if (quantity > 0 && data?.id) {
        const { error: movementError } = await supabase.from('restaurant_inventory_movements').insert({
          restaurant_id: restaurantId, item_id: data.id, item_name: name, unit: form.unit.trim(),
          quantity_change: quantity, reason: 'Initial stock',
          created_by: user?.id ?? null,
        });
        if (movementError) throw movementError;
      }
      setForm(emptyForm); setNotice('Inventory item added.'); await loadInventory();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to add inventory item.');
    } finally { setSaving(false); }
  }

  async function adjustStock(item: InventoryItem) {
    if (!supabase) { setError('Supabase is not configured.'); return; }
    const adjustment = adjustments[item.id];
    const quantity = Number(adjustment?.quantity);
    const reason = adjustment?.reason?.trim();
    if (!Number.isFinite(quantity) || quantity === 0 || !reason) {
      setError('Enter a non-zero stock adjustment and a reason. Use a negative number for stock used or discarded.'); return;
    }
    if (Number(item.quantity_on_hand) + quantity < 0) {
      setError('This adjustment would make stock negative. Check the quantity.'); return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      const { error: adjustError } = await supabase.rpc('restaurant_adjust_inventory_stock', {
        p_item_id: item.id, p_quantity_change: quantity, p_reason: reason,
      });
      if (adjustError) throw adjustError;
      setAdjustments((current) => ({ ...current, [item.id]: { quantity: '', reason: '' } }));
      setNotice(`Stock updated for ${item.name}.`);
      await loadInventory();
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : 'Unable to adjust stock.');
    } finally { setSaving(false); }
  }

  return <section className="restaurant-page restaurant-inventory-page">
    <style>{`
      .restaurant-inventory-page{display:grid;gap:18px;max-width:1240px}
      .inventory-header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
      .inventory-header h1{margin:0 0 6px;font-size:clamp(24px,3vw,32px);letter-spacing:-.03em}
      .inventory-header p{margin:0;color:var(--muted,#64748b);max-width:720px;line-height:1.5}
      .inventory-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
      .inventory-card,.inventory-panel{min-width:0;padding:17px;border:1px solid var(--border,#e2e8f0);border-radius:14px;background:var(--surface,#fff)}
      .inventory-card small{display:block;color:var(--muted,#64748b);font-size:12px;margin-bottom:8px}
      .inventory-card strong{font-size:clamp(20px,2.5vw,28px);overflow-wrap:anywhere}
      .inventory-panel h2{margin:0 0 12px;font-size:18px}
      .inventory-form-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:10px;align-items:end}
      .inventory-form label,.inventory-adjust label{display:grid;gap:6px;font-size:13px;font-weight:650;color:var(--text,#202938)}
      .inventory-form input,.inventory-form select,.inventory-adjust input,.inventory-adjust select,.inventory-search{width:100%;box-sizing:border-box;min-height:40px;border:1px solid var(--border,#dce2ea);border-radius:9px;padding:8px 10px;background:var(--surface,#fff);color:inherit;font:inherit}
      .inventory-button{border:1px solid var(--border,#dce2ea);border-radius:9px;padding:9px 12px;background:var(--surface,#fff);color:var(--text,#202938);font:inherit;font-weight:650;cursor:pointer}
      .inventory-button.primary{background:var(--color-primary,#111827);border-color:var(--color-primary,#111827);color:#fff}
      .inventory-button:disabled{opacity:.55;cursor:wait}
      .inventory-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
      .inventory-search{max-width:340px}
      .inventory-table-wrap{overflow:auto}
      .inventory-table{width:100%;border-collapse:collapse;font-size:13px}
      .inventory-table th,.inventory-table td{padding:11px 10px;border-bottom:1px solid var(--border,#e2e8f0);text-align:left;vertical-align:top;white-space:nowrap}
      .inventory-table th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted,#64748b)}
      .inventory-table .inventory-item-name{font-weight:700}
      .inventory-badge{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:750;background:#dcfce7;color:#166534}
      .inventory-badge.low{background:#fef3c7;color:#92400e}.inventory-badge.out{background:#fee2e2;color:#991b1b}
      .inventory-adjust{display:grid;grid-template-columns:80px 140px auto;gap:6px;min-width:300px;align-items:end}
      .inventory-adjust label{font-size:11px}
      .inventory-message{padding:12px 14px;border-radius:10px;font-size:13px}
      .inventory-message.error{background:#fef2f2;color:#991b1b}.inventory-message.notice{background:#eff6ff;color:#1d4ed8}
      .inventory-muted{color:var(--muted,#64748b);font-size:12px;line-height:1.5}
      @media(max-width:850px){.inventory-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:560px){.inventory-cards{grid-template-columns:1fr}.inventory-form-grid{grid-template-columns:1fr}.inventory-search{max-width:none}}
    `}</style>
    <header className="inventory-header"><div><h1>Inventory</h1><p>Track ingredients and supplies, record stock used or received, and spot items that need restocking. Inventory is separate from menu product availability.</p></div></header>
    {error && <div className="inventory-message error" role="alert">{error}</div>}
    {notice && <div className="inventory-message notice" role="status">{notice}</div>}
    <div className="inventory-cards">
      <div className="inventory-card"><small>Tracked items</small><strong>{items.length}</strong></div>
      <div className="inventory-card"><small>Low-stock items</small><strong>{lowStockItems.length}</strong></div>
      <div className="inventory-card"><small>Out of stock</small><strong>{outOfStockItems.length}</strong></div>
      <div className="inventory-card"><small>Total units across items</small><strong>{numberFormat.format(totalUnits)}</strong></div>
    </div>
    <section className="inventory-panel"><h2>Add ingredient or supply</h2>
      <form className="inventory-form" onSubmit={(event) => void addItem(event)}>
        <div className="inventory-form-grid">
          <label>Item name<input required maxLength={120} placeholder="e.g. Chicken breast" value={form.name} onChange={(event)=>setForm((current)=>({...current,name:event.target.value}))}/></label>
          <label>Category<select value={form.category} onChange={(event)=>setForm((current)=>({...current,category:event.target.value}))}><option>Ingredients</option><option>Packaging</option><option>Beverages</option><option>Cleaning</option><option>Supplies</option><option>Other</option></select></label>
          <label>Stock unit<select required value={form.unit} onChange={(event)=>setForm((current)=>({...current,unit:event.target.value}))}><option value="g">g (grams)</option><option value="kg">kg (kilograms)</option><option value="mg">mg (milligrams)</option><option value="ml">ml (millilitres)</option><option value="L">L (litres)</option><option value="pcs">pcs (pieces)</option><option value="pack">pack</option><option value="bottle">bottle</option><option value="box">box</option><option value="bag">bag</option><option value="can">can</option><option value="portion">portion</option><option value="roll">roll</option></select></label>
          <label>Starting stock<input required type="number" min="0" step="0.001" value={form.quantity} onChange={(event)=>setForm((current)=>({...current,quantity:event.target.value}))}/></label>
          <label>Low-stock level<input required type="number" min="0" step="0.001" value={form.threshold} onChange={(event)=>setForm((current)=>({...current,threshold:event.target.value}))}/></label>
        </div>
        <div style={{marginTop:12}}><button className="inventory-button primary" type="submit" disabled={saving}>{saving?'Saving…':'Add inventory item'}</button></div>
      </form>
    </section>
    <section className="inventory-panel"><div className="inventory-toolbar"><h2 style={{margin:0}}>Stock on hand</h2><input className="inventory-search" type="search" placeholder="Search items or categories" value={search} onChange={(event)=>setSearch(event.target.value)}/></div>
      {loading ? <p>Loading inventory…</p> : <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Item</th><th>Category</th><th>Stock</th><th>Low-stock level</th><th>Status</th><th>Adjust stock</th></tr></thead><tbody>
        {visibleItems.map((item)=><tr key={item.id}><td><div className="inventory-item-name">{item.name}</div><span className="inventory-muted">Updated {dateTime(item.updated_at)}</span></td><td>{item.category}</td><td>{numberFormat.format(Number(item.quantity_on_hand))} {item.unit}</td><td>{numberFormat.format(Number(item.low_stock_threshold))} {item.unit}</td><td><span className={`inventory-badge${Number(item.quantity_on_hand)<=0?' out':Number(item.quantity_on_hand)<=Number(item.low_stock_threshold)?' low':''}`}>{Number(item.quantity_on_hand)<=0?'Out of stock':Number(item.quantity_on_hand)<=Number(item.low_stock_threshold)?'Low stock':'In stock'}</span></td><td><div className="inventory-adjust"><label>Change (+/−)<input type="number" step="0.001" value={adjustments[item.id]?.quantity ?? ''} onChange={(event)=>setAdjustments((current)=>({...current,[item.id]:{quantity:event.target.value,reason:current[item.id]?.reason??''}}))} placeholder="+5 / -2"/></label><label>Reason<input value={adjustments[item.id]?.reason ?? ''} maxLength={240} onChange={(event)=>setAdjustments((current)=>({...current,[item.id]:{quantity:current[item.id]?.quantity??'',reason:event.target.value}}))} placeholder="Received, used, waste…"/></label><button className="inventory-button" type="button" disabled={saving} onClick={()=>void adjustStock(item)}>Save</button></div></td></tr>)}
        {!visibleItems.length && <tr><td colSpan={6}>{items.length?'No inventory items match your search.':'No inventory items yet. Add ingredients and supplies above to get started.'}</td></tr>}
      </tbody></table></div>}
    </section>
    <section className="inventory-panel"><h2>Recent stock movements</h2><p className="inventory-muted">The latest 50 recorded additions, usage, waste, and other stock adjustments.</p>
      <div className="inventory-table-wrap"><table className="inventory-table"><thead><tr><th>Date</th><th>Item</th><th>Change</th><th>Reason</th></tr></thead><tbody>
        {movements.map((movement)=><tr key={movement.id}><td>{dateTime(movement.created_at)}</td><td>{movement.item_name}</td><td>{Number(movement.quantity_change)>0?'+':''}{numberFormat.format(Number(movement.quantity_change))} {movement.unit}</td><td>{movement.reason}</td></tr>)}
        {!movements.length && <tr><td colSpan={4}>No stock movements recorded yet.</td></tr>}
      </tbody></table></div>
    </section>
  </section>;
}
