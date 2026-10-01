import { useEffect, useMemo, useState } from 'react';
import type { RestaurantProduct } from '../types/menu';
import { createOrder } from '../services/orderRepository';
import { createPayMongoCheckout } from '../services/paymongoRepository';
import { getRestaurantDeliveryZones, type RestaurantDeliveryZone } from '../services/restaurantSettingsRepository';
import { useRestaurant } from '../components/RestaurantProvider';
import { OrderConfirmationPage } from './OrderConfirmationPage';
import '../styles/checkout-mobile.css';

type CartItem = { product: RestaurantProduct; quantity: number };
type OrderType = 'delivery' | 'pickup' | 'dine_in';
type PaymentMethod = 'cash' | 'online';
type CheckoutPageProps = { items: CartItem[] };
type ConfirmedOrder = { orderNumber: string; paymentMethod: PaymentMethod; orderType: OrderType; total: number };

const orderTypes: Array<{ value: OrderType; label: string; description: string }> = [
  { value: 'delivery', label: 'Delivery', description: 'Have the restaurant deliver your order.' },
  { value: 'pickup', label: 'Pickup', description: 'Collect your order from the restaurant. This includes take-out.' },
  { value: 'dine_in', label: 'Dine-in', description: 'Order from your phone while eating at the restaurant.' },
];

const paymentMethods: Array<{ value: PaymentMethod; label: string; description: string }> = [
  { value: 'cash', label: 'Cash', description: 'Pay in cash when your order is received or collected.' },
  { value: 'online', label: 'Online Payment', description: 'Pay securely through our online payment gateway.' },
];

const outsideCityMessage = 'We currently deliver only within selected barangays in Valenzuela City. If you are outside Valenzuela, you can proceed using your own courier.';
const outsideDeliveryAreaMessage = 'The address is not within the store delivery area. If you want to proceed, please book your own delivery courier like Lalamove or Grab Express.';
const PENDING_PAYMENT_ORDER_KEY = 'restaurant-ordering-pending-payment-order';
const CART_CLEAR_EVENT = 'restaurant-ordering-cart-clear';
const thirdPartyCourierNote = 'THIRD-PARTY COURIER: Customer is responsible for booking and paying the delivery courier (such as Lalamove or Grab Express). The restaurant will prepare the food for courier pickup at the listed restaurant pickup point.';

