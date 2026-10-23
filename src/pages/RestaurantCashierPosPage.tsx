import { useEffect, useMemo, useState } from 'react';
import { getMenu, subscribeToCashierMenuChanges } from '../modules/products/productService';
import { createOrder } from '../modules/ordering/orderService';
import { applyPosGroupDiscounts, confirmPosCashPayment, getCurrentCashierName, getRestaurantTaxSettings, type PosDiscountIdType, type PosDiscountType, type RestaurantTaxSettings } from '../modules/pos/posService';
import type { RestaurantProduct } from '../types/menu';
import { MapboxDeliveryLocationPicker, type MapboxDeliveryAddress } from '../components/MapboxDeliveryLocationPicker';
import { calculateDeliveryRoute, type DeliveryRouteQuote } from '../modules/location/locationService';
import { supabase } from '../services/supabaseClient';
import { attachCustomerToOrder, findCustomersByName, getLoyaltyRedemptionSettings, redeemLoyaltyReward, type LoyaltyCustomerSuggestion, type LoyaltyRedemptionSettings } from '../modules/loyalty/loyaltyService';

type Props = { restaurantId: string };
type CartItem = { product: RestaurantProduct; quantity: number };
type DraftBeneficiary = { discountType: PosDiscountType; idType: PosDiscountIdType; idNumber: string; beneficiaryName: string; beneficiaryTin: string; beneficiaryAddress: string; eligibleLineAmounts: Record<string, string> };
type PrintedBeneficiary = DraftBeneficiary & { eligibleAmount: number; discountAmount: number };
type PosPrintOrder = {
  orderNumber: string;
  customerName: string;
  mobileNumber: string;
  deliveryAddress: string;
  notes: string;
  cashierName: string;
  orderType: 'dine_in' | 'take_out' | 'pickup' | 'delivery';
  createdAt: string;
  items: CartItem[];
  beneficiaries: PrintedBeneficiary[];
  showTaxBreakdown: boolean;
  financials: {
    discountAmount: number;
    loyaltyDiscountAmount: number;
    grossSales: number;
    vatableSales: number;
    vatAmount: number;
    vatExemptSales: number;
    netSales: number;
    total: number;
  };
  deliveryFee: number;
  cashReceived: number;
  change: number;
};

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
  const [orderType, setOrderType] = useState<'dine_in' | 'take_out' | 'pickup' | 'delivery'>('dine_in');
  const [selfOrderingEnabled, setSelfOrderingEnabled] = useState(true);
  const [mobileNumber, setMobileNumber] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [deliveryBarangay, setDeliveryBarangay] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [selectedDeliveryLocation, setSelectedDeliveryLocation] = useState<MapboxDeliveryAddress | null>(null);
  const [deliveryRouteQuote, setDeliveryRouteQuote] = useState<DeliveryRouteQuote | null>(null);
  const [deliveryRouteLoading, setDeliveryRouteLoading] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedCustomerPoints, setSelectedCustomerPoints] = useState<number | null>(null);
  const [loyaltyRedemption, setLoyaltyRedemption] = useState<LoyaltyRedemptionSettings | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [customerSuggestions, setCustomerSuggestions] = useState<LoyaltyCustomerSuggestion[]>([]);
  const [customerSuggestionsLoading, setCustomerSuggestionsLoading] = useState(false);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [cashierName, setCashierName] = useState('Cashier');
  const [groupSize, setGroupSize] = useState<number | ''>(1);
  const [beneficiaries, setBeneficiaries] = useState<DraftBeneficiary[]>([]);
  const [taxSettings, setTaxSettings] = useState<RestaurantTaxSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [printOrder, setPrintOrder] = useState<PosPrintOrder | null>(null);

  async function loadMenu() {
    try {
      setLoading(true);
      setError('');
      const [menu, tax, redemption] = await Promise.all([getMenu(restaurantId, true), getRestaurantTaxSettings(restaurantId), getLoyaltyRedemptionSettings(restaurantId)]);
      setTaxSettings(tax);
      setLoyaltyRedemption(redemption);
      setProducts(menu.products);
      setCategories(menu.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the menu.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadMenu(); void loadCashierName(); void loadPackageAccess(); }, [restaurantId]);

  async function loadPackageAccess() {
    if (!supabase) {
      setSelfOrderingEnabled(true);
      return;
    }
    const { data, error } = await supabase.rpc('restaurant_get_my_modules', { p_restaurant_id: restaurantId });
    if (error) {
      setSelfOrderingEnabled(true);
      return;
    }
    const modules = Array.isArray(data) ? data as { module_key: string; enabled: boolean }[] : [];
    setSelfOrderingEnabled(modules.some((module) => module.module_key === 'self_ordering' && module.enabled));
    if (modules.some((module) => module.module_key === 'self_ordering' && module.enabled)) {
      setOrderType((current) => current === 'delivery' || current === 'pickup' ? 'dine_in' : current);
    }
  }
  async function loadCashierName() {
    setCashierName(await getCurrentCashierName(restaurantId));
  }


  useEffect(() => {
    const query = customerName.trim();

    if (query.length < 2 || query.toLowerCase() === 'walk-in customer') {
      setCustomerSuggestions([]);
      setCustomerSuggestionsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setCustomerSuggestionsLoading(true);
        const suggestions = await findCustomersByName(restaurantId, query);
        if (!cancelled) setCustomerSuggestions(suggestions);
      } catch {
        if (!cancelled) setCustomerSuggestions([]);
      } finally {
        if (!cancelled) setCustomerSuggestionsLoading(false);
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [restaurantId, customerName]);

  useEffect(() => {
    const unsubscribe = subscribeToCashierMenuChanges(restaurantId, () => {
      void loadMenu();
    });
    return () => {
      unsubscribe?.();
    };
  }, [restaurantId]);

  useEffect(() => {
    if (!printOrder) return;

    const handleAfterPrint = () => setPrintOrder(null);
    window.addEventListener('afterprint', handleAfterPrint);

    const timer = window.setTimeout(() => window.print(), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', handleAfterPrint);
    };
  }, [printOrder]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => (category === 'all' || product.categoryId === category) && (!query || product.name.toLowerCase().includes(query)));
  }, [products, category, search]);

  const money = (amount: number) => Number((Number.isFinite(amount) ? amount : 0).toFixed(2));
  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0), [cart]);
  const effectiveGroupSize = Math.max(Number(groupSize) || 1, 1);
  const priceHasIncludedVat = Boolean(taxSettings?.vatRegistered && taxSettings.pricesVatInclusive);
  const vatRate = taxSettings?.vatRegistered ? taxSettings.vatRate : 0;
  const eligibleAllocations = beneficiaries.flatMap((beneficiary) => cart.flatMap((item) => {
    const eligibleGross = money(Number(beneficiary.eligibleLineAmounts[item.product.id] || 0));
    if (eligibleGross <= 0) return [];
    const eligibleNet = priceHasIncludedVat && item.product.taxCategory === 'standard_rate'
      ? money(eligibleGross / (1 + vatRate / 100))
      : eligibleGross;
    return [{
      productId: item.product.id,
      taxCategory: item.product.taxCategory ?? null,
      eligibleGross,
      eligibleNet,
      discountAmount: money(eligibleNet * 0.20),
    }];
  }));
  const discountAmount = money(eligibleAllocations.reduce((sum, allocation) => sum + allocation.discountAmount, 0));
  const allocatedEligibleGross = money(eligibleAllocations.reduce((sum, allocation) => sum + allocation.eligibleGross, 0));
  const eligibleStandardGross = money(eligibleAllocations.filter((allocation) => allocation.taxCategory === 'standard_rate').reduce((sum, allocation) => sum + allocation.eligibleGross, 0));
  const eligibleStandardNet = money(eligibleAllocations.filter((allocation) => allocation.taxCategory === 'standard_rate').reduce((sum, allocation) => sum + allocation.eligibleNet, 0));
  const eligibleStandardDiscount = money(eligibleAllocations.filter((allocation) => allocation.taxCategory === 'standard_rate').reduce((sum, allocation) => sum + allocation.discountAmount, 0));
  const eligibleExemptDiscount = money(eligibleAllocations.filter((allocation) => allocation.taxCategory === 'vat_exempt').reduce((sum, allocation) => sum + allocation.discountAmount, 0));
  const eligibleZeroRatedDiscount = money(eligibleAllocations.filter((allocation) => allocation.taxCategory === 'zero_rated').reduce((sum, allocation) => sum + allocation.discountAmount, 0));
  const hasUnclassifiedCartItem = cart.some((item) => !item.product.taxCategory);
  const cartTaxBreakdownReady = cart.length > 0 && !hasUnclassifiedCartItem;
  const taxBreakdownVisible = Boolean(taxSettings?.vatRegistered && cartTaxBreakdownReady && beneficiaries.length === 0);
  const baseStandardNet = money(cart.reduce((sum, item) => {
    if (item.product.taxCategory !== 'standard_rate') return sum;
    const lineGross = item.product.price * item.quantity;
    return sum + (priceHasIncludedVat ? money(lineGross / (1 + vatRate / 100)) : lineGross);
  }, 0));
  const baseVatExemptSales = money(cart.reduce((sum, item) => sum + (item.product.taxCategory === 'vat_exempt' ? item.product.price * item.quantity : 0), 0));
  const baseZeroRatedSales = money(cart.reduce((sum, item) => sum + (item.product.taxCategory === 'zero_rated' ? item.product.price * item.quantity : 0), 0));
  const vatableSales = taxSettings?.vatRegistered
    ? Math.max(money((cartTaxBreakdownReady ? baseStandardNet : (priceHasIncludedVat ? money(subtotal / (1 + vatRate / 100)) : subtotal)) - eligibleStandardNet), 0)
    : 0;
  const vatAmount = taxSettings?.vatRegistered ? money(vatableSales * vatRate / 100) : 0;
  const vatExemptSales = taxSettings?.vatRegistered
    ? Math.max(money(baseVatExemptSales - eligibleExemptDiscount + eligibleStandardNet - eligibleStandardDiscount), 0)
    : 0;
  const zeroRatedSales = taxSettings?.vatRegistered ? Math.max(money(baseZeroRatedSales - eligibleZeroRatedDiscount), 0) : 0;
  const netSales = taxSettings?.vatRegistered
    ? money(vatableSales + vatExemptSales + zeroRatedSales)
    : Math.max(money(subtotal - discountAmount), 0);
  const preLoyaltyTotal = taxSettings?.vatRegistered
    ? (priceHasIncludedVat
      ? Math.max(money(subtotal - Math.max(eligibleStandardGross - eligibleStandardNet, 0) - discountAmount), 0)
      : (cartTaxBreakdownReady
        ? Math.max(money(netSales + vatAmount), 0)
        : Math.max(money(subtotal + vatAmount - eligibleStandardNet * vatRate / 100 - discountAmount), 0)))
    : Math.max(money(subtotal - discountAmount), 0);
  const loyaltyDiscountPreview = redeemPoints && selectedCustomerId && loyaltyRedemption?.enabled
    ? Math.min(money(loyaltyRedemption.discountAmount), preLoyaltyTotal)
    : 0;
  const deliveryFee = orderType === 'delivery' && deliveryRouteQuote?.inRange ? deliveryRouteQuote.deliveryFee : 0;
  const total = Math.max(money(preLoyaltyTotal + deliveryFee - loyaltyDiscountPreview), 0);
  const cashReceivedAmount = Number(cashReceived) || 0;
  const change = Math.max(money(cashReceivedAmount - total), 0);
  const eligibleLineAmountsValid = beneficiaries.every((beneficiary) =>
    Object.values(beneficiary.eligibleLineAmounts).every((value) =>
      value.trim() === '' || (Number.isFinite(Number(value)) && Number(value) >= 0),
    ),
  );
  const allocationsDoNotExceedLines = cart.every((item) => {
    const lineTotal = money(item.product.price * item.quantity);
    const allocated = beneficiaries.reduce((sum, beneficiary) => (
      sum + money(Math.max(Number(beneficiary.eligibleLineAmounts[item.product.id]) || 0, 0))
    ), 0);
    return allocated <= lineTotal + 0.001;
  });
  const uniqueBeneficiaryIds = new Set(beneficiaries.map((beneficiary) => beneficiary.idNumber.trim()).filter(Boolean)).size === beneficiaries.filter((beneficiary) => beneficiary.idNumber.trim()).length;
  const allBeneficiariesHaveEligibleLines = beneficiaries.every((beneficiary) =>
    Object.values(beneficiary.eligibleLineAmounts).some((value) => money(Number(value)) >= 0.01 && Number.isFinite(Number(value))),
  );
  const beneficiaryIdentityReady = beneficiaries.every((beneficiary) =>
    beneficiary.idNumber.trim().length > 0
      && beneficiary.beneficiaryName.trim().length > 0
      && beneficiary.beneficiaryAddress.trim().length > 0,
  );
  const discountAllocationReady = beneficiaries.length === 0 || (
    beneficiaryIdentityReady
      && uniqueBeneficiaryIds
      && beneficiaries.length <= effectiveGroupSize
      && eligibleLineAmountsValid
      && allBeneficiariesHaveEligibleLines
      && allocationsDoNotExceedLines
      && !(taxSettings?.vatRegistered && hasUnclassifiedCartItem)
  );
  const cashPaymentReady = cart.length > 0 && discountAllocationReady && cashReceivedAmount >= total;

  function addProduct(product: RestaurantProduct) {
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);
      if (existing) return current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { product, quantity: 1 }];
    });
    setBeneficiaries((current) => current.map((beneficiary) => {
      const eligibleLineAmounts = { ...beneficiary.eligibleLineAmounts };
      delete eligibleLineAmounts[product.id];
      return { ...beneficiary, eligibleLineAmounts };
    }));
    setSuccess('');
  }

  function changeQuantity(productId: string, amount: number) {
    setCart((current) => current.map((item) => item.product.id === productId ? { ...item, quantity: item.quantity + amount } : item).filter((item) => item.quantity > 0));
    setBeneficiaries((current) => current.map((beneficiary) => {
      const eligibleLineAmounts = { ...beneficiary.eligibleLineAmounts };
      delete eligibleLineAmounts[productId];
      return { ...beneficiary, eligibleLineAmounts };
    }));
  }

  function addBeneficiary(type: PosDiscountType) {
    if (beneficiaries.length >= effectiveGroupSize) return;
    setBeneficiaries((current) => [...current, { discountType: type, idType: defaultIdType(type), idNumber: '', beneficiaryName: '', beneficiaryTin: '', beneficiaryAddress: '', eligibleLineAmounts: {} }]);
  }

  function removeBeneficiary(index: number) {
    setBeneficiaries((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateBeneficiary(index: number, patch: Partial<DraftBeneficiary>) {
    setBeneficiaries((current) => current.map((beneficiary, itemIndex) => itemIndex === index ? { ...beneficiary, ...patch } : beneficiary));
  }

  function updateEligibleLineAmount(index: number, productId: string, amount: string) {
    setBeneficiaries((current) => current.map((beneficiary, itemIndex) => itemIndex === index
      ? { ...beneficiary, eligibleLineAmounts: { ...beneficiary.eligibleLineAmounts, [productId]: amount } }
      : beneficiary));
  }

  function getBeneficiaryPreviewAmounts(beneficiary: DraftBeneficiary) {
    let eligibleAmount = 0;
    let discount = 0;
    cart.forEach((item) => {
      const gross = money(Number(beneficiary.eligibleLineAmounts[item.product.id] || 0));
      if (gross <= 0) return;
      const net = priceHasIncludedVat && item.product.taxCategory === 'standard_rate'
        ? money(gross / (1 + vatRate / 100)
        ) : gross;
      eligibleAmount += net;
      discount += money(net * 0.20);
    });
    return { eligibleAmount: money(eligibleAmount), discountAmount: money(discount) };
  }

  function changeGroupSize(value: string) {
    if (value === '') {
      setGroupSize('');
      return;
    }
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
    if (!discountAllocationReady) {
      setError(taxSettings?.vatRegistered && hasUnclassifiedCartItem
        ? 'Review the tax category for every product before applying an SC/PWD discount.'
        : 'Complete each beneficiary’s details and assign eligible amounts from order lines. The combined amount assigned to any line cannot exceed that line total.');
      return;
    }
    if (cashReceivedAmount < total) {
      setError(`Money received must be at least ₱${total.toFixed(2)}.`);
      return;
    }
    const enteredCustomerName = customerName.trim();
    if ((orderType === 'delivery' || orderType === 'pickup') && selfOrderingEnabled) {
      setError('Pickup and Delivery are only available for restaurant packages without Self Ordering.');
      return;
    }
    if (orderType === 'delivery' && (!mobileNumber.trim() || !deliveryCity.trim() || !deliveryBarangay.trim() || !deliveryAddress.trim() || !selectedDeliveryLocation || !deliveryRouteQuote?.inRange || deliveryRouteLoading)) {
      setError('Enter the delivery contact and address, then select an in-range location on the map to calculate the delivery fee.');
      return;
    }
    if (!enteredCustomerName) {
      setError('Enter the customer name before placing the order.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Only a selected registered customer account can earn loyalty points.
      // If no registered account is selected, the order remains a guest order.
      const loyaltyCustomer = selectedCustomerId
        ? { customerId: selectedCustomerId, name: enteredCustomerName }
        : null;

      const created = await createOrder({
        restaurantId,
        customerName: enteredCustomerName,
        mobileNumber: orderType === 'delivery' ? mobileNumber.trim() : 'N/A',
        orderType,
        deliveryCity: orderType === 'delivery' ? deliveryCity.trim() : '',
        deliveryBarangay: orderType === 'delivery' ? deliveryBarangay.trim() : '',
        deliveryAddress: orderType === 'delivery' ? deliveryAddress.trim() : '',
        customerDeliveryAddress: orderType === 'delivery' ? deliveryAddress.trim() : undefined,
        customerDeliveryCity: orderType === 'delivery' ? deliveryCity.trim() : undefined,
        customerDeliveryBarangay: orderType === 'delivery' ? deliveryBarangay.trim() : undefined,
        customerDeliveryLatitude: orderType === 'delivery' ? (selectedDeliveryLocation?.latitude ?? undefined) : undefined,
        customerDeliveryLongitude: orderType === 'delivery' ? (selectedDeliveryLocation?.longitude ?? undefined) : undefined,
        customerDeliveryPlaceId: orderType === 'delivery' ? selectedDeliveryLocation?.placeId : undefined,
        deliveryQuoteId: orderType === 'delivery' ? deliveryRouteQuote?.quoteId : undefined,
        notes: notes.trim() || 'POS ORDER — cash collected by cashier.',
        paymentMethod: 'cash',
        items: cart.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
      });

      if (loyaltyCustomer) {
        await attachCustomerToOrder(created.orderId, loyaltyCustomer.customerId);
      }

      const financials = await applyPosGroupDiscounts(
        created.orderId,
        effectiveGroupSize,
        beneficiaries.map((beneficiary) => ({
          discountType: beneficiary.discountType,
          idType: beneficiary.idType,
          idNumber: beneficiary.idNumber,
          beneficiaryName: beneficiary.beneficiaryName,
          beneficiaryTin: beneficiary.beneficiaryTin,
          beneficiaryAddress: beneficiary.beneficiaryAddress,
          eligibleLines: Object.entries(beneficiary.eligibleLineAmounts)
            .map(([productId, value]) => ({ productId, eligibleAmount: Number(value) }))
            .filter((line) => Number.isFinite(line.eligibleAmount) && line.eligibleAmount > 0),
        })),
      );

      let loyaltyDiscountAmount = 0;
      if (redeemPoints && selectedCustomerId) {
        const redemption = await redeemLoyaltyReward(created.orderId, selectedCustomerId);
        loyaltyDiscountAmount = redemption.discountAmount;
      }

      await confirmPosCashPayment(created.orderId);
      window.dispatchEvent(new Event('restaurant-ordering-active-order-change'));

      setPrintOrder({
        orderNumber: created.orderNumber,
        customerName: enteredCustomerName,
        mobileNumber: orderType === 'delivery' ? mobileNumber.trim() : '',
        deliveryAddress: orderType === 'delivery' ? deliveryAddress.trim() : '',
        notes: notes.trim(),
        cashierName,
        orderType,
        createdAt: new Date().toISOString(),
        items: cart.map((item) => ({ ...item })),
        beneficiaries: beneficiaries.map((beneficiary) => {
          const saved = financials.beneficiaryBreakdown?.find((item) => item.idNumber === beneficiary.idNumber.trim());
          const preview = getBeneficiaryPreviewAmounts(beneficiary);
          return {
            ...beneficiary,
            eligibleAmount: saved?.eligibleAmount ?? preview.eligibleAmount,
            discountAmount: saved?.discountAmount ?? preview.discountAmount,
          };
        }),
        showTaxBreakdown: taxBreakdownVisible,
        financials: {
          ...financials,
          loyaltyDiscountAmount,
          total: Math.max(Number((financials.total - loyaltyDiscountAmount).toFixed(2)), 0),
        },
        deliveryFee: orderType === 'delivery' ? created.deliveryFee : 0,
        cashReceived: cashReceivedAmount,
        change,
      });

      setCart([]);
      clearDiscounts();
      setCustomerName('');
      setMobileNumber('');
      setDeliveryCity('');
      setDeliveryBarangay('');
      setDeliveryAddress('');
      setSelectedDeliveryLocation(null);
      setDeliveryRouteQuote(null);
      setSelectedCustomerId(null);
      setSelectedCustomerPoints(null);
      setRedeemPoints(false);
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
      setCashReceived('');
      setSuccess(orderType === 'delivery'
        ? `Delivery order ${created.orderNumber} was paid and sent to the kitchen workflow. It will appear in Dispatch when marked ready. Print preview opened.`
        : `Order ${created.orderNumber} was paid and sent directly to the kitchen. Print preview opened.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create POS order.');
    } finally {
      setSaving(false);
    }
  }

  const discountReady = discountAllocationReady;

  return (
    <section className="restaurant-page restaurant-pos-page">
      <div className="restaurant-pos-header">
        
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
                <button key={product.id} type="button" className={`restaurant-pos-product${product.isAvailable ? '' : ' is-sold-out'}`} onClick={() => addProduct(product)} disabled={!product.isAvailable} aria-label={product.isAvailable ? `Add ${product.name}` : `${product.name} is sold out`}>
                  <span className="restaurant-pos-product-image-wrap">
                    {product.imageUrl
                      ? <img className="restaurant-pos-product-image" src={product.imageUrl} alt="" loading="lazy" />
                      : <span className="restaurant-pos-product-image-placeholder" aria-hidden="true">{product.name.charAt(0).toUpperCase()}</span>}
                  </span>
                  <span className="restaurant-pos-product-name">{product.name}{!product.isAvailable && <small>Sold Out</small>}</span><strong>₱{product.price.toFixed(2)}</strong>
                </button>
              ))}
              {!visibleProducts.length && <div className="restaurant-pos-empty">No available products found.</div>}
            </div>
          )}
        </div>

        <aside className="restaurant-pos-cart">
          <div className="restaurant-pos-cart-header"><div><p className="eyebrow">{orderType === 'delivery' ? 'Delivery order' : 'Walk-in order'}</p><h2>Current Order</h2></div><strong>₱{total.toFixed(2)}</strong></div>

          <div className="restaurant-pos-customer-field">
            <label className="restaurant-pos-field">
              <span>Customer name</span>
              <input
                value={customerName}
                onFocus={() => setShowCustomerSuggestions(customerName.trim().length >= 2)}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                  setSelectedCustomerId(null);
                  setSelectedCustomerPoints(null);
                  setShowCustomerSuggestions(true);
                }}
                onBlur={() => window.setTimeout(() => setShowCustomerSuggestions(false), 150)}
                placeholder="Enter customer name"
                autoComplete="off"
                disabled={saving}
              />
            </label>
            {selectedCustomerId && selectedCustomerPoints !== null && (
              <div className="restaurant-pos-selected-customer-points">
                <span>Registered customer</span>
                <strong>{selectedCustomerPoints} points</strong>
              </div>
            )}
            {selectedCustomerId && selectedCustomerPoints !== null && loyaltyRedemption?.enabled && selectedCustomerPoints >= loyaltyRedemption.pointsRequired && (
              <label className="restaurant-pos-redeem-loyalty">
                <input
                  type="checkbox"
                  checked={redeemPoints}
                  disabled={saving}
                  onChange={(event) => setRedeemPoints(event.target.checked)}
                />
                <span>
                  <strong>Redeem {loyaltyRedemption.pointsRequired} points</strong>
                  <small>Apply ₱{loyaltyRedemption.discountAmount.toFixed(2)} off this order.</small>
                </span>
              </label>
            )}
            {showCustomerSuggestions && customerName.trim().length >= 2 && (
              <div className="restaurant-pos-customer-suggestions" role="listbox" aria-label="Customer suggestions">
                {customerSuggestionsLoading && <div className="restaurant-pos-customer-suggestion-status">Searching customers…</div>}
                {!customerSuggestionsLoading && customerSuggestions.map((customer) => (
                  <button
                    key={customer.customerId}
                    type="button"
                    className="restaurant-pos-customer-suggestion"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCustomerName(customer.name);
                      setSelectedCustomerId(customer.customerId);
                      setSelectedCustomerPoints(customer.pointsBalance);
                      setRedeemPoints(false);
                      setShowCustomerSuggestions(false);
                    }}
                  >
                    <span>
                      <strong>{customer.name}</strong>
                      <small>Registered account</small>
                    </span>
                    <em>{customer.pointsBalance} pts</em>
                  </button>
                ))}
                {!customerSuggestionsLoading && customerSuggestions.length === 0 && (
                  <div className="restaurant-pos-customer-suggestion-status">No registered customer found. This order will remain a guest order and earn 0 points.</div>
                )}
              </div>
            )}
          </div>

          <div className="restaurant-pos-type"><span>Order type</span><div>
            <button type="button" className={orderType === 'dine_in' ? 'is-active' : ''} onClick={() => setOrderType('dine_in')}>Dine-in</button>
            <button type="button" className={orderType === 'take_out' ? 'is-active' : ''} onClick={() => setOrderType('take_out')}>Take-out</button>
            {!selfOrderingEnabled && <button type="button" className={orderType === 'pickup' ? 'is-active' : ''} onClick={() => setOrderType('pickup')}>Pickup</button>}
            {!selfOrderingEnabled && <button type="button" className={orderType === 'delivery' ? 'is-active' : ''} onClick={() => setOrderType('delivery')}>Delivery</button>}
          </div></div>

          {orderType === 'delivery' && <section className="restaurant-pos-delivery-fields">
            <label className="restaurant-pos-field"><span>Customer phone number</span><input type="tel" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} disabled={saving} /></label>
            <label className="restaurant-pos-field"><span>City / Municipality</span><input value={deliveryCity} onChange={(event) => setDeliveryCity(event.target.value)} disabled={saving} /></label>
            <label className="restaurant-pos-field"><span>Barangay</span><input value={deliveryBarangay} onChange={(event) => setDeliveryBarangay(event.target.value)} disabled={saving} /></label>
            <label className="restaurant-pos-field"><span>Complete delivery address</span><textarea value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} rows={2} disabled={saving} /></label>
            <MapboxDeliveryLocationPicker disabled={saving} onSelect={async (selected) => {
              setSelectedDeliveryLocation(selected);
              setDeliveryCity(selected.city || '');
              setDeliveryBarangay(selected.barangay || '');
              setDeliveryAddress(selected.address || selected.formattedAddress || '');
              setDeliveryRouteQuote(null);
              if (selected.latitude == null || selected.longitude == null) return;
              setDeliveryRouteLoading(true);
              try {
                const quote = await calculateDeliveryRoute(restaurantId, selected.latitude, selected.longitude);
                setDeliveryRouteQuote(quote);
                if (!quote.inRange) setError('This delivery address is outside the restaurant delivery area.');
                else setError('');
              } catch (routeError) {
                setError(routeError instanceof Error ? routeError.message : 'Unable to calculate delivery fee.');
              } finally { setDeliveryRouteLoading(false); }
            }} />
            {deliveryRouteLoading && <p role="status">Calculating delivery fee…</p>}
            {deliveryRouteQuote?.inRange && <p className="restaurant-pos-delivery-fee">Delivery fee: ₱{deliveryRouteQuote.deliveryFee.toFixed(2)} · {(deliveryRouteQuote.distanceMeters / 1000).toFixed(1)} km</p>}
            {deliveryRouteQuote && !deliveryRouteQuote.inRange && <p role="alert">This address is outside the restaurant's delivery area.</p>}
          </section>}

          <div className="restaurant-pos-discount">
            <div className="restaurant-pos-discount-header"><strong>Senior / PWD Discount</strong><span>20%</span></div>
            <label className="restaurant-pos-field"><span>Number of customers</span><input type="number" min={1} value={groupSize} onChange={(event) => changeGroupSize(event.target.value)} disabled={saving} /></label>

            <div className="restaurant-pos-discount-types">
              <button type="button" onClick={() => addBeneficiary('senior')} disabled={saving || beneficiaries.length >= effectiveGroupSize}>+ Senior Citizen</button>
              <button type="button" onClick={() => addBeneficiary('pwd')} disabled={saving || beneficiaries.length >= effectiveGroupSize}>+ PWD</button>
            </div>

            {beneficiaries.map((beneficiary, index) => (
              <div className="restaurant-pos-beneficiary" key={index}>
                <div className="restaurant-pos-beneficiary-header">
                  <strong>{beneficiary.discountType === 'senior' ? 'Senior Citizen' : 'PWD'} #{index + 1}</strong>
                  <button type="button" onClick={() => removeBeneficiary(index)} disabled={saving}>Remove</button>
                </div>
                <label className="restaurant-pos-field"><span>Beneficiary full name *</span><input value={beneficiary.beneficiaryName} maxLength={250} autoComplete="name" onChange={(event) => updateBeneficiary(index, { beneficiaryName: event.target.value })} placeholder="Name as shown on ID" disabled={saving} required /></label>
                <label className="restaurant-pos-field"><span>Beneficiary address *</span><input value={beneficiary.beneficiaryAddress} maxLength={1000} autoComplete="street-address" onChange={(event) => updateBeneficiary(index, { beneficiaryAddress: event.target.value })} placeholder="Registered / residential address" disabled={saving} required /></label>
                <label className="restaurant-pos-field"><span>Beneficiary TIN (if applicable)</span><input value={beneficiary.beneficiaryTin} maxLength={64} autoComplete="off" onChange={(event) => updateBeneficiary(index, { beneficiaryTin: event.target.value })} placeholder="Enter TIN if provided / applicable" disabled={saving} /></label>
                <label className="restaurant-pos-field"><span>ID type</span><select value={beneficiary.idType} onChange={(event) => updateBeneficiary(index, { idType: event.target.value as PosDiscountIdType })} disabled={saving}>
                  {idOptions[beneficiary.discountType].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select></label>
                <label className="restaurant-pos-field"><span>ID number</span><input value={beneficiary.idNumber} onChange={(event) => updateBeneficiary(index, { idNumber: event.target.value })} placeholder="Enter ID number" disabled={saving} /></label>
                <div className="restaurant-pos-beneficiary-lines">
                  <strong>Eligible order lines for this beneficiary</strong>
                  {cart.length === 0 ? <p>Add order items first, then allocate the amount attributable to this person.</p> : cart.map((item) => {
                    const lineTotal = money(item.product.price * item.quantity);
                    const allocatedToOthers = beneficiaries.reduce((sum, other, otherIndex) => (
                      otherIndex === index ? sum : sum + Math.max(Number(other.eligibleLineAmounts[item.product.id]) || 0, 0)
                    ), 0);
                    const remainingForThisBeneficiary = money(Math.max(lineTotal - allocatedToOthers, 0));
                    const amount = beneficiary.eligibleLineAmounts[item.product.id] ?? '';
                    const itemUnclassified = !item.product.taxCategory;
                    return (
                      <label className="restaurant-pos-field" key={item.product.id}>
                        <span>{item.quantity} × {item.product.name} · line ₱{lineTotal.toFixed(2)}</span>
                        <input
                          type="number"
                          min="0"
                          max={remainingForThisBeneficiary}
                          step="0.01"
                          inputMode="decimal"
                          value={amount}
                          onChange={(event) => updateEligibleLineAmount(index, item.product.id, event.target.value)}
                          placeholder="Eligible amount (₱)"
                          disabled={saving || (Boolean(taxSettings?.vatRegistered) && itemUnclassified)}
                        />
                        {taxSettings?.vatRegistered && itemUnclassified && <small>Tax category must be reviewed before allocating this line.</small>}
                        <small>Remaining available on this line: ₱{remainingForThisBeneficiary.toFixed(2)}</small>
                      </label>
                    );
                  })}
                  <p>Assigned eligible amount: ₱{getBeneficiaryPreviewAmounts(beneficiary).eligibleAmount.toFixed(2)} · 20% discount preview: ₱{getBeneficiaryPreviewAmounts(beneficiary).discountAmount.toFixed(2)}</p>
                </div>
              </div>
            ))}

            {beneficiaries.length > 0 && <p className="restaurant-pos-discount-note">Enter only the portion of each order line attributable to this beneficiary under the applicable SC/PWD rules; do not assume equal group shares. Combined allocations cannot exceed the line total. VAT-registered restaurants must classify every item before applying the discount. One person may use either Senior Citizen or PWD benefit for a transaction, not both, and the cashier must verify the required ID.</p>}
            {beneficiaries.length > 0 && !discountAllocationReady && <p className="restaurant-pos-message is-error" role="alert">
              {taxSettings?.vatRegistered && hasUnclassifiedCartItem
                ? 'Review the tax category for every product before applying an SC/PWD discount.'
                : !beneficiaryIdentityReady
                  ? 'Enter every beneficiary’s full name, address, and ID number.'
                  : !uniqueBeneficiaryIds
                    ? 'Each beneficiary must use a different ID number for this order.'
                    : !eligibleLineAmountsValid
                      ? 'Eligible amounts must be valid, non-negative amounts with no more than two decimal places.'
                      : !allBeneficiariesHaveEligibleLines
                        ? 'Enter a positive eligible amount on at least one order line for each beneficiary.'
                        : !allocationsDoNotExceedLines
                        ? 'Combined eligible amounts cannot exceed the total for each order line.'
                        : 'Complete the required beneficiary and line-allocation details.'}
            </p>}
          </div>

          <label className="restaurant-pos-field restaurant-pos-notes-field">
             <span>Notes / Special instructions</span>
             <textarea
               value={notes}
               onChange={(event) => setNotes(event.target.value)}
               placeholder="e.g. No onions, less ice, pack separately"
               rows={3}
               maxLength={500}
               disabled={saving}
             />
           </label>

           <div className="restaurant-pos-cart-items">
            {cart.length === 0 ? <p>No items added yet.</p> : cart.map((item) => (
              <div className="restaurant-pos-cart-item" key={item.product.id}>
                <div><strong>{item.product.name}</strong><span>₱{item.product.price.toFixed(2)}</span></div>
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
            {orderType === 'delivery' && <div className="restaurant-pos-total"><span>Delivery fee</span><strong>₱{deliveryFee.toFixed(2)}</strong></div>}
            {taxBreakdownVisible && <div className="restaurant-pos-total"><span>VATable sales</span><strong>₱{vatableSales.toFixed(2)}</strong></div>}
            {taxBreakdownVisible && <div className="restaurant-pos-total"><span>VAT {taxSettings?.vatRate.toFixed(2)}%</span><strong>₱{vatAmount.toFixed(2)}</strong></div>}
            {beneficiaries.length > 0 && <>
              <div className="restaurant-pos-total"><span>Allocated eligible line amounts</span><strong>₱{allocatedEligibleGross.toFixed(2)}</strong></div>
              {taxBreakdownVisible && <div className="restaurant-pos-total"><span>VAT-exempt sales</span><strong>₱{vatExemptSales.toFixed(2)}</strong></div>}
              <div className="restaurant-pos-total restaurant-pos-discount-total"><span>Senior / PWD Discount</span><strong>-₱{discountAmount.toFixed(2)}</strong></div>
            </>}
            {redeemPoints && loyaltyDiscountPreview > 0 && <div className="restaurant-pos-total restaurant-pos-discount-total"><span>Loyalty Discount</span><strong>-₱{loyaltyDiscountPreview.toFixed(2)}</strong></div>}
            <div className="restaurant-pos-total restaurant-pos-grand-total"><span>Total</span><strong>₱{total.toFixed(2)}</strong></div>
          </div>

          <div className="restaurant-pos-cash-payment">
            <label className="restaurant-pos-field">
              <span>Money received</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={cashReceived}
                onChange={(event) => setCashReceived(event.target.value)}
                onWheel={(event) => {
                  event.currentTarget.blur();
                }}
                placeholder="0.00"
                disabled={saving}
              />
            </label>
            <div className="restaurant-pos-cash-change">
              <span>Change</span>
              <strong>₱{change.toFixed(2)}</strong>
            </div>
            {cart.length > 0 && cashReceivedAmount < total && (
              <p className="restaurant-pos-cash-warning">Amount received must be at least ₱{total.toFixed(2)}.</p>
            )}
          </div>

          {taxSettings && <p className="restaurant-pos-tax-status">{taxSettings.vatRegistered ? `VAT registered · ${taxSettings.vatRate.toFixed(2)}%${taxSettings.pricesVatInclusive ? ' · prices VAT-inclusive' : ' · prices VAT-exclusive'}` : 'Non-VAT registered'}</p>}
          <button className="button button-primary restaurant-pos-submit" type="button" disabled={!cart.length || saving || !discountReady || !taxSettings || !cashPaymentReady || (orderType === 'delivery' && (!mobileNumber.trim() || !deliveryCity.trim() || !deliveryBarangay.trim() || !deliveryAddress.trim() || !selectedDeliveryLocation || !deliveryRouteQuote?.inRange || deliveryRouteLoading))} onClick={() => void placeOrder()}>
            {saving ? 'Creating Order…' : orderType === 'delivery' ? 'Cash Paid — Create Delivery Order' : 'Cash Paid — Send to Kitchen'}
          </button>
        </aside>
      </div>

      {printOrder && (
        <div className="restaurant-pos-print-area" aria-hidden="true">
          <div className="restaurant-pos-print-receipt restaurant-pos-kitchen-receipt">
            <div className="pos-receipt-center">
              <div className="pos-receipt-title">KITCHEN ORDER</div>
              <div className="pos-receipt-order-number">{printOrder.orderNumber}</div>
              <div className="pos-receipt-muted">{new Date(printOrder.createdAt).toLocaleString()}</div>
            </div>
            <hr className="pos-receipt-divider" />
            <div className="pos-receipt-center">
              <div className="pos-receipt-label">
                {printOrder.orderType === 'dine_in' ? 'DINE-IN' : printOrder.orderType === 'delivery' ? 'DELIVERY' : printOrder.orderType === 'pickup' ? 'PICKUP' : 'TAKE-OUT'}
              </div>
              <div>{printOrder.customerName}</div>
              {printOrder.orderType === 'delivery' && <>
                <div>{printOrder.mobileNumber}</div>
                <div>{printOrder.deliveryAddress}</div>
              </>}
            </div>
            <hr className="pos-receipt-divider" />
            {printOrder.notes && (
              <>
                <div className="pos-receipt-label">Special instructions</div>
                <div>{printOrder.notes}</div>
                <hr className="pos-receipt-divider" />
              </>
            )}
            <div>
              {printOrder.items.map((item) => (
                <div className="pos-receipt-kitchen-item" key={item.product.id}>
                  <strong>{item.quantity} ×</strong>
                  <span>{item.product.name}</span>
                </div>
              ))}
            </div>
            <hr className="pos-receipt-divider" />
            <div className="pos-receipt-center">Prepare this order.</div>
          </div>

          <div className="restaurant-pos-print-receipt restaurant-pos-customer-receipt">
            <div className="pos-receipt-center">
              <div className="pos-receipt-title">CUSTOMER RECEIPT</div>
              <div className="pos-receipt-muted">Operational receipt — not a BIR-issued invoice</div>
              <div className="pos-receipt-order-number">{printOrder.orderNumber}</div>
              <div className="pos-receipt-muted">{new Date(printOrder.createdAt).toLocaleString()}</div>
            </div>
            <hr className="pos-receipt-divider" />
            <div className="pos-receipt-center">
              <div className="pos-receipt-label">
                {printOrder.orderType === 'dine_in' ? 'DINE-IN' : printOrder.orderType === 'delivery' ? 'DELIVERY' : printOrder.orderType === 'pickup' ? 'PICKUP' : 'TAKE-OUT'}
              </div>
              <div>Cash • Paid</div>
            </div>
            <hr className="pos-receipt-divider" />
            <div>
              <div className="pos-receipt-label">Customer</div>
              <div>{printOrder.customerName}</div>
              {printOrder.orderType === 'delivery' && <>
                <div>{printOrder.mobileNumber}</div>
                <div>{printOrder.deliveryAddress}</div>
              </>}
            </div>
            <div className="pos-receipt-row"><span>Cashier</span><span>{printOrder.cashierName}</span></div>
            <hr className="pos-receipt-divider" />
            {printOrder.notes && (
              <>
                <div className="pos-receipt-label">Special instructions</div>
                <div>{printOrder.notes}</div>
                <hr className="pos-receipt-divider" />
              </>
            )}
            <div>
              {printOrder.items.map((item) => (
                <div className="pos-receipt-row" key={item.product.id}>
                  <span>{item.quantity} × {item.product.name}</span>
                  <span>₱{(item.product.price * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <hr className="pos-receipt-divider" />
            {printOrder.financials.grossSales > 0 && printOrder.showTaxBreakdown ? (
              <>
                <div className="pos-receipt-row"><span>Gross sales</span><span>₱{printOrder.financials.grossSales.toFixed(2)}</span></div>
                <div className="pos-receipt-row"><span>VATable sales</span><span>₱{printOrder.financials.vatableSales.toFixed(2)}</span></div>
                {printOrder.financials.vatAmount > 0 && <div className="pos-receipt-row"><span>VAT {taxSettings.vatRate.toFixed(2)}%</span><span>₱{printOrder.financials.vatAmount.toFixed(2)}</span></div>}
                {printOrder.financials.vatExemptSales > 0 && <div className="pos-receipt-row"><span>VAT-exempt sales</span><span>₱{printOrder.financials.vatExemptSales.toFixed(2)}</span></div>}
              </>
            ) : (
              <div className="pos-receipt-row"><span>Subtotal</span><span>₱{printOrder.financials.grossSales.toFixed(2)}</span></div>
            )}
            {printOrder.financials.discountAmount > 0 && <div className="pos-receipt-row"><span>SC/PWD discount</span><span>-₱{printOrder.financials.discountAmount.toFixed(2)}</span></div>}
            {printOrder.financials.loyaltyDiscountAmount > 0 && <div className="pos-receipt-row"><span>Loyalty Discount</span><span>-₱{printOrder.financials.loyaltyDiscountAmount.toFixed(2)}</span></div>}
            {printOrder.deliveryFee > 0 && <div className="pos-receipt-row"><span>Delivery fee</span><span>₱{printOrder.deliveryFee.toFixed(2)}</span></div>}
            <div className="pos-receipt-row pos-receipt-total">
              <span>TOTAL</span>
              <span>₱{printOrder.financials.total.toFixed(2)}</span>
            </div>
            <div className="pos-receipt-row"><span>Cash received</span><span>₱{printOrder.cashReceived.toFixed(2)}</span></div>
            <div className="pos-receipt-row"><span>Change</span><span>₱{printOrder.change.toFixed(2)}</span></div>
            {printOrder.beneficiaries.length > 0 && (
              <>
                <hr className="pos-receipt-divider" />
                <div className="pos-receipt-label">SC/PWD DETAILS</div>
                {printOrder.beneficiaries.map((beneficiary, index) => (
                  <div key={index} className="pos-receipt-discount-detail">
                    <div>{beneficiary.discountType.toUpperCase()} BENEFICIARY: {beneficiary.beneficiaryName}</div>
                    <div>Address: {beneficiary.beneficiaryAddress}</div>
                    {beneficiary.beneficiaryTin.trim() && <div>TIN: {beneficiary.beneficiaryTin}</div>}
                    <div>{beneficiary.idType.replaceAll('_', ' ').toUpperCase()}: {beneficiary.idNumber}</div>
                    {Object.entries(beneficiary.eligibleLineAmounts).filter(([, value]) => Number(value) > 0).map(([productId, value]) => {
                      const item = printOrder.items.find((candidate) => candidate.product.id === productId);
                      return item ? <div key={productId}>{item.product.name}: ₱{Number(value).toFixed(2)} eligible at menu price</div> : null;
                    })}
                    <div>Eligible net amount: ₱{beneficiary.eligibleAmount.toFixed(2)} · Discount: ₱{beneficiary.discountAmount.toFixed(2)}</div>
                  </div>
                ))}
                <div className="pos-receipt-signature">Customer signature: ____________________</div>
              </>
            )}
            <hr className="pos-receipt-divider" />
            <div className="pos-receipt-center">Thank you for your order!</div>
          </div>
        </div>
      )}
    </section>
  );
}
