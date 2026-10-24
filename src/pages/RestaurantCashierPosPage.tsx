import { useEffect, useMemo, useState } from 'react';
import { getMenu, subscribeToCashierMenuChanges } from '../modules/products/productService';
import { createOrder } from '../modules/ordering/orderService';
import { applyPosGroupDiscounts, confirmPosCashPayment, getPosOrderReceiptSnapshot, getCurrentCashierName, getRestaurantTaxSettings, type PosDiscountIdType, type PosDiscountType, type RestaurantTaxSettings, type PosOrderReceiptSnapshot } from '../modules/pos/posService';
import { allocatePosEqualGroupShares, calculatePosStatutoryDiscountPreview } from '../modules/pos/statutoryDiscountCalculations';
import { OperationalCustomerReceipt } from '../components/OperationalCustomerReceipt';
import type { RestaurantProduct } from '../types/menu';
import { MapboxDeliveryLocationPicker, type MapboxDeliveryAddress } from '../components/MapboxDeliveryLocationPicker';
import { calculateDeliveryRoute, type DeliveryRouteQuote } from '../modules/location/locationService';
import { supabase } from '../services/supabaseClient';
import { attachCustomerToOrder, findCustomersByName, getLoyaltyRedemptionSettings, redeemLoyaltyReward, type LoyaltyCustomerSuggestion, type LoyaltyRedemptionSettings } from '../modules/loyalty/loyaltyService';

