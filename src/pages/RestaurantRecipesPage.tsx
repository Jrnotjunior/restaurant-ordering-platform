import { useEffect, useMemo, useState, type FormEvent, type CSSProperties } from 'react';
import { supabase } from '../services/supabaseClient';
import { getMenu } from '../modules/products/productService';
import type { RestaurantProduct } from '../types/menu';

type Props = { restaurantId: string };
type InventoryItem = { id: string; name: string; unit: string; quantity_on_hand: number | string };
type RecipeLink = { id: string; product_id: string; inventory_item_id: string; quantity_per_product: number | string; product_name?: string; item_name?: string; unit?: string };

export function RestaurantRecipesPage({ restaurantId }: Props) {
  const [products, setProducts] = useState<RestaurantProduct[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [recipes, setRecipes] = useState<RecipeLink[]>([]);
  const [productId, setProductId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    if (!supabase) { setError('Supabase is not configured.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [menu, stock, links] = await Promise.all([
        getMenu(restaurantId, true),
        supabase.from('restaurant_inventory_items').select('id,name,unit,quantity_on_hand').eq('restaurant_id', restaurantId).order('name'),
        supabase.from('restaurant_menu_recipe_ingredients').select('id,product_id,inventory_item_id,quantity_per_product').eq('restaurant_id', restaurantId).order('created_at'),
      ]);
      if (stock.error) throw stock.error;
      if (links.error) throw links.error;
      setProducts(menu.products);
      setInventory((stock.data ?? []) as InventoryItem[]);
      setRecipes((links.data ?? []) as RecipeLink[]);
      setProductId((current) => menu.products.some((p) => p.id === current) ? current : (menu.products[0]?.id ?? ''));
      setItemId((current) => (stock.data ?? []).some((i) => i.id === current) ? current : (stock.data?.[0]?.id ?? ''));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load recipes.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [restaurantId]);

  const productMap = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const itemMap = useMemo(() => new Map(inventory.map((i) => [i.id, i])), [inventory]);

  async function addRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    const amount = Number(quantity);
    if (!supabase || !productId || !itemId || !Number.isFinite(amount) || amount <= 0) {
      setError('Choose a menu product and inventory item, then enter a quantity greater than zero.'); return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error: saveError } = await supabase.from('restaurant_menu_recipe_ingredients').upsert({
        restaurant_id: restaurantId, product_id: productId, inventory_item_id: itemId,
        quantity_per_product: amount, created_by: user?.id ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: 'product_id,inventory_item_id' });
      if (saveError) throw saveError;
      setNotice('Recipe ingredient saved.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save recipe ingredient.'); }
    finally { setSaving(false); }
  }

  async function removeRecipe(recipe: RecipeLink) {
    if (!supabase) return;
    setError(''); setNotice(''); setSaving(true);
    try {
      const { error: deleteError } = await supabase.from('restaurant_menu_recipe_ingredients').delete().eq('id', recipe.id).eq('restaurant_id', restaurantId);
      if (deleteError) throw deleteError;
      setNotice('Recipe ingredient removed.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to remove recipe ingredient.'); }
    finally { setSaving(false); }
  }

  return <section className="restaurant-page" style={{display:'grid',gap:18,maxWidth:1100}}>
    <header><h1 style={{margin:'0 0 6px'}}>Recipe & Ingredient Linking</h1><p style={{margin:0,color:'var(--muted,#64748b)',lineHeight:1.5}}>Define how much stock each menu product uses. Ingredients are deducted automatically when an order is completed.</p></header>
    {error && <div role="alert" style={{padding:12,borderRadius:10,background:'#fef2f2',color:'#991b1b'}}>{error}</div>}
    {notice && <div role="status" style={{padding:12,borderRadius:10,background:'#eff6ff',color:'#1d4ed8'}}>{notice}</div>}
    <section style={{padding:18,border:'1px solid var(--border,#e2e8f0)',borderRadius:14,background:'var(--surface,#fff)'}}>
      <h2 style={{margin:'0 0 12px',fontSize:18}}>Add ingredient to a menu product</h2>
      {loading ? <p>Loading menu and inventory…</p> : products.length === 0 || inventory.length === 0 ? <div style={{display:'grid',gap:8}}>
        {products.length === 0 && <p style={{margin:0}}>No menu products were found for this restaurant. Add a product in <strong>Products</strong>, then refresh this page.</p>}
        {inventory.length === 0 && <p style={{margin:0}}>No inventory items were found for this restaurant. Add an ingredient in <strong>Inventory</strong>, then refresh this page.</p>}
        <p style={{margin:0,fontSize:12,color:'var(--muted,#64748b)'}}>Loaded {products.length} menu product(s) and {inventory.length} inventory item(s).</p>
        <div><button type="button" disabled={saving || loading} onClick={()=>void load()} style={buttonStyle}>Refresh menu and inventory</button></div>
      </div> : <form onSubmit={(e)=>void addRecipe(e)} style={{display:'grid',gridTemplateColumns:'2fr 2fr 1fr auto',gap:10,alignItems:'end'}}>
        <label style={{display:'grid',gap:6,fontSize:13}}>Menu product<select required value={productId} onChange={(e)=>setProductId(e.target.value)} style={fieldStyle}>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label style={{display:'grid',gap:6,fontSize:13}}>Ingredient / supply<select required value={itemId} onChange={(e)=>setItemId(e.target.value)} style={fieldStyle}>{inventory.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label>
        <label style={{display:'grid',gap:6,fontSize:13}}>Quantity per product<input required type="number" min="0.001" step="0.001" value={quantity} onChange={(e)=>setQuantity(e.target.value)} style={fieldStyle}/></label>
        <button type="submit" disabled={saving} style={buttonStyle}>{saving?'Saving…':'Save link'}</button>
      </form>}
      <p style={{fontSize:12,color:'var(--muted,#64748b)',lineHeight:1.5,marginBottom:0}}>Use the inventory item's unit. Example: 0.200 kg chicken per chicken meal. Saving the same product + ingredient pair updates its quantity.</p>
    </section>
    <section style={{padding:18,border:'1px solid var(--border,#e2e8f0)',borderRadius:14,background:'var(--surface,#fff)'}}>
      <h2 style={{margin:'0 0 12px',fontSize:18}}>Configured recipe ingredients</h2>
      {loading ? <p>Loading…</p> : recipes.length === 0 ? <p>No recipe links yet.</p> : <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr>{['Menu product','Ingredient','Quantity per product','Current stock',''].map(x=><th key={x} style={thStyle}>{x}</th>)}</tr></thead><tbody>{recipes.map(recipe=>{const item=itemMap.get(recipe.inventory_item_id);return <tr key={recipe.id}><td style={tdStyle}>{productMap.get(recipe.product_id) ?? 'Product unavailable'}</td><td style={tdStyle}>{item?.name ?? 'Inventory item unavailable'}</td><td style={tdStyle}>{Number(recipe.quantity_per_product).toLocaleString('en-PH',{maximumFractionDigits:3})} {item?.unit ?? ''}</td><td style={tdStyle}>{item ? Number(item.quantity_on_hand).toLocaleString('en-PH',{maximumFractionDigits:3})+' '+item.unit : '—'}</td><td style={tdStyle}><button type="button" disabled={saving} onClick={()=>void removeRecipe(recipe)} style={buttonStyle}>Remove</button></td></tr>})}</tbody></table></div>}
    </section>
    <p style={{fontSize:12,color:'var(--muted,#64748b)',lineHeight:1.5}}>Stock is deducted only once when an order changes to Completed. If any linked ingredient has insufficient stock, the completion update is rejected so the owner can correct the stock count or recipe first. Products without a recipe link do not deduct inventory.</p>
  </section>;
}

const fieldStyle: CSSProperties = {width:'100%',boxSizing:'border-box',minHeight:40,border:'1px solid var(--border,#dce2ea)',borderRadius:9,padding:'8px 10px',background:'var(--surface,#fff)',color:'inherit',font:'inherit'};
const buttonStyle: React.CSSProperties = {border:'1px solid var(--border,#dce2ea)',borderRadius:9,padding:'9px 12px',background:'var(--surface,#fff)',color:'var(--text,#202938)',font:'inherit',fontWeight:650,cursor:'pointer'};
const thStyle: React.CSSProperties = {padding:'11px 10px',borderBottom:'1px solid var(--border,#e2e8f0)',textAlign:'left',fontSize:11,textTransform:'uppercase',color:'var(--muted,#64748b)'};
const tdStyle: React.CSSProperties = {padding:'11px 10px',borderBottom:'1px solid var(--border,#e2e8f0)',textAlign:'left',verticalAlign:'top'};
