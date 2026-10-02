import { useEffect, useMemo, useState } from 'react';
import { getMenu } from '../services/menuRepository';
import { createOrder } from '../services/orderRepository';
import { applyPosGroupDiscounts, confirmDineInPayment, getRestaurantTaxSettings, type PosDiscountIdType, type PosDiscountType, type RestaurantTaxSettings } from '../services/restaurantOrderRepository';
import type { RestaurantProduct } from '../types/menu';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };
type CartItem = { product: RestaurantProduct; quantity: number };
type DraftBeneficiary = { discountType: PosDiscountType; idType: PosDiscountIdType; idNumber: string };

const idOptions: Record<PosDiscountType, { value: PosDiscountIdType; label: string }[]> = {
  senior: [
    { value: 'osca_id', label: 'OSCA Senior Citizen ID' },
    { value: 'national_senior_id', label: 'National Senior Citizens ID' },
    { value: 'passport', label: 'Passport' },
    { value: 'other_government_id', label: 'Other Government ID' },
  ],
  pwd: [
    { value: 'pwd_id', label: 'PWD ID' },
    { value: 'passport', label: 'Passport' },
  ],
};

const defaultIdType = (type: PosDiscountType): PosDiscountIdType => type === 'senior' ? 'osca_id' : 'pwd_id';

