import { useEffect, useMemo, useState } from 'react';
import type { RestaurantProduct } from '../types/menu';
import { createOrder } from '../services/orderRepository';
import { createPendingOnlinePayment, getOnlinePaymentStatus } from '../services/onlinePaymentRepository';
import { createPayMongoCheckout } from '../services/paymongoRepository';
import { getRestaurantDeliveryZones, type RestaurantDeliveryZone } from '../services/restaurantSettingsRepository';
import { attachCustomerToOrder, getLoyaltyRedemptionSettings, getMyCustomerProfile, getMyCustomerProfileId, getMyLoyaltyPoints, redeemLoyaltyReward, saveMyDefaultDeliveryAddress } from '../services/loyaltyRepository';
import { useRestaurantOwnerAuth } from '../components/RestaurantOwnerAuthProvider';
import { useRestaurant } from '../components/RestaurantProvider';
import { supabase } from '../services/supabaseClient';
import { OrderConfirmationPage } from './OrderConfirmationPage';
import '../styles/checkout-mobile.css';

type CartItem = { product: RestaurantProduct; quantity: number };
type OrderType = 'delivery' | 'pickup' | 'dine_in';
type PaymentMethod = 'cash' | 'online';
type CheckoutPageProps = { items: CartItem[] };
type ConfirmedOrder = { orderNumber: string; paymentMethod: PaymentMethod; orderType: OrderType; total: number };
const PENDING_PAYMENT_CHECKOUT_URL_KEY = 'restaurant-ordering-pending-payment-checkout-url';
const ACTIVE_ORDER_KEY = 'restaurant-ordering-active-order';
const PENDING_PAYMENT_REFERENCE_KEY = 'restaurant-ordering-pending-payment-reference';

const orderTypes: Array<{ value: OrderType; label: string; description: string }> = [
  { value: 'delivery', label: 'Delivery', description: 'Have the restaurant deliver your order.' },
  { value: 'pickup', label: 'Pickup', description: 'Collect your order from the restaurant. This includes take-out.' },
  { value: 'dine_in', label: 'Dine-in', description: 'Order from your phone while eating at the restaurant.' },
];

const paymentMethods: Array<{ value: PaymentMethod; label: string; description: string }> = [
  { value: 'cash', label: 'Cash', description: 'Pay in cash when your order is received or collected.' },
  { value: 'online', label: 'Online Payment', description: 'Pay securely through our online payment gateway.' },
];

const outsideDeliveryAreaMessage = 'This address is outside the store delivery area. You can still order by choosing your own courier to pick up the order from the restaurant.';
const PENDING_PAYMENT_ORDER_KEY = 'restaurant-ordering-pending-payment-order';
const CART_CLEAR_EVENT = 'restaurant-ordering-cart-clear';
const thirdPartyCourierNote = 'THIRD-PARTY COURIER: Customer is responsible for booking and paying the delivery courier (such as Lalamove or Grab Express). The restaurant will prepare the food for courier pickup at the listed restaurant pickup point.';

function normalize(value: string) { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }

