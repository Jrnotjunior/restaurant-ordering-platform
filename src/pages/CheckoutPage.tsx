import { useMemo, useState } from 'react';
import type { RestaurantProduct } from '../types/menu';
import { createOrder } from '../services/orderRepository';
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

export function CheckoutPage({ items }: CheckoutPageProps) {
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>('');
  const [showPayment, setShowPayment] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [confirmedOrder, setConfirmedOrder] = useState<ConfirmedOrder | null>(null);

  const subtotal = useMemo(
    () => items.reduce((total, item) => total + item.product.price * item.quantity, 0),
    [items],
  );

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
    && (!isDelivery || address.trim());

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

      const restaurantId = items[0].product.restaurantId;
      const createdOrder = await createOrder({
        restaurantId,
        customerName: customerName.trim(),
        mobileNumber: mobileNumber.trim(),
        orderType,
        tableNumber: tableNumber.trim(),
        deliveryAddress: address.trim(),
        notes: notes.trim(),
        paymentMethod,
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
                  <input type="radio" name="orderType" value={type.value} checked={orderType === type.value} onChange={() => { setOrderType(type.value); setShowPayment(false); setPaymentMethod(''); setSubmitError(''); }} />
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
              <legend>Delivery address</legend>
              <label>
                <span>Complete address</span>
                <textarea value={address} onChange={(event) => setAddress(event.target.value)} placeholder="House/building, street, barangay, city" rows={4} required />
              </label>
              <p className="checkout-hint">We will add the Philippine address dropdowns and delivery-radius check in the next checkout step.</p>
            </fieldset>
          ) : null}

          {isDineIn ? (
            <fieldset className="checkout-section">
              <legend>Dine-in details</legend>
              <label>
                <span>Table number</span>
                <input type="text" value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} inputMode="numeric" placeholder="e.g. 12" required />
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
              <p className="checkout-hint">Your order is saved as pending until the restaurant confirms it. Online payment processing will be connected separately.</p>
            </fieldset>
          )}
        </form>

        <aside className="checkout-summary">
          <h2>Order summary</h2>
          <div className="checkout-summary-items">
            {items.map((item) => (
              <div className="checkout-summary-item" key={item.product.id}>
                <span>{item.quantity} × {item.product.name}</span>
                <strong>₱{(item.product.price * item.quantity).toFixed(2)}</strong>
              </div>
            ))}
          </div>
          <div className="checkout-summary-row">
            <span>Subtotal</span>
            <strong>₱{subtotal.toFixed(2)}</strong>
          </div>
          <p>Delivery fee, if applicable, will be calculated after the delivery address is validated.</p>
        </aside>
      </div>
    </section>
  );
}
