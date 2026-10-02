import { useEffect, useMemo, useState } from 'react';
import { getMenu } from '../services/menuRepository';
import { createOrder } from '../services/orderRepository';
import { applyPosDiscount, confirmDineInPayment, type PosDiscountType } from '../services/restaurantOrderRepository';
import type { RestaurantProduct } from '../types/menu';
import { supabase } from '../services/supabaseClient';

type Props = { restaurantId: string };

type CartItem = {
  product: RestaurantProduct;
  quantity: number;
};

export function RestaurantCashierPosPage({ restaurantId }: Props) {
  const [products, setProducts] = useState<RestaurantProduct[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<'dine_in' | 'pickup'>('dine_in');
  const [customerName, setCustomerName] = useState('Walk-in Customer');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [discountType, setDiscountType] = useState<PosDiscountType | ''>('');
  const [discountIdNumber, setDiscountIdNumber] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState(0);

  async function loadMenu() {
    try {
      setLoading(true);
      setError('');
      const menu = await getMenu(restaurantId);
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
    const channel = supabase
      .channel(`cashier-pos-menu:${restaurantId}`)
      .on('broadcast', { event: 'restaurant_menu_changed' }, () => { void loadMenu(); })
      .subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, [restaurantId]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) =>
      (category === 'all' || product.categoryId === category) &&
      (!query || product.name.toLowerCase().includes(query)),
    );
  }, [products, category, search]);

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0),
    [cart],
  );
  const discountAmount = appliedDiscount > 0 ? appliedDiscount : (discountType ? Number((subtotal * 0.20).toFixed(2)) : 0);
  const total = Math.max(Number((subtotal - discountAmount).toFixed(2)), 0);

  function addProduct(product: RestaurantProduct) {
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) {
        return current.map((item) => item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item);
      }
      return [...current, { product, quantity: 1 }];
    });
    setSuccess('');
  }

  function changeQuantity(productId: string, amount: number) {
    setCart((current) => current
      .map((item) => item.product.id === productId ? { ...item, quantity: item.quantity + amount } : item)
      .filter((item) => item.quantity > 0));
  }

  function clearDiscount() {
    setDiscountType('');
    setDiscountIdNumber('');
    setAppliedDiscount(0);
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
        mobileNumber: '',
        orderType,
        deliveryBarangay: '',
        deliveryAddress: '',
        notes: 'POS ORDER — cash collected by cashier.',
        paymentMethod: 'cash',
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
      });

      if (discountType) {
        const applied = await applyPosDiscount(created.orderId, discountType, discountIdNumber);
        setAppliedDiscount(applied.discountAmount);
      }

      await confirmDineInPayment(created.orderId);

      window.dispatchEvent(new Event('restaurant-ordering-active-order-change'));
      setCart([]);
      clearDiscount();
      setSuccess(`Order ${created.orderNumber} created and sent to the kitchen.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create POS order.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="restaurant-pos-page">
      <div className="restaurant-pos-header">
        <div>
          <p className="eyebrow">Cashier</p>
          <h1>POS</h1>
          <p>Create orders for walk-in customers who order at the counter.</p>
        </div>
        <span className="restaurant-dashboard-live-status is-live">
          <span className="restaurant-dashboard-live-dot" />Live
        </span>
      </div>

      {error && <div className="restaurant-pos-message is-error" role="alert">{error}</div>}
      {success && <div className="restaurant-pos-message is-success" role="status">{success}</div>}

      <div className="restaurant-pos-layout">
        <div className="restaurant-pos-menu">
          <div className="restaurant-pos-toolbar">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search menu items"
              aria-label="Search menu items"
            />
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Menu category">
              <option value="all">All categories</option>
              {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>

          {loading ? <div className="restaurant-pos-empty">Loading menu…</div> : (
            <div className="restaurant-pos-products">
              {visibleProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="restaurant-pos-product"
                  onClick={() => addProduct(product)}
                >
                  <span className="restaurant-pos-product-name">{product.name}</span>
                  <strong>₱{product.price.toFixed(2)}</strong>
                </button>
              ))}
              {!visibleProducts.length && <div className="restaurant-pos-empty">No available products found.</div>}
            </div>
          )}
        </div>

        <aside className="restaurant-pos-cart">
          <div className="restaurant-pos-cart-header">
            <div>
              <p className="eyebrow">Walk-in order</p>
              <h2>Current Order</h2>
            </div>
            <strong>₱{total.toFixed(2)}</strong>
          </div>

          <label className="restaurant-pos-field">
            <span>Customer name</span>
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
          </label>

          <div className="restaurant-pos-type">
            <span>Order type</span>
            <div>
              <button type="button" className={orderType === 'dine_in' ? 'is-active' : ''} onClick={() => setOrderType('dine_in')}>Dine-in</button>
              <button type="button" className={orderType === 'pickup' ? 'is-active' : ''} onClick={() => setOrderType('pickup')}>Take-out</button>
            </div>
          </div>

          <div className="restaurant-pos-discount">
            <div className="restaurant-pos-discount-header">
              <strong>Senior / PWD Discount</strong>
              <span>20%</span>
            </div>
            <div className="restaurant-pos-discount-types">
              <button type="button" className={discountType === 'senior' ? 'is-active' : ''} onClick={() => { setDiscountType(discountType === 'senior' ? '' : 'senior'); setAppliedDiscount(0); }} disabled={saving}>Senior Citizen</button>
              <button type="button" className={discountType === 'pwd' ? 'is-active' : ''} onClick={() => { setDiscountType(discountType === 'pwd' ? '' : 'pwd'); setAppliedDiscount(0); }} disabled={saving}>PWD</button>
            </div>
            {discountType && (
              <label className="restaurant-pos-field">
                <span>{discountType === 'senior' ? 'Senior Citizen ID number' : 'PWD ID number'}</span>
                <input value={discountIdNumber} onChange={(event) => setDiscountIdNumber(event.target.value)} placeholder="Enter ID number" disabled={saving} />
              </label>
            )}
            {discountType && <p className="restaurant-pos-discount-note">One customer may use either Senior Citizen or PWD discount for this transaction, not both. Verify the ID before applying the discount.</p>}
          </div>

          <div className="restaurant-pos-cart-items">
            {cart.length === 0 ? <p>No items added yet.</p> : cart.map((item) => (
              <div className="restaurant-pos-cart-item" key={item.product.id}>
                <div>
                  <strong>{item.product.name}</strong>
                  <span>₱{item.product.price.toFixed(2)} each</span>
                </div>
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
            {discountType && <div className="restaurant-pos-total restaurant-pos-discount-total"><span>{discountType === 'senior' ? 'Senior Citizen Discount' : 'PWD Discount'}</span><strong>-₱{discountAmount.toFixed(2)}</strong></div>}
            <div className="restaurant-pos-total restaurant-pos-grand-total"><span>Total</span><strong>₱{total.toFixed(2)}</strong></div>
          </div>

          <button className="button button-primary restaurant-pos-submit" type="button" disabled={!cart.length || saving || Boolean(discountType && !discountIdNumber.trim())} onClick={() => void placeOrder()}>
            {saving ? 'Creating Order…' : 'Cash Paid — Send to Kitchen'}
          </button>
        </aside>
      </div>
    </section>
  );
}