export function RestaurantCashierPosPage({ restaurantId }: Props) {
  const [products, setProducts] = useState<RestaurantProduct[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<'dine_in' | 'pickup'>('dine_in');
  const [customerName, setCustomerName] = useState('Walk-in Customer');
  const [groupSize, setGroupSize] = useState(1);
  const [beneficiaries, setBeneficiaries] = useState<DraftBeneficiary[]>([]);
  const [taxSettings, setTaxSettings] = useState<RestaurantTaxSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function loadMenu() {
    try {
      setLoading(true);
      setError('');
      const [menu, tax] = await Promise.all([getMenu(restaurantId), getRestaurantTaxSettings(restaurantId)]);
      setTaxSettings(tax);
      setProducts(menu.products.filter((product) => product.isAvailable));
      setCategories(menu.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the menu.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadMenu(); }, [restaurantId]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel(`cashier-pos-menu:${restaurantId}`).on('broadcast', { event: 'restaurant_menu_changed' }, () => { void loadMenu(); }).subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, [restaurantId]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => (category === 'all' || product.categoryId === category) && (!query || product.name.toLowerCase().includes(query)));
  }, [products, category, search]);

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0), [cart]);
  const baseNetSales = taxSettings?.vatRegistered && taxSettings.pricesVatInclusive
    ? subtotal / (1 + taxSettings.vatRate / 100)
    : subtotal;
  const eligibleShare = beneficiaries.length > 0 ? Number((baseNetSales / groupSize).toFixed(2)) : 0;
  const discountAmount = beneficiaries.length ? Number((eligibleShare * beneficiaries.length * 0.20).toFixed(2)) : 0;
  const vatableSales = Math.max(Number((baseNetSales - eligibleShare * beneficiaries.length).toFixed(2)), 0);
  const vatAmount = taxSettings?.vatRegistered ? Number((vatableSales * taxSettings.vatRate / 100).toFixed(2)) : 0;
  const vatExemptSales = beneficiaries.length ? Math.max(Number((eligibleShare * beneficiaries.length - discountAmount).toFixed(2)), 0) : 0;
  const netSales = Number((vatableSales + vatExemptSales).toFixed(2));
  const total = Math.max(Number((netSales + vatAmount).toFixed(2)), 0);

  function addProduct(product: RestaurantProduct) {
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) return current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { product, quantity: 1 }];
    });
    setSuccess('');
  }

  function changeQuantity(productId: string, amount: number) {
    setCart((current) => current.map((item) => item.product.id === productId ? { ...item, quantity: item.quantity + amount } : item).filter((item) => item.quantity > 0));
  }

  function addBeneficiary(type: PosDiscountType) {
    if (beneficiaries.length >= groupSize) return;
    setBeneficiaries((current) => [...current, { discountType: type, idType: defaultIdType(type), idNumber: '' }]);
  }

  function removeBeneficiary(index: number) {
    setBeneficiaries((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateBeneficiary(index: number, patch: Partial<DraftBeneficiary>) {
    setBeneficiaries((current) => current.map((beneficiary, itemIndex) => itemIndex === index ? { ...beneficiary, ...patch } : beneficiary));
  }

  function changeGroupSize(value: string) {
    const nextSize = Math.max(Number(value) || 1, 1);
    setGroupSize(nextSize);
    setBeneficiaries((current) => current.slice(0, nextSize));
  }

  function clearDiscounts() {
    setGroupSize(1);
    setBeneficiaries([]);
  }

  async function placeOrder() {
    if (!cart.length || saving) return;
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const created = await createOrder({
        restaurantId,
        customerName: customerName.trim() || 'Walk-in Customer',
        mobileNumber: 'N/A',
        orderType,
        deliveryBarangay: '',
        deliveryAddress: '',
        notes: 'POS ORDER — cash collected by cashier.',
        paymentMethod: 'cash',
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
      });

      await applyPosGroupDiscounts(created.orderId, groupSize, beneficiaries);
      await confirmDineInPayment(created.orderId);
      window.dispatchEvent(new Event('restaurant-ordering-active-order-change'));
      setCart([]);
      clearDiscounts();
      setSuccess(`Order ${created.orderNumber} created and sent to the kitchen.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create POS order.');
    } finally {
      setSaving(false);
    }
  }

  const discountReady = beneficiaries.every((beneficiary) => beneficiary.idNumber.trim().length > 0) && beneficiaries.length <= groupSize;

  return (
    <section className="restaurant-pos-page">
      <div className="restaurant-pos-header">
        <div><p className="eyebrow">Cashier</p><h1>POS</h1><p>Create orders for walk-in customers who order at the counter.</p></div>
        <span className="restaurant-dashboard-live-status is-live"><span className="restaurant-dashboard-live-dot" />Live</span>
      </div>
      {error && <div className="restaurant-pos-message is-error" role="alert">{error}</div>}
      {success && <div className="restaurant-pos-message is-success" role="status">{success}</div>}

      <div className="restaurant-pos-layout">
        <div className="restaurant-pos-menu">
          <div className="restaurant-pos-toolbar">
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search menu items" aria-label="Search menu items" />
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Menu category">
              <option value="all">All categories</option>
              {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          {loading ? <div className="restaurant-pos-empty">Loading menu…</div> : (
            <div className="restaurant-pos-products">
              {visibleProducts.map((product) => (
                <button key={product.id} type="button" className="restaurant-pos-product" onClick={() => addProduct(product)}>
                  <span className="restaurant-pos-product-name">{product.name}</span><strong>₱{product.price.toFixed(2)}</strong>
                </button>
              ))}
              {!visibleProducts.length && <div className="restaurant-pos-empty">No available products found.</div>}
            </div>
          )}
        </div>

        <aside className="restaurant-pos-cart">
          <div className="restaurant-pos-cart-header"><div><p className="eyebrow">Walk-in order</p><h2>Current Order</h2></div><strong>₱{total.toFixed(2)}</strong></div>

          <label className="restaurant-pos-field"><span>Customer name</span><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>

          <div className="restaurant-pos-type"><span>Order type</span><div>
            <button type="button" className={orderType === 'dine_in' ? 'is-active' : ''} onClick={() => setOrderType('dine_in')}>Dine-in</button>
            <button type="button" className={orderType === 'pickup' ? 'is-active' : ''} onClick={() => setOrderType('pickup')}>Take-out</button>
          </div></div>

          <div className="restaurant-pos-discount">
            <div className="restaurant-pos-discount-header"><strong>Senior / PWD Discount</strong><span>20%</span></div>
            <label className="restaurant-pos-field"><span>Number of customers</span><input type="number" min={1} value={groupSize} onChange={(event) => changeGroupSize(event.target.value)} disabled={saving} /></label>

            <div className="restaurant-pos-discount-types">
              <button type="button" onClick={() => addBeneficiary('senior')} disabled={saving || beneficiaries.length >= groupSize}>+ Senior Citizen</button>
              <button type="button" onClick={() => addBeneficiary('pwd')} disabled={saving || beneficiaries.length >= groupSize}>+ PWD</button>
            </div>

            {beneficiaries.map((beneficiary, index) => (
              <div className="restaurant-pos-beneficiary" key={index}>
                <div className="restaurant-pos-beneficiary-header">
                  <strong>{beneficiary.discountType === 'senior' ? 'Senior Citizen' : 'PWD'} #{index + 1}</strong>
                  <button type="button" onClick={() => removeBeneficiary(index)} disabled={saving}>Remove</button>
                </div>
                <label className="restaurant-pos-field"><span>ID type</span><select value={beneficiary.idType} onChange={(event) => updateBeneficiary(index, { idType: event.target.value as PosDiscountIdType })} disabled={saving}>
                  {idOptions[beneficiary.discountType].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select></label>
                <label className="restaurant-pos-field"><span>ID number</span><input value={beneficiary.idNumber} onChange={(event) => updateBeneficiary(index, { idNumber: event.target.value })} placeholder="Enter ID number" disabled={saving} /></label>
              </div>
            ))}

            {beneficiaries.length > 0 && <p className="restaurant-pos-discount-note">Each eligible customer receives 20% of their equal share of the group subtotal. One person may use either Senior Citizen or PWD discount, not both. Verify every ID before applying the discounts.</p>}
          </div>

          <div className="restaurant-pos-cart-items">
            {cart.length === 0 ? <p>No items added yet.</p> : cart.map((item) => (
              <div className="restaurant-pos-cart-item" key={item.product.id}>
                <div><strong>{item.product.name}</strong><span>₱{item.product.price.toFixed(2)} each</span></div>
                <div className="restaurant-pos-quantity">
                  <button type="button" onClick={() => changeQuantity(item.product.id, -1)} aria-label={`Decrease ${item.product.name}`}>−</button>
                  <strong>{item.quantity}</strong>
                  <button type="button" onClick={() => changeQuantity(item.product.id, 1)} aria-label={`Increase ${item.product.name}`}>+</button>
                </div>
              </div>
            ))}
          </div>

          <div className="restaurant-pos-totals">
            <div className="restaurant-pos-total"><span>Subtotal</span><strong>₱{subtotal.toFixed(2)}</strong></div>
            {taxSettings?.vatRegistered && <div className="restaurant-pos-total"><span>VATable sales</span><strong>₱{vatableSales.toFixed(2)}</strong></div>}
            {taxSettings?.vatRegistered && <div className="restaurant-pos-total"><span>VAT {taxSettings.vatRate.toFixed(2)}%</span><strong>₱{vatAmount.toFixed(2)}</strong></div>}
            {beneficiaries.length > 0 && <>
              <div className="restaurant-pos-total"><span>Eligible share × {beneficiaries.length}</span><strong>₱{(eligibleShare * beneficiaries.length).toFixed(2)}</strong></div>
              {taxSettings?.vatRegistered && <div className="restaurant-pos-total"><span>VAT-exempt sales</span><strong>₱{vatExemptSales.toFixed(2)}</strong></div>}
              <div className="restaurant-pos-total restaurant-pos-discount-total"><span>Senior / PWD Discount</span><strong>-₱{discountAmount.toFixed(2)}</strong></div>
            </>}
            <div className="restaurant-pos-total restaurant-pos-grand-total"><span>Total</span><strong>₱{total.toFixed(2)}</strong></div>
          </div>

          {taxSettings && <p className="restaurant-pos-tax-status">{taxSettings.vatRegistered ? `VAT registered · ${taxSettings.vatRate.toFixed(2)}%${taxSettings.pricesVatInclusive ? ' · prices VAT-inclusive' : ' · prices VAT-exclusive'}` : 'Non-VAT registered'}</p>}
          <button className="button button-primary restaurant-pos-submit" type="button" disabled={!cart.length || saving || !discountReady || !taxSettings} onClick={() => void placeOrder()}>
            {saving ? 'Creating Order…' : 'Cash Paid — Send to Kitchen'}
          </button>
        </aside>
      </div>
    </section>
  );
}
