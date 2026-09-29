import { useEffect, useMemo, useState } from 'react';
import type { RestaurantProduct } from '../types/menu';
import { createOrder } from '../services/orderRepository';
import { getRestaurantDeliveryZones, type RestaurantDeliveryZone } from '../services/restaurantSettingsRepository';
import { useRestaurant } from '../components/RestaurantProvider';
import { OrderConfirmationPage } from './OrderConfirmationPage';
import '../styles/checkout-mobile.css';

type CartItem = {
  product: RestaurantProduct;
  quantity: number;
};

type OrderType = 'delivery' | 'pickup' | 'dine_in';
type PaymentMethod = 'cash' | 'gcash';

type CheckoutPageProps = {
  items: CartItem[];
};

type ConfirmedOrder = {
  orderNumber: string;
  paymentMethod: PaymentMethod;
  total: number;
};

const orderTypes: Array<{ value: OrderType; label: string; description: string }> = [
  { value: 'delivery', label: 'Delivery', description: 'Have the restaurant deliver your order.' },
  { value: 'pickup', label: 'Pickup', description: 'Collect your order from the restaurant. This includes take-out.' },
  { value: 'dine_in', label: 'Dine-in', description: 'Order from your phone while eating at the restaurant.' },
];

const paymentMethods: Array<{ value: PaymentMethod; label: string; description: string }> = [
  { value: 'cash', label: 'Cash', description: 'Pay in cash when your order is received or collected.' },
  { value: 'gcash', label: 'GCash', description: 'Create the order first. Payment gateway instructions will be connected next.' },
];

const outsideDeliveryAreaMessage = 'The address is not within the store delivery area. If you want to proceed, please book your own delivery courier like Lalamove or Grab Express.';
const outsideCityMessage = 'We currently deliver only within selected barangays in Valenzuela City. If you are outside Valenzuela, you can proceed using your own courier.';
const thirdPartyCourierNote = 'THIRD-PARTY COURIER: Customer is responsible for booking and paying the delivery courier (such as Lalamove or Grab Express). The restaurant will prepare the food for courier pickup at the listed restaurant pickup point.';