function normalize(value: string) { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
function isValenzuela(value: string) { const city = normalize(value); return city === 'valenzuela' || city === 'valenzuela city'; }

export function CheckoutPage({ items }: CheckoutPageProps) {
  const restaurant = useRestaurant();
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
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
  const [thirdPartyCourierTermsAccepted, setThirdPartyCourierTermsAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmedOrder | null>(null);

  const restaurantId = items[0]?.product.restaurantId ?? '';
  const restaurantPickupPoint = restaurant.locationText?.trim() ?? '';
  const cityIsSupported = isValenzuela(deliveryCity);
  const isDelivery = orderType === 'delivery';

  useEffect(() => {
    if (!restaurantId || orderType !== 'delivery') {
      setDeliveryZones([]); setDeliveryCity(''); setDeliveryBarangay(''); setDeliveryZonesError('');
      setLoadingDeliveryZones(false); setThirdPartyCourierDelivery(false); setThirdPartyCourierTermsAccepted(false); setShowDeliveryTerms(false); return;
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
    return value ? deliveryZones.find((zone) => normalize(zone.barangay) === value) ?? null : null;
  }, [cityIsSupported, deliveryZones, deliveryBarangay, thirdPartyCourierDelivery]);
  const suggestions = useMemo(() => {
    const value = normalize(deliveryBarangay);
    if (!cityIsSupported || thirdPartyCourierDelivery || !value || selectedDeliveryZone) return [];
    return deliveryZones.filter((zone) => normalize(zone.barangay).startsWith(value)).slice(0, 6);
  }, [cityIsSupported, deliveryZones, deliveryBarangay, selectedDeliveryZone, thirdPartyCourierDelivery]);
  const deliveryFee = isDelivery && !thirdPartyCourierDelivery ? Number(selectedDeliveryZone?.shippingFee ?? 0) : 0;

  if (confirmedOrder) return <OrderConfirmationPage orderNumber={confirmedOrder.orderNumber} paymentMethod={confirmedOrder.paymentMethod} orderType={confirmedOrder.orderType} total={confirmedOrder.total} onReturnHome={() => { window.location.hash = ''; }} />;

  const canContinue = items.length > 0 && Boolean(customerName.trim()) && !/[0-9]/.test(customerName) && (orderType === 'dine_in' || /^09\d{9}$/.test(mobileNumber)) && (!isDelivery || (thirdPartyCourierDelivery ? Boolean(restaurantPickupPoint) : cityIsSupported && deliveryBarangay.trim() && address.trim() && Boolean(selectedDeliveryZone?.isSupported) && !loadingDeliveryZones));

  function resetPayment() { setShowPayment(false); setShowPaymentModal(false); setPaymentMethod(''); setSubmitError(''); }

  function commitCity() {
    const city = deliveryCity.trim();
    if (!city || thirdPartyCourierDelivery) return;
    if (isValenzuela(city)) {
      setShowDeliveryTerms(false);
      return;
    }
    setThirdPartyCourierTermsAccepted(false);
    setThirdPartyCourierTermsAccepted(false);
    setShowDeliveryTerms(true);
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
    setShowDeliveryTerms(false); setThirdPartyCourierDelivery(false); setThirdPartyCourierTermsAccepted(false); setDeliveryCity(''); setDeliveryBarangay(''); setAddress(''); resetPayment();
  }

  function handleProceedWithThirdPartyCourier() {
    if (!thirdPartyCourierTermsAccepted) return;
    setShowDeliveryTerms(false); setThirdPartyCourierDelivery(true); setThirdPartyCourierTermsAccepted(false); setDeliveryBarangay(''); setAddress(''); setPaymentMethod(''); setSubmitError(''); setShowPayment(true);
    window.requestAnimationFrame(() => document.getElementById('payment-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  async function createPendingOrder(method: PaymentMethod) {
    if (new Set(items.map((item) => item.product.restaurantId)).size !== 1) throw new Error('Your cart contains items from different restaurants. Please clear your cart and try again.');
    if (isDelivery && thirdPartyCourierDelivery && !restaurantPickupPoint) throw new Error('The restaurant pickup address is not configured yet. Please contact the restaurant.');
    if (isDelivery && !thirdPartyCourierDelivery && (!selectedDeliveryZone || !selectedDeliveryZone.isSupported)) throw new Error(outsideDeliveryAreaMessage);

    const finalNotes = [notes.trim(), isDelivery && thirdPartyCourierDelivery ? thirdPartyCourierNote : ''].filter(Boolean).join('\n\n');
    return createOrder({
      restaurantId: items[0].product.restaurantId,
      customerName: customerName.trim(),
      mobileNumber: orderType === 'dine_in' ? '' : mobileNumber.trim(),
      orderType,
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
    setIsSubmitting(true);
    setSubmitError('');
    setPaymentMethod('online');

    try {
      const createdOrder = await createPendingOrder('online');
      window.localStorage.setItem(PENDING_PAYMENT_ORDER_KEY, createdOrder.orderNumber);
      const checkoutUrl = await createPayMongoCheckout(createdOrder.orderId);
      window.location.assign(checkoutUrl);
    } catch (error) {
      setPaymentMethod('');
      setSubmitError(error instanceof Error ? error.message : 'We could not start online payment. Please try again.');
      setIsSubmitting(false);
    }
  }

  async function handlePlaceOrder() {
    if (paymentMethod !== 'cash' || items.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError('');

    try {
      const createdOrder = await createPendingOrder('cash');
      window.dispatchEvent(new Event(CART_CLEAR_EVENT));
      setConfirmedOrder({ orderNumber: createdOrder.orderNumber, paymentMethod: 'cash', orderType, total: createdOrder.total });
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

          <fieldset className="checkout-section"><legend>Customer information</legend><div className="checkout-fields">
            <label><span>Full name</span><input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} autoComplete="name" aria-invalid={/[0-9]/.test(customerName)} required />{/[0-9]/.test(customerName) && <span className="checkout-field-error" role="alert">Full name must not contain numbers.</span>}</label>
            {orderType !== 'dine_in' && <label><span>Mobile number</span><input type="tel" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value.replace(/\D/g, '').slice(0, 11))} autoComplete="tel" inputMode="numeric" maxLength={11} pattern="09[0-9]{9}" title="Enter an 11-digit Philippine mobile number starting with 09." aria-invalid={mobileNumber.length >= 2 && !mobileNumber.startsWith('09')} required />{mobileNumber.length >= 2 && !mobileNumber.startsWith('09') && <span className="checkout-field-error" role="alert">Mobile number must start with 09.</span>}{mobileNumber.length > 0 && mobileNumber.startsWith('09') && mobileNumber.length < 11 && <span className="checkout-field-hint">Enter all 11 digits.</span>}</label>}
          </div></fieldset>

          {isDelivery && <fieldset className="checkout-section"><legend>{thirdPartyCourierDelivery ? 'Third-party courier delivery' : 'Delivery address'}</legend>
            {deliveryZonesError && <p className="checkout-error" role="alert">{deliveryZonesError}</p>}
            {thirdPartyCourierDelivery ? <div className="third-party-courier-card">
              <strong>Restaurant pickup point</strong><p className="pickup-label">Give this to your courier.</p><p className="pickup-address">{restaurantPickupPoint || 'Restaurant pickup address is not configured.'}</p>
              <div className="pickup-callout">Your destination address is not entered here. Provide your destination directly to Lalamove, Grab Express, or your chosen courier.</div><p>You are responsible for booking and paying the third-party courier.</p>
            </div> : <div className="delivery-address-fields">
              <label><span>City</span><input type="text" name="deliveryCity" value={deliveryCity} onChange={(e) => { setDeliveryCity(e.target.value); setDeliveryBarangay(''); setAddress(''); setThirdPartyCourierDelivery(false); setThirdPartyCourierTermsAccepted(false); setShowDeliveryTerms(false); resetPayment(); }} onKeyDownCapture={handleCityKeyboard} onKeyUpCapture={handleCityKeyboard} autoComplete="address-level2" placeholder="Enter your city, then press Enter" required /></label>
              {cityIsSupported && <label><span>Barangay</span><div className="barangay-input-wrap"><input type="text" value={deliveryBarangay} onChange={(e) => { setDeliveryBarangay(e.target.value); resetPayment(); }} placeholder="Enter your barangay" disabled={loadingDeliveryZones || deliveryZones.length === 0} required />{suggestions.length > 0 && <div className="barangay-suggestions" role="listbox">{suggestions.map((zone) => <button className="barangay-suggestion" key={zone.id} type="button" onClick={() => setDeliveryBarangay(zone.barangay)}><span>{zone.barangay}</span><small>{zone.isSupported ? `₱${zone.shippingFee.toFixed(2)} delivery fee` : 'Outside delivery area'}</small></button>)}</div>}</div></label>}
              {cityIsSupported && deliveryBarangay.trim() && <label><span>Complete address</span><textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Complete delivery address" rows={4} required /></label>}
            </div>}
            {!thirdPartyCourierDelivery && deliveryCity.trim() && !cityIsSupported && <p className="checkout-error" role="alert">{outsideCityMessage}</p>}
            {!thirdPartyCourierDelivery && loadingDeliveryZones && <p className="checkout-hint">Loading delivery areas…</p>}
            {!thirdPartyCourierDelivery && cityIsSupported && deliveryBarangay.trim() && !selectedDeliveryZone && <p className="checkout-error" role="alert">{outsideDeliveryAreaMessage}</p>}
            {!thirdPartyCourierDelivery && selectedDeliveryZone?.isSupported && <p className="checkout-hint">Delivery fee: ₱{deliveryFee.toFixed(2)}</p>}
          </fieldset>}

          <fieldset className="checkout-section"><legend>Order notes <span className="optional-label">Optional</span></legend><label><span>Special instructions</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add a note for the restaurant" rows={3} /></label></fieldset>

          <button className="button button-primary checkout-submit" type="button" disabled={!canContinue} onClick={() => { setSubmitError(''); setPaymentMethod(''); setShowPaymentModal(true); }}>Continue to Payment</button>
        </form>

        <aside className="checkout-summary"><div className="checkout-section"><h2>Order summary</h2>{items.map((item) => <div className="checkout-summary-row" key={item.product.id}><span>{item.quantity} × {item.product.name}</span><strong>₱{(item.product.price * item.quantity).toFixed(2)}</strong></div>)}<div className="checkout-summary-row"><span>Subtotal</span><strong>₱{subtotal.toFixed(2)}</strong></div>{orderType !== 'dine_in' && <div className="checkout-summary-row"><span>Delivery fee</span><strong>₱{deliveryFee.toFixed(2)}</strong></div>}<div className="checkout-summary-total"><span>Total</span><strong>₱{(subtotal + deliveryFee).toFixed(2)}</strong></div></div></aside>
      </div>

      {showPaymentModal && <div className="payment-modal-backdrop" role="presentation">
        <div className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-modal-title">
          <div className="payment-modal-header">
            <div><p className="eyebrow">Checkout</p><h2 id="payment-modal-title">Choose your payment method</h2><p>Select how you would like to pay for this order.</p></div>
            <button className="payment-modal-close" type="button" aria-label="Close payment method" onClick={() => setShowPaymentModal(false)} disabled={isSubmitting}>×</button>
          </div>
          {thirdPartyCourierDelivery && <p className="courier-payment-note"><strong>Online payment is required.</strong> Please complete your payment before the order is sent to the restaurant. You are responsible for booking and paying the courier separately.</p>}
          <div className="payment-method-options">
            {paymentMethods.filter((method) => !thirdPartyCourierDelivery || method.value === 'online').map((method) => {
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
            <button className="button" type="button" onClick={() => setShowPaymentModal(false)} disabled={isSubmitting}>Cancel</button>
            <button className="button button-primary" type="button" disabled={!paymentMethod || isSubmitting} onClick={() => {
              if (paymentMethod === 'online') { setShowPaymentModal(false); void handleOnlinePayment(); }
              else { setShowPaymentModal(false); void handlePlaceOrder(); }
            }}>{paymentMethod === 'online' ? 'Continue to Online Payment' : orderType === 'dine_in' ? 'Place Order & Pay at Counter' : 'Place Order'}</button>
          </div>
        </div>
      </div>}

      {showDeliveryTerms && <div className="delivery-terms-backdrop" role="presentation"><div className="delivery-terms-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-terms-title"><h2 id="delivery-terms-title">Delivery Terms</h2><p className="terms-intro">This city is outside Valenzuela City. The restaurant cannot deliver to this destination directly.</p><div className="terms-box"><p><strong>Proceed with your own courier.</strong> You may book Lalamove, Grab Express, or another courier to collect your order from the restaurant.</p><p>You are responsible for booking and paying the courier, and for providing the courier with your destination address.</p><p>The restaurant will pack your order securely and prepare it as fresh as possible for courier pickup at its listed restaurant pickup point.</p><p>After the order is handed over to your courier, the restaurant is not responsible for courier-related delays, loss, spills, damage, or other issues that happen during transit.</p><label className="delivery-terms-checkbox"><input type="checkbox" checked={thirdPartyCourierTermsAccepted} onChange={(event) => setThirdPartyCourierTermsAccepted(event.target.checked)} /><span>I understand and agree to these third-party courier terms.</span></label></div><div className="terms-actions"><button className="button" type="button" onClick={handleCancelThirdPartyDelivery}>Cancel</button><button className="button button-primary" type="button" onClick={handleProceedWithThirdPartyCourier} disabled={!thirdPartyCourierTermsAccepted}>Proceed with Order</button></div></div></div>}
    </section>
  );
}