export function CheckoutPage({ items }: CheckoutPageProps) {
  const restaurant = useRestaurant();
  const { user } = useRestaurantOwnerAuth();
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [customerProfileLoading, setCustomerProfileLoading] = useState(false);
  const [customerProfileError, setCustomerProfileError] = useState('');
  const [hasDefaultAddress, setHasDefaultAddress] = useState(false);
  const [deliveryCity, setDeliveryCity] = useState('');
  const [address, setAddress] = useState('');
  const [deliveryBarangay, setDeliveryBarangay] = useState('');
  const [deliveryZones, setDeliveryZones] = useState<RestaurantDeliveryZone[]>([]);
  const [loadingDeliveryZones, setLoadingDeliveryZones] = useState(false);
  const [deliveryZonesError, setDeliveryZonesError] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [showPayment, setShowPayment] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showDeliveryTerms, setShowDeliveryTerms] = useState(false);
  const [thirdPartyCourierDelivery, setThirdPartyCourierDelivery] = useState(false);
  const [thirdPartyCourier, setThirdPartyCourier] = useState('');
  const [thirdPartyCourierName, setThirdPartyCourierName] = useState('');
  const [thirdPartyDestination, setThirdPartyDestination] = useState('');
  const [thirdPartyCourierTermsAccepted, setThirdPartyCourierTermsAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmedOrder | null>(null);
  const [paymentNotCompleted, setPaymentNotCompleted] = useState(false);
  const [paymentFailureMessage, setPaymentFailureMessage] = useState('');
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [loyaltySettings, setLoyaltySettings] = useState<{ enabled: boolean; pointsRequired: number; discountAmount: number } | null>(null);
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [cashOnDeliveryEnabled, setCashOnDeliveryEnabled] = useState(true);
  const restaurantId = items[0]?.product.restaurantId ?? '';

  useEffect(() => {
    if (!supabase || !restaurantId) return;
    const client = supabase as NonNullable<typeof supabase>;

    let mounted = true;
    async function loadCashOnDeliverySetting() {
      const { data, error } = await client
        .from('restaurants')
        .select('cash_on_delivery_enabled')
        .eq('id', restaurantId)
        .single();

      if (!mounted) return;
      if (!error) setCashOnDeliveryEnabled(data?.cash_on_delivery_enabled !== false);
    }

    void loadCashOnDeliverySetting();
    return () => { mounted = false; };
  }, [restaurantId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentState = params.get('payment');
    const reference = params.get('reference');

    if (paymentState === 'not_completed') {
      setPaymentNotCompleted(true);
      setPaymentFailureMessage('Payment was not completed. No restaurant order was created. You can try the payment again.');
      const savedReference = window.localStorage.getItem(PENDING_PAYMENT_REFERENCE_KEY);
      if (savedReference) {
        void getOnlinePaymentStatus(savedReference).then((result) => {
          if (result.status === 'failed') {
            setPaymentFailureMessage('Payment failed. No restaurant order was created. Please try again.');
          } else if (result.status === 'expired') {
            setPaymentFailureMessage('Payment checkout expired. No restaurant order was created. Please try again.');
          } else if (result.status === 'paid' && result.orderNumber) {
            window.history.replaceState({}, '', window.location.pathname + window.location.hash);
            setPaymentNotCompleted(false);
            window.localStorage.removeItem(PENDING_PAYMENT_REFERENCE_KEY);
            window.localStorage.removeItem(PENDING_PAYMENT_CHECKOUT_URL_KEY);
            window.localStorage.removeItem(PENDING_PAYMENT_ORDER_KEY);
            window.localStorage.setItem(ACTIVE_ORDER_KEY, result.orderNumber);
            window.dispatchEvent(new Event('restaurant-ordering-active-order-change'));
            window.dispatchEvent(new Event(CART_CLEAR_EVENT));
            setConfirmedOrder({
              orderNumber: result.orderNumber,
              paymentMethod: 'online',
              orderType: isDelivery && thirdPartyCourierDelivery ? 'pickup' : orderType,
              total: result.total,
            });
          }
        }).catch((error) => {
          console.error('Unable to check incomplete online payment status.', error);
        });
      }
      return;
    }

    if (paymentState !== 'processing' || !reference) return;
    const paymentReference = reference;

    let cancelled = false;
    setPaymentProcessing(true);

    async function waitForPayment() {
      for (let attempt = 0; attempt < 20 && !cancelled; attempt += 1) {
        try {
          const result = await getOnlinePaymentStatus(paymentReference);
          if (result.status === 'failed' || result.status === 'expired' || result.status === 'cancelled') {
            window.localStorage.removeItem(PENDING_PAYMENT_REFERENCE_KEY);
            window.localStorage.removeItem(PENDING_PAYMENT_CHECKOUT_URL_KEY);
            window.localStorage.removeItem(PENDING_PAYMENT_ORDER_KEY);
            window.history.replaceState({}, '', window.location.pathname + window.location.hash);
            if (!cancelled) {
              setPaymentProcessing(false);
              setPaymentNotCompleted(true);
              setPaymentFailureMessage(
                result.status === 'expired'
                  ? 'Payment checkout expired. No restaurant order was created. Please try again.'
                  : result.status === 'cancelled'
                    ? 'Payment was cancelled. No restaurant order was created.'
                    : 'Payment failed. No restaurant order was created. Please try again.',
              );
            }
            return;
          }

          if (result.status === 'paid' && result.orderNumber) {
            window.localStorage.removeItem(PENDING_PAYMENT_REFERENCE_KEY);
            window.localStorage.removeItem(PENDING_PAYMENT_CHECKOUT_URL_KEY);
            window.localStorage.removeItem(PENDING_PAYMENT_ORDER_KEY);
            window.history.replaceState({}, '', window.location.pathname + window.location.hash);
            window.dispatchEvent(new Event(CART_CLEAR_EVENT));
            if (!cancelled) {
              setPaymentProcessing(false);
              window.localStorage.setItem(ACTIVE_ORDER_KEY, result.orderNumber);
            window.dispatchEvent(new Event('restaurant-ordering-active-order-change'));
            setConfirmedOrder({
                orderNumber: result.orderNumber,
                paymentMethod: 'online',
                orderType: isDelivery && thirdPartyCourierDelivery ? 'pickup' : orderType,
                total: result.total,
              });
            }
            return;
          }
        } catch (error) {
          console.error('Unable to check online payment status.', error);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }

      if (!cancelled) {
        setPaymentProcessing(false);
        setSubmitError('We could not confirm the payment yet. No restaurant order has been confirmed. Please wait a moment and check again before paying again.');
      }
    }

    void waitForPayment();

    return () => {
      cancelled = true;
    };
  }, [orderType]);

  useEffect(() => {
    let cancelled = false;

    if (!user || !restaurantId) {
      setCustomerProfileLoading(false);
      setCustomerProfileError('');
      setCustomerName('');
      setMobileNumber('');
      setHasDefaultAddress(false);
      return;
    }

    setCustomerProfileLoading(true);
    setCustomerProfileError('');

    void getMyCustomerProfile(restaurantId)
      .then((profile) => {
        if (cancelled) return;
        if (!profile) {
          setCustomerProfileError('Your customer profile could not be loaded. Please sign in again.');
          return;
        }
        setCustomerName(profile.name ?? '');
        setMobileNumber(profile.phone ?? '');
        const hasAddress = Boolean(profile.defaultDeliveryCity?.trim() && profile.defaultDeliveryBarangay?.trim() && profile.defaultDeliveryAddress?.trim());
        setHasDefaultAddress(hasAddress);
        if (hasAddress) {
          setDeliveryCity(profile.defaultDeliveryCity ?? '');
          setDeliveryBarangay(profile.defaultDeliveryBarangay ?? '');
          setAddress(profile.defaultDeliveryAddress ?? '');
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Unable to load customer checkout profile.', error);
        setCustomerProfileError('We could not load your customer information. Please refresh and try again.');
      })
      .finally(() => {
        if (!cancelled) setCustomerProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, user?.id]);

  const restaurantPickupPoint = restaurant.locationText?.trim() ?? '';
  const cityIsSupported = Boolean(deliveryCity.trim()) && deliveryZones.some((zone) => normalize(zone.city) === normalize(deliveryCity));
  const isDelivery = orderType === 'delivery';

  useEffect(() => {
    if (!restaurantId || orderType !== 'delivery') {
      setDeliveryZones([]); setDeliveryCity(''); setDeliveryBarangay(''); setDeliveryZonesError('');
      setLoadingDeliveryZones(false); setThirdPartyCourierDelivery(false); setThirdPartyCourier(''); setThirdPartyCourierName(''); setThirdPartyDestination(''); setThirdPartyCourierTermsAccepted(false); setShowDeliveryTerms(false); return;
    }
    let cancelled = false;
    setLoadingDeliveryZones(true);
    void getRestaurantDeliveryZones(restaurantId).then((zones) => {
      if (!cancelled) setDeliveryZones(zones);
    }).catch((error) => {
      if (cancelled) return;
      setDeliveryZones([]); setDeliveryZonesError(error instanceof Error ? error.message : 'Unable to load delivery areas.');
    }).finally(() => { if (!cancelled) setLoadingDeliveryZones(false); });
    return () => { cancelled = true; };
  }, [restaurantId, orderType]);

  const subtotal = useMemo(() => items.reduce((total, item) => total + item.product.price * item.quantity, 0), [items]);
  const selectedDeliveryZone = useMemo(() => {
    if (!cityIsSupported || thirdPartyCourierDelivery) return null;
    const value = normalize(deliveryBarangay);
    return value ? deliveryZones.find((zone) => normalize(zone.city) === normalize(deliveryCity) && normalize(zone.barangay) === value) ?? null : null;
  }, [cityIsSupported, deliveryZones, deliveryBarangay, thirdPartyCourierDelivery]);
  const suggestions = useMemo(() => {
    const value = normalize(deliveryBarangay);
    if (!cityIsSupported || thirdPartyCourierDelivery || !value || selectedDeliveryZone) return [];
    return deliveryZones.filter((zone) => normalize(zone.city) === normalize(deliveryCity) && normalize(zone.barangay).startsWith(value)).slice(0, 6);
  }, [cityIsSupported, deliveryZones, deliveryBarangay, selectedDeliveryZone, thirdPartyCourierDelivery]);
  const deliveryFee = isDelivery && !thirdPartyCourierDelivery ? Number(selectedDeliveryZone?.shippingFee ?? 0) : 0;
  const loyaltyEligible = Boolean(user && loyaltySettings?.enabled && loyaltyPoints >= (loyaltySettings?.pointsRequired ?? Number.MAX_SAFE_INTEGER));
  const loyaltyDiscountPreview = loyaltyEligible && redeemPoints
    ? Math.min(Number(loyaltySettings?.discountAmount ?? 0), subtotal + deliveryFee)
    : 0;
  const checkoutTotal = Math.max(Number((subtotal + deliveryFee - loyaltyDiscountPreview).toFixed(2)), 0);

  useEffect(() => {
    let cancelled = false;
    if (!restaurantId || !user) {
      setLoyaltySettings(null);
      setLoyaltyPoints(0);
      setRedeemPoints(false);
      return;
    }
    setLoyaltyLoading(true);
    void Promise.all([
      getLoyaltyRedemptionSettings(restaurantId),
      getMyLoyaltyPoints(restaurantId),
    ]).then(([settings, points]) => {
      if (cancelled) return;
      setLoyaltySettings(settings);
      setLoyaltyPoints(points);
    }).catch((error) => {
      if (cancelled) return;
      console.error('Unable to load loyalty redemption settings.', error);
      setLoyaltySettings(null);
      setLoyaltyPoints(0);
    }).finally(() => {
      if (!cancelled) setLoyaltyLoading(false);
    });
    return () => { cancelled = true; };
  }, [restaurantId, user?.id]);

  if (paymentProcessing) return <section className="checkout-page"><div className="checkout-payment-notice" role="status"><strong>Payment received.</strong><span>We're confirming your order with the restaurant. Please wait a moment.</span></div></section>;

  if (paymentNotCompleted && !confirmedOrder) return (
    <section className="checkout-page">
      <div className="checkout-payment-notice checkout-payment-notice-error" role="alert">
        <strong>{paymentFailureMessage || 'Payment was not completed.'}</strong>
        <span>No restaurant order was created from this payment attempt. You can try the online payment again.</span>
        <button className="button button-primary" type="button" onClick={() => { setPaymentNotCompleted(false); setPaymentFailureMessage(''); setPaymentMethod(''); setShowPaymentModal(true); }}>
          Try Online Payment Again
        </button>
      </div>
    </section>
  );

  if (confirmedOrder) return <OrderConfirmationPage orderNumber={confirmedOrder.orderNumber} paymentMethod={confirmedOrder.paymentMethod} orderType={confirmedOrder.orderType} total={confirmedOrder.total} onReturnHome={() => { window.location.hash = ''; }} />;

  const canContinue = items.length > 0 && !customerProfileLoading && !customerProfileError && Boolean(customerName.trim()) && !/[0-9]/.test(customerName) && (orderType === 'dine_in' || /^09\d{9}$/.test(mobileNumber)) && (!isDelivery || (thirdPartyCourierDelivery ? Boolean(restaurantPickupPoint) : cityIsSupported && deliveryBarangay.trim() && address.trim() && Boolean(selectedDeliveryZone?.isSupported) && !loadingDeliveryZones));

  function resetPayment() { setShowPayment(false); setShowPaymentModal(false); setPaymentMethod(''); setSubmitError(''); }

  function openThirdPartyCourierTerms() {
    setThirdPartyCourierTermsAccepted(false);
    setThirdPartyCourier('');
    setThirdPartyCourierName('');
    setShowDeliveryTerms(true);
  }

  function commitCity() {
    const city = deliveryCity.trim();
    if (!city || thirdPartyCourierDelivery) return;
    if (deliveryZones.some((zone) => normalize(zone.city) === normalize(city))) {
      setShowDeliveryTerms(false);
      return;
    }
    openThirdPartyCourierTerms();
  }

  function handleCityKeyboard(event: React.KeyboardEvent<HTMLInputElement>) {
    const nativeEvent = event.nativeEvent as KeyboardEvent;
    const isEnter = event.key === 'Enter' || event.code === 'Enter' || nativeEvent.keyCode === 13 || nativeEvent.which === 13;
    if (!isEnter) return;
    event.preventDefault();
    event.stopPropagation();
    commitCity();
  }

  function handleCancelThirdPartyDelivery() {
    setShowDeliveryTerms(false); setThirdPartyCourierDelivery(false); setThirdPartyCourier(''); setThirdPartyCourierName(''); setThirdPartyDestination(''); setThirdPartyCourierTermsAccepted(false); setDeliveryCity(''); setDeliveryBarangay(''); setAddress(''); resetPayment();
  }

  function handleProceedWithThirdPartyCourier() {
    if (!thirdPartyCourierTermsAccepted) return;
    const destination = [deliveryCity.trim(), deliveryBarangay.trim(), address.trim()].filter(Boolean).join(', ');
    setThirdPartyDestination(destination);
    setShowDeliveryTerms(false); setThirdPartyCourierDelivery(true); setThirdPartyCourierTermsAccepted(false); setDeliveryBarangay(''); setAddress(''); setPaymentMethod(''); setSubmitError(''); setShowPayment(true);
    window.requestAnimationFrame(() => document.getElementById('payment-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function saveDefaultAddressIfNeeded() {
    if (!user || !isDelivery || thirdPartyCourierDelivery) return;
    const city = deliveryCity.trim();
    const barangay = deliveryBarangay.trim();
    const completeAddress = address.trim();
    if (!city || !barangay || !completeAddress || !selectedDeliveryZone?.isSupported) return;
    await saveMyDefaultDeliveryAddress(items[0].product.restaurantId, city, barangay, completeAddress);
    setHasDefaultAddress(true);
  }

  async function createPendingOrder(method: PaymentMethod) {
    if (new Set(items.map((item) => item.product.restaurantId)).size !== 1) throw new Error('Your cart contains items from different restaurants. Please clear your cart and try again.');
    if (isDelivery && thirdPartyCourierDelivery && !restaurantPickupPoint) throw new Error('The restaurant pickup address is not configured yet. Please contact the restaurant.');
    if (isDelivery && !thirdPartyCourierDelivery && (!selectedDeliveryZone || !selectedDeliveryZone.isSupported)) throw new Error(outsideDeliveryAreaMessage);

    const finalNotes = [notes.trim(), isDelivery && thirdPartyCourierDelivery ? `${thirdPartyCourierNote}\nCourier: ${thirdPartyCourier === 'Other' ? (thirdPartyCourierName || 'Other courier') : thirdPartyCourier}\nDestination: ${thirdPartyDestination || [deliveryCity.trim(), deliveryBarangay.trim(), address.trim()].filter(Boolean).join(', ')}` : ''].filter(Boolean).join('\n\n');
    return createOrder({
      restaurantId: items[0].product.restaurantId,
      customerName: customerName.trim(),
      mobileNumber: orderType === 'dine_in' ? '' : mobileNumber.trim(),
      orderType: isDelivery && thirdPartyCourierDelivery ? 'pickup' : orderType,
      deliveryCity: isDelivery && !thirdPartyCourierDelivery ? deliveryCity.trim() : '',
      deliveryBarangay: isDelivery && !thirdPartyCourierDelivery ? deliveryBarangay.trim() : '',
      deliveryAddress: isDelivery ? (thirdPartyCourierDelivery ? restaurantPickupPoint : [deliveryCity.trim(), deliveryBarangay.trim(), address.trim()].filter(Boolean).join(', ')) : address.trim(),
      notes: finalNotes,
      // Keep the existing database payment value while the customer-facing method is "Online Payment".
      paymentMethod: method === 'online' ? 'gcash' : 'cash',
      isThirdPartyCourier: isDelivery && thirdPartyCourierDelivery,
      items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
    });
  }

  async function handleOnlinePayment() {
    if (!canContinue || items.length === 0 || isSubmitting) return;
    if (thirdPartyCourierDelivery && (!thirdPartyCourier || (thirdPartyCourier === 'Other' && !thirdPartyCourierName.trim()))) {
      setSubmitError('Please select your courier before continuing.');
      return;
    }
    setIsSubmitting(true);
    setSubmitError('');
    setPaymentMethod('online');

    try {
      await saveDefaultAddressIfNeeded();
      const savedCheckoutUrl = paymentNotCompleted ? window.localStorage.getItem(PENDING_PAYMENT_CHECKOUT_URL_KEY) : null;
      if (savedCheckoutUrl) {
        setPaymentNotCompleted(false);
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        window.location.assign(savedCheckoutUrl);
        return;
      }
      const pendingPayment = await createPendingOnlinePayment({
        restaurantId: items[0].product.restaurantId,
        customerName: customerName.trim(),
        mobileNumber: orderType === 'dine_in' ? '' : mobileNumber.trim(),
        orderType: isDelivery && thirdPartyCourierDelivery ? 'pickup' : orderType,
        deliveryCity: isDelivery && !thirdPartyCourierDelivery ? deliveryCity.trim() : '',
        deliveryBarangay: isDelivery && !thirdPartyCourierDelivery ? deliveryBarangay.trim() : '',
        deliveryAddress: isDelivery ? (thirdPartyCourierDelivery ? restaurantPickupPoint : [deliveryCity.trim(), deliveryBarangay.trim(), address.trim()].filter(Boolean).join(', ')) : address.trim(),
        notes: [notes.trim(), isDelivery && thirdPartyCourierDelivery ? `${thirdPartyCourierNote}\\nCourier: ${thirdPartyCourier === 'Other' ? (thirdPartyCourierName || 'Other courier') : thirdPartyCourier}\\nDestination: ${thirdPartyDestination || [deliveryCity.trim(), deliveryBarangay.trim(), address.trim()].filter(Boolean).join(', ')}` : ''].filter(Boolean).join('\\n\\n'),
        isThirdPartyCourier: isDelivery && thirdPartyCourierDelivery,
        items: items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
        redeemLoyalty: redeemPoints,
      });
      const payableTotal = pendingPayment.total;
      if (payableTotal <= 0) {
        throw new Error('The loyalty reward covers the entire order. Please choose cash payment or contact the restaurant for a free-order arrangement.');
      }
      window.localStorage.setItem(PENDING_PAYMENT_REFERENCE_KEY, pendingPayment.referenceNumber);
      const checkoutUrl = await createPayMongoCheckout(pendingPayment.paymentId);
      window.localStorage.setItem(PENDING_PAYMENT_CHECKOUT_URL_KEY, checkoutUrl);
      setShowPaymentModal(false);
      window.location.assign(checkoutUrl);
    } catch (error) {
      console.error('Unable to start online payment.', error);
      setPaymentMethod('online');
      setSubmitError(error instanceof Error ? error.message : 'We could not start online payment. Please try again.');
      setShowPaymentModal(true);
      setIsSubmitting(false);
    }
  }

  async function handlePlaceOrder() {
    if (paymentMethod !== 'cash' || items.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');

    try {
      await saveDefaultAddressIfNeeded();
      const createdOrder = await createPendingOrder('cash');
      let confirmedTotal = createdOrder.total;
      if (redeemPoints) {
        const customerId = await getMyCustomerProfileId(items[0].product.restaurantId);
        if (!customerId) throw new Error('Your customer account could not be found. Please sign in again.');
        await attachCustomerToOrder(createdOrder.orderId, customerId);
        const redemption = await redeemLoyaltyReward(createdOrder.orderId, customerId);
        confirmedTotal = Math.max(Number((createdOrder.total - redemption.discountAmount).toFixed(2)), 0);
        setLoyaltyPoints(redemption.remainingPoints);
        setRedeemPoints(false);
      }
      window.localStorage.setItem(ACTIVE_ORDER_KEY, createdOrder.orderNumber);
      window.dispatchEvent(new Event('restaurant-ordering-active-order-change'));
      window.dispatchEvent(new Event(CART_CLEAR_EVENT));
      setConfirmedOrder({ orderNumber: createdOrder.orderNumber, paymentMethod: 'cash', orderType, total: confirmedTotal });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'We could not create your order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handlePaymentMethodSelect(method: PaymentMethod) {
    if (method === 'online') {
      void handleOnlinePayment();
      return;
    }
    setPaymentMethod('cash');
    setSubmitError('');
  }

  return (
    <section className="checkout-page">
      <div className="menu-intro"><p className="eyebrow">Checkout</p><h1>How would you like your order?</h1><p>Choose how you will receive your food, then provide the details we need.</p></div>
      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={(event) => event.preventDefault()}>
          <fieldset className="checkout-section"><legend>Order type</legend><div className="order-type-grid">
            {orderTypes.map((type) => <label className={`order-type-card ${orderType === type.value ? 'is-selected' : ''}`} key={type.value}><input type="radio" name="orderType" checked={orderType === type.value} onChange={() => { setOrderType(type.value); resetPayment(); }} /><span className="order-type-content"><strong>{type.label}</strong></span></label>)}
          </div></fieldset>

          <fieldset className="checkout-section"><legend>Customer information</legend>{customerProfileError && <p className="checkout-error" role="alert">{customerProfileError}</p>}<div className="checkout-fields">
            <label><span>Full name</span><input type="text" value={customerProfileLoading ? '' : customerName} onChange={(event) => setCustomerName(event.target.value)} autoComplete="name" required />{/[0-9]/.test(customerName) && <span className="checkout-field-error" role="alert">Full name must not contain numbers.</span>}</label>
            {orderType !== 'dine_in' && <label><span>Mobile number</span><input type="tel" value={customerProfileLoading ? '' : mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} autoComplete="tel" inputMode="numeric" maxLength={11} pattern="09[0-9]{9}" title="Enter an 11-digit Philippine mobile number starting with 09." required />{mobileNumber.length >= 2 && !mobileNumber.startsWith('09') && <span className="checkout-field-error" role="alert">Mobile number must start with 09.</span>}{mobileNumber.length > 0 && mobileNumber.startsWith('09') && mobileNumber.length < 11 && <span className="checkout-field-hint">Enter all 11 digits.</span>}</label>}
          </div></fieldset>

          {isDelivery && <fieldset className="checkout-section"><legend>{thirdPartyCourierDelivery ? 'Third-party courier delivery' : 'Delivery address'}</legend>
            {deliveryZonesError && <p className="checkout-error" role="alert">{deliveryZonesError}</p>}
            {!thirdPartyCourierDelivery && !hasDefaultAddress && <p className="checkout-address-note">Please enter your delivery address. We’ll save it as your default address for future orders.</p>}
            {thirdPartyCourierDelivery ? <div className="third-party-courier-card">
              <strong>Restaurant pickup point</strong><p className="pickup-label">Give this to your courier.</p><p className="pickup-address">{restaurantPickupPoint || 'Restaurant pickup address is not configured.'}</p>
              <div className="pickup-callout">Your destination address is not entered here. Provide your destination directly to Lalamove, Grab Express, or your chosen courier.</div><p>You are responsible for booking and paying the third-party courier.</p>
              <label><span>Courier</span><select value={thirdPartyCourier} onChange={(event) => { setThirdPartyCourier(event.target.value); if (event.target.value !== 'Other') setThirdPartyCourierName(''); }} required><option value="">Select your courier</option><option value="Lalamove">Lalamove</option><option value="Grab Express">Grab Express</option><option value="Other">Other courier</option></select></label>
              {thirdPartyCourier === 'Other' && <label><span>Courier name</span><input type="text" value={thirdPartyCourierName} onChange={(event) => setThirdPartyCourierName(event.target.value)} placeholder="Enter courier name" required /></label>
              }
              {thirdPartyDestination && <p className="pickup-callout"><strong>Destination:</strong> {thirdPartyDestination}</p>}
            </div> : <div className="delivery-address-fields">
              <label><span>City</span><input type="text" name="deliveryCity" value={deliveryCity} onChange={(e) => { setDeliveryCity(e.target.value); setDeliveryBarangay(''); setAddress(''); setThirdPartyCourierDelivery(false); setThirdPartyCourierTermsAccepted(false); setShowDeliveryTerms(false); resetPayment(); }} onKeyDownCapture={handleCityKeyboard} onKeyUpCapture={handleCityKeyboard} autoComplete="address-level2" placeholder="Enter your city, then press Enter" required /></label>
              {cityIsSupported && <div className="delivery-field-group"><label htmlFor="delivery-barangay">Barangay</label><div className="barangay-input-wrap"><input id="delivery-barangay" type="text" value={deliveryBarangay} onChange={(e) => { setDeliveryBarangay(e.target.value); resetPayment(); }} placeholder="Enter your barangay" disabled={loadingDeliveryZones || deliveryZones.length === 0} required />{suggestions.length > 0 && <div className="barangay-suggestions" role="listbox">{suggestions.map((zone) => <button className="barangay-suggestion" key={zone.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setDeliveryBarangay(zone.barangay); resetPayment(); }}><span>{zone.barangay}</span><small>{zone.isSupported ? `₱${zone.shippingFee.toFixed(2)} delivery fee` : 'Outside delivery area'}</small></button>)}</div>}</div></div>}
              {cityIsSupported && deliveryBarangay.trim() && <label><span>Unit/Bldg./Street Address</span><textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter your unit, building, house number, and street" rows={4} required /></label>}
            </div>}
            {!thirdPartyCourierDelivery && deliveryCity.trim() && !cityIsSupported && <p className="checkout-error" role="alert">{outsideDeliveryAreaMessage}</p>}
            {!thirdPartyCourierDelivery && loadingDeliveryZones && <p className="checkout-hint">Loading delivery areas…</p>}
            {!thirdPartyCourierDelivery && cityIsSupported && deliveryBarangay.trim() && !selectedDeliveryZone && <p className="checkout-error" role="alert">{outsideDeliveryAreaMessage}</p>}
            {!thirdPartyCourierDelivery && cityIsSupported && selectedDeliveryZone && !selectedDeliveryZone.isSupported && <div className="checkout-outside-scope-card"><p className="checkout-error" role="alert">{selectedDeliveryZone.outOfScopeMessage || outsideDeliveryAreaMessage}</p><button className="button button-secondary" type="button" onClick={openThirdPartyCourierTerms}>Use my own courier instead</button></div>}
            {!thirdPartyCourierDelivery && selectedDeliveryZone?.isSupported && <p className="checkout-hint">Delivery fee: ₱{deliveryFee.toFixed(2)}</p>}
          </fieldset>}

          <fieldset className="checkout-section"><legend>Order notes <span className="optional-label">Optional</span></legend><label><span>Special instructions</span><textarea className="order-notes-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for the restaurant" rows={3} /></label></fieldset>

        </form>

        <aside className="checkout-summary"><div className="checkout-section"><h2>Order summary</h2>{items.map((item) => <div className="checkout-summary-row" key={item.product.id}><span>{item.quantity} × {item.product.name}</span><strong>₱{(item.product.price * item.quantity).toFixed(2)}</strong></div>)}<div className="checkout-summary-row"><span>Subtotal</span><strong>₱{subtotal.toFixed(2)}</strong></div>{orderType !== 'dine_in' && <div className="checkout-summary-row"><span>Delivery fee</span><strong>₱{deliveryFee.toFixed(2)}</strong></div>}
          {user && loyaltySettings?.enabled && <div className="checkout-loyalty-card">
            <div className="checkout-loyalty-heading"><div><strong>Loyalty reward</strong><span>{loyaltyLoading ? 'Checking your points…' : `${loyaltyPoints} points available`}</span></div></div>
            {loyaltyEligible ? <label className="checkout-loyalty-option"><input type="checkbox" checked={redeemPoints} onChange={(event) => setRedeemPoints(event.target.checked)} /><span><strong>Redeem {loyaltySettings.pointsRequired} points</strong><small>Apply ₱{loyaltySettings.discountAmount.toFixed(2)} off this order before online payment.</small></span></label> : <p className="checkout-loyalty-hint">{loyaltyLoading ? 'Loading…' : `You need ${loyaltySettings.pointsRequired} points to unlock this reward.`}</p>}
          </div>}
          {redeemPoints && loyaltyDiscountPreview > 0 && <div className="checkout-summary-row checkout-loyalty-discount"><span>Loyalty Discount</span><strong>-₱{loyaltyDiscountPreview.toFixed(2)}</strong></div>}
          <div className="checkout-summary-total"><span>Total</span><strong>₱{checkoutTotal.toFixed(2)}</strong></div></div>
          <button className="button button-primary" type="button" disabled={!canContinue} onClick={() => { setSubmitError(''); setPaymentMethod(''); setShowPaymentModal(true); }}>Continue to Payment</button>
        </aside>
      </div>

      {showPaymentModal && <div className="payment-modal-backdrop" role="presentation">
        <div className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
          <div className="payment-modal-header">
            <div><p className="eyebrow">Checkout</p><h2 id="payment-modal-title">Choose your payment method</h2><p>Select how you would like to pay for this order.</p></div>
            <button className="payment-modal-close" type="button" aria-label="Close payment method" onClick={() => setShowPaymentModal(false)} disabled={isSubmitting}>×</button>
          </div>
          {thirdPartyCourierDelivery && <p className="courier-payment-note"><strong>Online payment is required.</strong> Please complete your payment before the order is sent to the restaurant. You are responsible for booking and paying the courier separately.</p>}
          <div className="payment-method-options">
            {paymentMethods
              .filter((method) => !thirdPartyCourierDelivery || method.value === 'online')
              .filter((method) => !(orderType === 'delivery' && method.value === 'cash' && !cashOnDeliveryEnabled))
              .map((method) => {
              const label = orderType === 'dine_in' && method.value === 'cash' ? 'Pay at Counter' : method.label;
              const description = orderType === 'dine_in' && method.value === 'cash' ? 'Place your order now and pay the cashier at the restaurant counter.' : method.description;
              return <button className={`payment-method-card ${paymentMethod === method.value ? 'is-selected' : ''}`} key={method.value} type="button" onClick={() => setPaymentMethod(method.value)} disabled={isSubmitting}>
                <span className="payment-method-icon" aria-hidden="true">{method.value === 'cash' ? '₱' : '↗'}</span>
                <span className="payment-method-content"><strong>{label}</strong><span>{description}</span></span>
                <span className="payment-method-radio" aria-hidden="true">{paymentMethod === method.value ? '✓' : ''}</span>
              </button>;
            })}
          </div>
          {submitError && <p className="checkout-error" role="alert">{submitError}</p>}
          <div className="payment-modal-actions">
            <button className="button button-secondary" type="button" onClick={() => setShowPaymentModal(false)} disabled={isSubmitting}>Cancel</button>
            <button className="button button-primary" type="button" disabled={!paymentMethod || isSubmitting} onClick={() => {
              if (paymentMethod === 'online') { void handleOnlinePayment(); }
              else { void handlePlaceOrder(); }
            }}>{paymentMethod === 'online' ? 'Continue to Online Payment' : orderType === 'dine_in' ? 'Place Order & Pay at Counter' : 'Place Order'}</button>
          </div>
        </div>
      </div>}

      {showDeliveryTerms && <div className="delivery-terms-backdrop" role="presentation"><div className="delivery-terms-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-terms-title"><h2 id="delivery-terms-title">Delivery Terms</h2><p className="terms-intro">This destination is outside the restaurant's in-house delivery area. The restaurant cannot deliver to this destination directly.</p><div className="terms-box"><p><strong>Proceed with your own courier.</strong> You may book Lalamove, Grab Express, or another courier to collect your order from the restaurant.</p><p>You are responsible for booking and paying the courier, and for providing the courier with your destination address.</p><p>The restaurant will pack your order securely and prepare it as fresh as possible for courier pickup at its listed restaurant pickup point.</p><p>After the order is handed over to your courier, the restaurant is not responsible for courier-related delays, loss, spills, damage, or other issues that happen during transit.</p><label className="delivery-terms-checkbox"><input type="checkbox" checked={thirdPartyCourierTermsAccepted} onChange={(event) => setThirdPartyCourierTermsAccepted(event.target.checked)} /><span>I understand and agree to these third-party courier terms.</span></label></div><div className="terms-actions"><button className="button" type="button" onClick={handleCancelThirdPartyDelivery}>Cancel</button><button className="button button-primary" type="button" onClick={handleProceedWithThirdPartyCourier} disabled={!thirdPartyCourierTermsAccepted}>Proceed with Order</button></div></div></div>}
    </section>
  );
}