function normalizeBarangay(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeCity(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isValenzuelaCity(value: string): boolean {
  const normalized = normalizeCity(value);
  return normalized === 'valenzuela' || normalized === 'valenzuela city';
}

export function CheckoutPage({ items }: CheckoutPageProps) {
  const restaurant = useRestaurant();
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('');
  const [address, setAddress] = useState('');
  const [deliveryBarangay, setDeliveryBarangay] = useState('');
  const [deliveryZones, setDeliveryZones] = useState<RestaurantDeliveryZone[]>([]);
  const [loadingDeliveryZones, setLoadingDeliveryZones] = useState(false);
  const [deliveryZonesError, setDeliveryZonesError] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [showPayment, setShowPayment] = useState(false);
  const [showDeliveryTerms, setShowDeliveryTerms] = useState(false);
  const [thirdPartyCourierDelivery, setThirdPartyCourierDelivery] = useState(false);
  const [promptedOutsideCity, setPromptedOutsideCity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmedOrder | null>(null);

  const restaurantId = items[0]?.product.restaurantId ?? '';
  const restaurantPickupPoint = restaurant.locationText?.trim() ?? '';

  useEffect(() => {
    if (!restaurantId || orderType !== 'delivery') {
      setDeliveryZones([]);
      setDeliveryCity('');
      setDeliveryBarangay('');
      setDeliveryZonesError('');
      setLoadingDeliveryZones(false);
      setThirdPartyCourierDelivery(false);
      setShowDeliveryTerms(false);
      setPromptedOutsideCity('');
      return;
    }

    let cancelled = false;
    setLoadingDeliveryZones(true);
    setDeliveryZonesError('');

    void getRestaurantDeliveryZones(restaurantId)
      .then((zones) => {
        if (cancelled) return;
        setDeliveryZones(zones);
      })
      .catch((error) => {
        if (cancelled) return;
        setDeliveryZones([]);
        setDeliveryBarangay('');
        setDeliveryZonesError(error instanceof Error ? error.message : 'Unable to load delivery areas.');
      })
      .finally(() => {
        if (!cancelled) setLoadingDeliveryZones(false);
      });

    return () => {
      cancelled = true;
    };
  }, [restaurantId, orderType]);

  const subtotal = useMemo(
    () => items.reduce((total, item) => total + item.product.price * item.quantity, 0),
    [items],
  );

  const cityIsSupported = isValenzuelaCity(deliveryCity);

  const selectedDeliveryZone = useMemo(() => {
    if (!cityIsSupported || thirdPartyCourierDelivery) return null;

    const normalizedInput = normalizeBarangay(deliveryBarangay);
    if (!normalizedInput) return null;

    return deliveryZones.find((zone) => normalizeBarangay(zone.barangay) === normalizedInput) ?? null;
  }, [cityIsSupported, deliveryZones, deliveryBarangay, thirdPartyCourierDelivery]);

  const barangaySuggestions = useMemo(() => {
    if (!cityIsSupported || thirdPartyCourierDelivery) return [];

    const normalizedInput = normalizeBarangay(deliveryBarangay);
    if (!normalizedInput || selectedDeliveryZone) return [];

    return deliveryZones
      .filter((zone) => normalizeBarangay(zone.barangay).startsWith(normalizedInput))
      .slice(0, 6);
  }, [cityIsSupported, deliveryZones, deliveryBarangay, selectedDeliveryZone, thirdPartyCourierDelivery]);

  const deliveryFee = orderType === 'delivery' && !thirdPartyCourierDelivery
    ? Number(selectedDeliveryZone?.shippingFee ?? 0)
    : 0;
  const deliveryAreaIsSupported = orderType !== 'delivery' || thirdPartyCourierDelivery || Boolean(selectedDeliveryZone?.isSupported);
  const barangayMatchesConfiguredZone = Boolean(selectedDeliveryZone);

  if (confirmedOrder) {
    return (
      <OrderConfirmationPage
        orderNumber={confirmedOrder.orderNumber}
        paymentMethod={confirmedOrder.paymentMethod}
        total={confirmedOrder.total}
        onReturnHome={() => window.location.hash = ''}
      />
    );
  }

  const isDineIn = orderType === 'dine_in';
  const isDelivery = orderType === 'delivery';
  const canContinue = items.length > 0
    && Boolean(customerName.trim() && mobileNumber.trim())
    && (!isDineIn || tableNumber.trim())
    && (!isDelivery || (
      thirdPartyCourierDelivery
        ? Boolean(restaurantPickupPoint)
        : cityIsSupported
          && address.trim()
          && deliveryBarangay.trim()
          && barangayMatchesConfiguredZone
          && selectedDeliveryZone
          && deliveryAreaIsSupported
          && !loadingDeliveryZones
    ));

  function resetDeliveryPaymentState() {
    setShowPayment(false);
    setPaymentMethod('');
    setSubmitError('');
  }

  function handleCityBlur() {
    const normalizedCity = normalizeCity(deliveryCity);
    if (!normalizedCity || isValenzuelaCity(deliveryCity) || thirdPartyCourierDelivery) return;
    if (normalizedCity === promptedOutsideCity) return;

    setPromptedOutsideCity(normalizedCity);
    setShowDeliveryTerms(true);
  }

  function handleCancelThirdPartyDelivery() {
    setShowDeliveryTerms(false);
    setThirdPartyCourierDelivery(false);
    setDeliveryCity('');
    setDeliveryBarangay('');
    setAddress('');
    resetDeliveryPaymentState();
  }

  function handleProceedWithThirdPartyCourier() {
    setShowDeliveryTerms(false);
    setThirdPartyCourierDelivery(true);
    setDeliveryBarangay('');
    setAddress('');
    setPaymentMethod('');
    setSubmitError('');
    setShowPayment(true);
    window.requestAnimationFrame(() => {
      document.getElementById('payment-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function handleContinueToPayment() {
    if (!canContinue) return;
    setSubmitError('');
    setShowPayment(true);
    window.requestAnimationFrame(() => {
      document.getElementById('payment-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function handlePlaceOrder() {
    if (!paymentMethod || items.length === 0 || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError('');

    try {
      const restaurantIds = new Set(items.map((item) => item.product.restaurantId));
      if (restaurantIds.size !== 1) {
        throw new Error('Your cart contains items from different restaurants. Please clear your cart and try again.');
      }

      if (isDelivery && thirdPartyCourierDelivery && !restaurantPickupPoint) {
        throw new Error('The restaurant pickup address is not configured yet. Please contact the restaurant.');
      }

      if (isDelivery && !thirdPartyCourierDelivery && !cityIsSupported) {
        throw new Error(outsideCityMessage);
      }

      if (isDelivery && !thirdPartyCourierDelivery && (!selectedDeliveryZone || !selectedDeliveryZone.isSupported)) {
        throw new Error(outsideDeliveryAreaMessage);
      }

      const restaurantId = items[0].product.restaurantId;
      const finalNotes = [
        notes.trim(),
        isDelivery && thirdPartyCourierDelivery ? thirdPartyCourierNote : '',
      ].filter(Boolean).join('\n\n');

      const createdOrder = await createOrder({
        restaurantId,
        customerName: customerName.trim(),
        mobileNumber: mobileNumber.trim(),
        orderType,
        tableNumber: tableNumber.trim(),
        deliveryBarangay: isDelivery && !thirdPartyCourierDelivery ? deliveryBarangay.trim() : '',
        deliveryAddress: isDelivery
          ? thirdPartyCourierDelivery
            ? restaurantPickupPoint
            : [deliveryCity.trim(), deliveryBarangay.trim(), address.trim()].filter(Boolean).join(', ')
          : address.trim(),
        notes: finalNotes,
        paymentMethod,
        isThirdPartyCourier: isDelivery && thirdPartyCourierDelivery,
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
      });

      setConfirmedOrder({
        orderNumber: createdOrder.orderNumber,
        paymentMethod,
        total: createdOrder.total,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'We could not create your order. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="checkout-page">
      <style>{`
        .third-party-courier-card{display:grid;gap:12px;padding:16px;border:1px solid #d9dee7;border-radius:14px;background:#f8fafc}
        .third-party-courier-card strong{font-size:15px;color:#0f172a}
        .third-party-courier-card p{margin:0;color:#475569;line-height:1.5}
        .third-party-courier-card .pickup-label{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#64748b}
        .third-party-courier-card .pickup-address{font-weight:700;color:#0f172a}
        .third-party-courier-card .pickup-callout{padding:10px 12px;border-radius:10px;background:#fff;border:1px solid #e2e8f0;font-weight:700;color:#0f172a}
        .courier-payment-note{margin:12px 0 0;padding:12px 14px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569;line-height:1.5}
        .delivery-terms-backdrop{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.58);backdrop-filter:blur(4px)}
        .delivery-terms-modal{width:min(560px,100%);max-height:min(86vh,720px);overflow:auto;background:#fff;border-radius:18px;box-shadow:0 24px 70px rgba(15,23,42,.28);padding:28px;color:#0f172a}
        .delivery-terms-modal h2{margin:0 0 8px;font-size:24px}
        .delivery-terms-modal .terms-intro{margin:0 0 18px;color:#64748b;line-height:1.55}
        .delivery-terms-modal .terms-box{display:grid;gap:12px;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}
        .delivery-terms-modal .terms-box p{margin:0;color:#334155;line-height:1.55}
        .delivery-terms-modal .terms-box strong{color:#0f172a}
        .delivery-terms-modal .terms-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
        @media(max-width:560px){.delivery-terms-backdrop{padding:12px;align-items:flex-end}.delivery-terms-modal{max-height:92vh;border-radius:18px 18px 12px 12px;padding:22px}.delivery-terms-modal .terms-actions{flex-direction:column-reverse}.delivery-terms-modal .terms-actions .button{width:100%}}
      `}</style>

      <div className="menu-intro">
        <p className="eyebrow">Checkout</p>
        <h1>How would you like your order?</h1>
        <p>Choose how you will receive your food, then provide the details we need.</p>
      </div>

      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={(event) => event.preventDefault()}>
          <fieldset className="checkout-section">
            <legend>Order type</legend>
            <div className="order-type-grid">
              {orderTypes.map((type) => (
                <label className={`order-type-card ${orderType === type.value ? 'is-selected' : ''}`} key={type.value}>
                  <input type="radio" name="orderType" value={type.value} checked={orderType === type.value} onChange={() => { setOrderType(type.value); resetDeliveryPaymentState(); }} />
                  <span className="order-type-content">
                    <strong>{type.label}</strong>
                    <span>{type.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="checkout-section">
            <legend>Customer information</legend>
            <div className="checkout-fields">
              <label>
                <span>Full name</span>
                <input type="text" value={customerName} onChange={(event) => setCustomerName(event.target.value)} autoComplete="name" placeholder="Your name" required />
              </label>
              <label>
                <span>Mobile number</span>
                <input type="tel" value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value)} autoComplete="tel" inputMode="tel" placeholder="09XXXXXXXXX" required />
              </label>
            </div>
          </fieldset>

          {isDelivery ? (
            <fieldset className="checkout-section">
              <legend>{thirdPartyCourierDelivery ? 'Third-party courier delivery' : 'Delivery address'}</legend>
              {deliveryZonesError ? <p className="checkout-error" role="alert">{deliveryZonesError}</p> : null}

              {thirdPartyCourierDelivery ? (
                <div className="third-party-courier-card">
                  <div>
                    <strong>Restaurant pickup point</strong>
                    <p className="pickup-label">Give this to your courier.</p>
                  </div>
                  <p className="pickup-address">{restaurantPickupPoint || 'Restaurant pickup address is not configured.'}</p>
                  <div className="pickup-callout">Your destination address is not entered here. Provide your own destination address directly to Lalamove, Grab Express, or your chosen courier.</div>
                  <p>You are responsible for booking and paying the third-party courier.</p>
                </div>
              ) : (
                <div className="delivery-address-fields">
                  <label>
                    <span>City</span>
                    <input
                      type="text"
                      value={deliveryCity}
                      onChange={(event) => {
                        setDeliveryCity(event.target.value);
                        setDeliveryBarangay('');
                        setAddress('');
                        setThirdPartyCourierDelivery(false);
                        resetDeliveryPaymentState();
                      }}
                      onBlur={handleCityBlur}
                      autoComplete="address-level2"
                      placeholder="Enter your city"
                      required
                    />
                  </label>

                  {cityIsSupported ? (
                    <label>
                      <span>Barangay</span>
                      <div className="barangay-input-wrap">
                        <input
                          type="text"
                          value={deliveryBarangay}
                          onChange={(event) => {
                            setDeliveryBarangay(event.target.value);
                            resetDeliveryPaymentState();
                          }}
                          autoComplete="address-level3"
                          placeholder="Enter your barangay"
                          disabled={loadingDeliveryZones || deliveryZones.length === 0}
                          required
                        />
                        {barangaySuggestions.length > 0 ? (
                          <div className="barangay-suggestions" role="listbox" aria-label="Barangay suggestions">
                            {barangaySuggestions.map((zone) => (
                              <button
                                className="barangay-suggestion"
                                key={zone.id}
                                type="button"
                                role="option"
                                onClick={() => {
                                  setDeliveryBarangay(zone.barangay);
                                  resetDeliveryPaymentState();
                                }}
                              >
                                <span>{zone.barangay}</span>
                                <small>{zone.isSupported ? `₱${zone.shippingFee.toFixed(2)} delivery fee` : 'Outside delivery area'}</small>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </label>
                  ) : null}

                  {cityIsSupported && deliveryBarangay.trim() ? (
                    <label>
                      <span>Complete address</span>
                      <textarea value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Complete delivery address" rows={4} required />
                    </label>
                  ) : null}
                </div>
              )}

              {!thirdPartyCourierDelivery && deliveryCity.trim() && !cityIsSupported ? <p className="checkout-error" role="alert">{outsideCityMessage}</p> : null}
              {!thirdPartyCourierDelivery && loadingDeliveryZones ? <p className="checkout-hint">Loading delivery areas…</p> : null}
              {!thirdPartyCourierDelivery && !loadingDeliveryZones && cityIsSupported && !deliveryZonesError && deliveryZones.length === 0 ? <p className="checkout-error" role="alert">This restaurant has not configured any delivery areas yet.</p> : null}
              {!thirdPartyCourierDelivery && !loadingDeliveryZones && cityIsSupported && deliveryBarangay.trim() && !selectedDeliveryZone ? <p className="checkout-error" role="alert">{outsideDeliveryAreaMessage}</p> : null}
              {!thirdPartyCourierDelivery && selectedDeliveryZone && !selectedDeliveryZone.isSupported ? <p className="checkout-error" role="alert">{outsideDeliveryAreaMessage}</p> : null}
              {!thirdPartyCourierDelivery && selectedDeliveryZone?.isSupported ? <p className="checkout-hint">Delivery fee: ₱{deliveryFee.toFixed(2)}</p> : null}
            </fieldset>
          ) : null}

          {isDineIn ? (
            <fieldset className="checkout-section">
              <legend>Dine-in details</legend>
              <label>
                <span>Table number</span>
                <input type="text" value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} inputMode="numeric" placeholder="Table number" required />
              </label>
            </fieldset>
          ) : null}

          <fieldset className="checkout-section">
            <legend>Order notes <span className="optional-label">Optional</span></legend>
            <label>
              <span>Special instructions</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add a note for the restaurant" rows={3} />
            </label>
          </fieldset>

          {!showPayment ? (
            <button className="button button-primary checkout-submit" type="button" disabled={!canContinue} onClick={handleContinueToPayment}>Continue to Payment</button>
          ) : (
            <fieldset className="checkout-section" id="payment-section">
              <legend>Payment method</legend>
              {thirdPartyCourierDelivery ? <p className="courier-payment-note"><strong>Payment first:</strong> complete your payment selection before the order is sent to the restaurant. Your courier is booked and paid for separately by you.</p> : null}
              <div className="order-type-grid">
                {paymentMethods.map((method) => (
                  <label className={`order-type-card ${paymentMethod === method.value ? 'is-selected' : ''}`} key={method.value}>
                    <input type="radio" name="paymentMethod" value={method.value} checked={paymentMethod === method.value} onChange={() => { setPaymentMethod(method.value); setSubmitError(''); }} />
                    <span className="order-type-content">
                      <strong>{method.label}</strong>
                      <span>{method.description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {submitError ? <p className="checkout-error" role="alert">{submitError}</p> : null}
              <button className="button button-primary checkout-submit" type="button" disabled={!paymentMethod || isSubmitting} onClick={handlePlaceOrder}>
                {isSubmitting ? 'Creating Order…' : 'Place Order'}
              </button>
              <p className="checkout-hint">Your order will be created after you select a payment method.</p>
            </fieldset>
          )}
        </form>

        <aside className="checkout-summary">
          <div className="checkout-section">
            <h2>Order summary</h2>
            <div className="checkout-summary-items">
              {items.map((item) => (
                <div className="checkout-summary-row" key={item.product.id}>
                  <span>{item.quantity} × {item.product.name}</span>
                  <strong>₱{(item.product.price * item.quantity).toFixed(2)}</strong>
                </div>
              ))}
            </div>
            <div className="checkout-summary-row">
              <span>Subtotal</span>
              <strong>₱{subtotal.toFixed(2)}</strong>
            </div>
            <div className="checkout-summary-row">
              <span>Delivery fee</span>
              <strong>₱{deliveryFee.toFixed(2)}</strong>
            </div>
            <div className="checkout-summary-total">
              <span>Total</span>
              <strong>₱{(subtotal + deliveryFee).toFixed(2)}</strong>
            </div>
          </div>
        </aside>
      </div>

      {showDeliveryTerms ? (
        <div className="delivery-terms-backdrop" role="presentation">
          <div className="delivery-terms-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-terms-title">
            <h2 id="delivery-terms-title">Delivery Terms</h2>
            <p className="terms-intro">This address is outside Valenzuela City. The restaurant cannot deliver to this destination directly.</p>
            <div className="terms-box">
              <p><strong>Proceed with your own courier.</strong> You may book Lalamove, Grab Express, or another courier to collect your order from the restaurant.</p>
              <p>You are responsible for booking and paying the courier, and for providing the courier with your destination address.</p>
              <p>The restaurant will prepare your order for pickup at its listed restaurant pickup point.</p>
            </div>
            <div className="terms-actions">
              <button className="button" type="button" onClick={handleCancelThirdPartyDelivery}>Cancel</button>
              <button className="button button-primary" type="button" onClick={handleProceedWithThirdPartyCourier}>Proceed with Order</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