type Props = { restaurantId: string };
type CartItem = { product: RestaurantProduct; quantity: number };
type DraftBeneficiary = { discountType: PosDiscountType; idType: PosDiscountIdType; idNumber: string; beneficiaryName: string; beneficiaryTin: string; beneficiaryAddress: string };
type PrintedBeneficiary = DraftBeneficiary & { eligibleGrossAmount: number; eligibleAmount: number; discountAmount: number; groupSize?: number | null };
type PosPrintOrder = {
  orderNumber: string;
  customerName: string;
  mobileNumber: string;
  deliveryAddress: string;
  notes: string;
  cashierName: string;
  orderType: 'dine_in' | 'take_out' | 'pickup' | 'delivery';
  customerCount: number;
  createdAt: string;
  items: CartItem[];
  receiptSnapshot: PosOrderReceiptSnapshot | null;
  beneficiaries: PrintedBeneficiary[];
  receiptOtherDiscountAmount: number;
  showTaxBreakdown: boolean;
  vatRate: number;
  financials: {
    discountAmount: number;
    loyaltyDiscountAmount: number;
    grossSales: number;
    vatableSales: number;
    vatAmount: number;
    vatExemptSales: number;
    zeroRatedSales: number;
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
  const groupSizeValid = groupSize !== '' && Number.isInteger(Number(groupSize)) && Number(groupSize) >= 1;
  const effectiveGroupSize = groupSizeValid ? Math.floor(Number(groupSize)) : 1;
  const priceHasIncludedVat = Boolean(taxSettings?.vatRegistered && taxSettings.pricesVatInclusive);
  const vatRate = taxSettings?.vatRegistered ? taxSettings.vatRate : 0;
  const hasUnclassifiedCartItem = cart.some((item) => !item.product.taxCategory);
  const hasTaxCategoryRouteMismatch = Boolean(taxSettings && cart.some((item) => {
    const category = item.product.taxCategory;
    if (!category) return false;
    return taxSettings.vatRegistered
      ? category === 'percentage_taxable' || category === 'non_vat_exempt'
      : category === 'standard_rate' || category === 'vat_exempt' || category === 'zero_rated';
  }));
  const cartTaxBreakdownReady = cart.length > 0 && !hasUnclassifiedCartItem && !hasTaxCategoryRouteMismatch;
  const deliveryFee = orderType === 'delivery' && deliveryRouteQuote?.inRange ? deliveryRouteQuote.deliveryFee : 0;
  const taxBreakdownVisible = Boolean(
    taxSettings?.vatRegistered
    && taxSettings.pricesVatInclusive
    && cartTaxBreakdownReady
    && beneficiaries.length === 0
    && deliveryFee === 0
    && !(redeemPoints && selectedCustomerId)
  );
  const taxLines = cart.map((item) => ({
    productId: item.product.id,
    lineTotal: money(item.product.price * item.quantity),
    taxCategory: item.product.taxCategory ?? null,
  }));
  const beneficiaryLineAllocations = allocatePosEqualGroupShares(
    taxLines,
    effectiveGroupSize,
    beneficiaries.length,
  );
  const allocationInputs = beneficiaryLineAllocations.flat();
  const statutoryPreview = calculatePosStatutoryDiscountPreview({
    lines: taxLines,
    allocations: allocationInputs,
    subtotal,
    deliveryFee,
    vatRegistered: Boolean(taxSettings?.vatRegistered),
    pricesVatInclusive: priceHasIncludedVat,
    vatRate,
  });
  const discountAmount = statutoryPreview.discountAmount;
  const allocatedEligibleGross = statutoryPreview.allocatedEligibleGross;
  const vatableSales = statutoryPreview.vatableSales;
  const vatAmount = statutoryPreview.vatAmount;
  const vatExemptSales = statutoryPreview.vatExemptSales;
  const preLoyaltyTotal = statutoryPreview.preLoyaltyTotal;
  const loyaltyDiscountPreview = beneficiaries.length === 0 && redeemPoints && selectedCustomerId && loyaltyRedemption?.enabled
    ? Math.min(money(loyaltyRedemption.discountAmount), preLoyaltyTotal)
    : 0;
  const total = Math.max(money(statutoryPreview.totalWithDeliveryFee - loyaltyDiscountPreview), 0);
  const cashReceivedAmount = Number(cashReceived) || 0;
  const change = Math.max(money(cashReceivedAmount - total), 0);
  const uniqueBeneficiaryIds = new Set(beneficiaries.map((beneficiary) => beneficiary.idNumber.trim()).filter(Boolean)).size === beneficiaries.filter((beneficiary) => beneficiary.idNumber.trim()).length;
  const allBeneficiariesHaveEligibleLines = beneficiaries.length === 0
    || (beneficiaryLineAllocations.length === beneficiaries.length
      && beneficiaryLineAllocations.every((allocations) => allocations.length > 0));
  const beneficiaryIdentityReady = beneficiaries.every((beneficiary) =>
    beneficiary.idNumber.trim().length > 0
      && beneficiary.beneficiaryName.trim().length > 0
      && beneficiary.beneficiaryAddress.trim().length > 0,
  );
  // Never allow a POS checkout to proceed when a product tax category conflicts
  // with the tenant's stored VAT-registration route. This applies even with no discounts.
  const discountAllocationReady = !hasTaxCategoryRouteMismatch
    && !(beneficiaries.length > 0 && redeemPoints)
    && (beneficiaries.length === 0 || (
    groupSizeValid
      && beneficiaryIdentityReady
      && uniqueBeneficiaryIds
      && beneficiaries.length <= effectiveGroupSize
      && allBeneficiariesHaveEligibleLines
      && !(hasTaxCategoryRouteMismatch || (taxSettings?.vatRegistered && hasUnclassifiedCartItem))
  ));
  const cashPaymentReady = cart.length > 0 && discountAllocationReady && cashReceivedAmount >= total;

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
    if (beneficiaries.length >= effectiveGroupSize) return;
    // Statutory SC/PWD discount and loyalty redemption are mutually exclusive.
    setRedeemPoints(false);
    setBeneficiaries((current) => [...current, { discountType: type, idType: defaultIdType(type), idNumber: '', beneficiaryName: '', beneficiaryTin: '', beneficiaryAddress: '' }]);
  }

  function removeBeneficiary(index: number) {
    setBeneficiaries((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateBeneficiary(index: number, patch: Partial<DraftBeneficiary>) {
    setBeneficiaries((current) => current.map((beneficiary, itemIndex) => itemIndex === index ? { ...beneficiary, ...patch } : beneficiary));
  }

  function getBeneficiaryPreviewAmounts(beneficiaryIndex: number) {
    const allocations = beneficiaryLineAllocations[beneficiaryIndex] ?? [];
    const preview = calculatePosStatutoryDiscountPreview({
      lines: taxLines,
      allocations,
      subtotal,
      vatRegistered: Boolean(taxSettings?.vatRegistered),
      pricesVatInclusive: priceHasIncludedVat,
      vatRate,
    });
    return {
      eligibleGrossAmount: money(allocations.reduce((sum, allocation) => sum + allocation.eligibleGross, 0)),
      eligibleAmount: money(preview.allocations.reduce((sum, allocation) => sum + allocation.eligibleNet, 0)),
      discountAmount: preview.discountAmount,
    };
  }

  function changeGroupSize(value: string) {
    if (value === '') {
      setGroupSize('');
      return;
    }
    const nextSize = Math.max(Math.floor(Number(value) || 1), 1);
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
      setError(hasTaxCategoryRouteMismatch
        ? 'A product tax category does not match this restaurant’s stored VAT registration. Review the category before applying an SC/PWD discount.'
        : taxSettings?.vatRegistered && hasUnclassifiedCartItem
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
        beneficiaries.map((beneficiary, index) => ({
          discountType: beneficiary.discountType,
          idType: beneficiary.idType,
          idNumber: beneficiary.idNumber,
          beneficiaryName: beneficiary.beneficiaryName,
          beneficiaryTin: beneficiary.beneficiaryTin,
          beneficiaryAddress: beneficiary.beneficiaryAddress,
          eligibleLines: (beneficiaryLineAllocations[index] ?? []).map((line) => ({
            productId: line.productId,
            eligibleAmount: line.eligibleGross,
          })),
        })),
      );

      let loyaltyDiscountAmount = 0;
      if (redeemPoints && selectedCustomerId) {
        const redemption = await redeemLoyaltyReward(created.orderId, selectedCustomerId);
        loyaltyDiscountAmount = redemption.discountAmount;
      }

      await confirmPosCashPayment(created.orderId);

      // Use the persisted receipt snapshot for customer-facing print values. If it
      // cannot be loaded, retain an operational fallback, but never show client-side
      // tax previews as final VAT values.
      let receiptSnapshot: PosOrderReceiptSnapshot | null = null;
      try {
        receiptSnapshot = await getPosOrderReceiptSnapshot(created.orderId);
      } catch (snapshotError) {
        console.error('Unable to load the persisted POS receipt snapshot.', snapshotError);
      }
      const finalizedVatBreakdownReady = receiptSnapshot?.tax_snapshot_status === 'calculated'
        && receiptSnapshot.tax_vat_registered
        && Number(receiptSnapshot.tax_gross_sales ?? 0) > 0
        && receiptSnapshot.tax_zero_rated_sales != null
        && receiptSnapshot.tax_snapshot_version != null;
      const persistedSubtotal = Number(receiptSnapshot?.subtotal ?? created.subtotal);
      const persistedDiscountTotal = Number(receiptSnapshot?.discount_amount ?? (financials.discountAmount + loyaltyDiscountAmount));
      const persistedLoyaltyDiscount = Number(receiptSnapshot?.loyalty_discount_amount ?? loyaltyDiscountAmount);
      const persistedBeneficiaryCount = Number(receiptSnapshot?.discount_beneficiary_count ?? beneficiaries.length);
      const persistedStatutoryDiscount = persistedBeneficiaryCount > 0
        ? Math.max(persistedDiscountTotal - persistedLoyaltyDiscount, 0)
        : 0;
      const persistedOtherDiscount = Math.max(
        persistedDiscountTotal - persistedLoyaltyDiscount - persistedStatutoryDiscount,
        0,
      );
      const persistedTotal = Number(receiptSnapshot?.total ?? financials.total);
      const receiptFinancials = {
        ...financials,
        discountAmount: persistedStatutoryDiscount,
        loyaltyDiscountAmount: persistedLoyaltyDiscount,
        grossSales: finalizedVatBreakdownReady
          ? Number(receiptSnapshot?.tax_gross_sales ?? 0)
          : persistedSubtotal,
        vatableSales: finalizedVatBreakdownReady ? Number(receiptSnapshot?.tax_vatable_sales ?? 0) : 0,
        vatAmount: finalizedVatBreakdownReady ? Number(receiptSnapshot?.tax_vat_amount ?? 0) : 0,
        vatExemptSales: finalizedVatBreakdownReady ? Number(receiptSnapshot?.tax_vat_exempt_sales ?? 0) : 0,
        zeroRatedSales: finalizedVatBreakdownReady ? Number(receiptSnapshot?.tax_zero_rated_sales ?? 0) : 0,
        netSales: Number(receiptSnapshot?.tax_net_sales ?? persistedSubtotal),
        total: persistedTotal,
      };
      window.dispatchEvent(new Event('restaurant-ordering-active-order-change'));

      const snapshotBeneficiaries: PrintedBeneficiary[] = (receiptSnapshot?.beneficiaries ?? []).map((beneficiary) => ({
        discountType: (beneficiary.discountType === 'pwd' ? 'pwd' : 'senior') as PosDiscountType,
        idType: (beneficiary.idType || 'other_government_id') as PosDiscountIdType,
        idNumber: beneficiary.idNumber,
        beneficiaryName: beneficiary.beneficiaryName ?? '',
        beneficiaryTin: beneficiary.beneficiaryTin ?? '',
        beneficiaryAddress: beneficiary.beneficiaryAddress ?? '',
        eligibleGrossAmount: Number(beneficiary.eligibleGrossAmount ?? 0),
        eligibleAmount: Number(beneficiary.eligibleAmount ?? 0),
        discountAmount: Number(beneficiary.discountAmount ?? 0),
        groupSize: Number(beneficiary.groupSize ?? receiptSnapshot?.discount_group_size ?? effectiveGroupSize),
      }));
      const fallbackBeneficiaries: PrintedBeneficiary[] = beneficiaries.map((beneficiary, index) => {
        const saved = financials.beneficiaryBreakdown?.find((item) => item.idNumber === beneficiary.idNumber.trim());
        const preview = getBeneficiaryPreviewAmounts(index);
        return {
          ...beneficiary,
          eligibleGrossAmount: preview.eligibleGrossAmount,
          eligibleAmount: saved?.eligibleAmount ?? preview.eligibleAmount,
          discountAmount: saved?.discountAmount ?? preview.discountAmount,
          groupSize: effectiveGroupSize,
        };
      });

      setPrintOrder({
        orderNumber: receiptSnapshot?.order_number ?? created.orderNumber,
        customerName: receiptSnapshot?.customer_name ?? enteredCustomerName,
        mobileNumber: receiptSnapshot?.mobile_number ?? (orderType === 'delivery' ? mobileNumber.trim() : ''),
        deliveryAddress: receiptSnapshot?.delivery_address ?? (orderType === 'delivery' ? deliveryAddress.trim() : ''),
        notes: receiptSnapshot?.notes ?? notes.trim(),
        cashierName: receiptSnapshot?.cashier_name ?? cashierName,
        orderType: receiptSnapshot?.order_type ?? orderType,
        customerCount: Number(receiptSnapshot?.discount_group_size ?? effectiveGroupSize),
        createdAt: receiptSnapshot?.created_at ?? new Date().toISOString(),
        items: cart.map((item) => ({ ...item })),
        receiptSnapshot,
        beneficiaries: receiptSnapshot ? snapshotBeneficiaries : fallbackBeneficiaries,
        receiptOtherDiscountAmount: persistedOtherDiscount,
        showTaxBreakdown: finalizedVatBreakdownReady,
        vatRate: finalizedVatBreakdownReady ? Number(receiptSnapshot?.tax_vat_rate ?? 0) : taxSettings?.vatRate ?? 0,
        financials: {
          ...receiptFinancials,
        },
        deliveryFee: Number(receiptSnapshot?.delivery_fee ?? (orderType === 'delivery' ? created.deliveryFee : 0)),
        cashReceived: cashReceivedAmount,
        change: Math.max(Number((cashReceivedAmount - persistedTotal).toFixed(2)), 0),
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
                  disabled={saving || beneficiaries.length > 0}
                  onChange={(event) => setRedeemPoints(event.target.checked)}
                />
                <span>
                  <strong>Redeem {loyaltyRedemption.pointsRequired} points</strong>
                  <small>{beneficiaries.length > 0
                    ? 'Not available with a Senior Citizen / PWD statutory discount. Remove the beneficiary first to redeem points.'
                    : `Apply ₱${loyaltyRedemption.discountAmount.toFixed(2)} off this order.`}</small>
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
            <label className="restaurant-pos-field"><span>Number of customers</span><input type="number" min={1} step={1} value={groupSize} onChange={(event) => changeGroupSize(event.target.value)} disabled={saving} /></label>

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
                  <strong>Automatic group-share calculation</strong>
                  <p>Food subtotal: ₱{money(subtotal).toFixed(2)} ÷ {effectiveGroupSize} {effectiveGroupSize === 1 ? 'customer' : 'customers'}</p>
                  <p>Personal food share: ₱{getBeneficiaryPreviewAmounts(index).eligibleGrossAmount.toFixed(2)}</p>
                  <p>20% discount preview: ₱{getBeneficiaryPreviewAmounts(index).discountAmount.toFixed(2)}</p>
                  <small>Calculated automatically. No amount entry is needed for individual products. Delivery fees are not included in the food share.</small>
                </div>
              </div>
            ))}

            {beneficiaries.length > 0 && <p className="restaurant-pos-discount-note">The food subtotal is split across the entered customer count. Only a verified Senior Citizen or PWD beneficiary’s allocated share receives the 20% discount. VAT-registered restaurants must classify every item before applying the discount; confirm the group-share method is appropriate for the transaction and verify the required ID.</p>}
            {beneficiaries.length > 0 && !discountAllocationReady && <p className="restaurant-pos-message is-error" role="alert">
              {!groupSizeValid
                ? 'Enter a valid whole number of customers.'
                : hasTaxCategoryRouteMismatch
                  ? 'A product tax category does not match this restaurant’s stored VAT registration; review the category before applying the discount.'
                  : taxSettings?.vatRegistered && hasUnclassifiedCartItem
                    ? 'Review the tax category for every product before applying an SC/PWD discount.'
                    : !beneficiaryIdentityReady
                    ? 'Enter every beneficiary’s full name, address, and ID number.'
                    : !uniqueBeneficiaryIds
                      ? 'Each beneficiary must use a different ID number for this order.'
                      : !allBeneficiariesHaveEligibleLines
                        ? 'There is no positive order-line share to allocate to every listed beneficiary. Check the customer count and order total.'
                        : 'Complete the required beneficiary details.'}
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
              <div className="restaurant-pos-total"><span>Eligible food share(s)</span><strong>₱{allocatedEligibleGross.toFixed(2)}</strong></div>
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

          <OperationalCustomerReceipt
            orderNumber={printOrder.orderNumber}
            createdAt={printOrder.createdAt}
            orderType={printOrder.orderType}
            paymentLabel="Cash • Paid"
            customerName={printOrder.customerName}
            mobileNumber={printOrder.mobileNumber}
            deliveryAddress={printOrder.deliveryAddress}
            cashierName={printOrder.cashierName}
            notes={printOrder.notes}
            items={printOrder.receiptSnapshot
              ? printOrder.receiptSnapshot.items.map((item) => ({
                id: item.id,
                name: item.name,
                quantity: Number(item.quantity),
                lineTotal: Number(item.lineTotal),
              }))
              : printOrder.items.map((item) => ({
                id: item.product.id,
                name: item.product.name,
                quantity: item.quantity,
                lineTotal: item.product.price * item.quantity,
              }))}
            grossSales={printOrder.financials.grossSales}
            showTaxBreakdown={printOrder.showTaxBreakdown}
            vatableSales={printOrder.financials.vatableSales}
            vatAmount={printOrder.financials.vatAmount}
            vatExemptSales={printOrder.financials.vatExemptSales}
            zeroRatedSales={printOrder.financials.zeroRatedSales}
            vatRate={printOrder.vatRate}
            discountAmount={printOrder.financials.discountAmount}
            otherDiscountAmount={printOrder.receiptOtherDiscountAmount}
            loyaltyDiscountAmount={printOrder.financials.loyaltyDiscountAmount}
            deliveryFee={printOrder.deliveryFee}
            total={printOrder.financials.total}
            cashReceived={printOrder.cashReceived}
            change={printOrder.change}
            beneficiaries={printOrder.beneficiaries.map((beneficiary) => ({
              discountType: beneficiary.discountType,
              idType: beneficiary.idType,
              idNumber: beneficiary.idNumber,
              beneficiaryName: beneficiary.beneficiaryName,
              beneficiaryAddress: beneficiary.beneficiaryAddress,
              beneficiaryTin: beneficiary.beneficiaryTin,
              groupSize: beneficiary.groupSize ?? printOrder.customerCount,
              eligibleGrossAmount: beneficiary.eligibleGrossAmount,
              eligibleAmount: beneficiary.eligibleAmount,
              discountAmount: beneficiary.discountAmount,
            }))}
          />
        </div>
      )}
    </section>
  );
}
