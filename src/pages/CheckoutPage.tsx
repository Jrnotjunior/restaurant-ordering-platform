import { useMemo, useState } from 'react';
import type { RestaurantProduct } from '../types/menu';

type CartItem = {
  product: RestaurantProduct;
  quantity: number;
};

type OrderType = 'delivery' | 'pickup' | 'dine_in';

type CheckoutPageProps = {
  items: CartItem[];
};

const orderTypes: Array<{ value: OrderType; label: string; description: string }> = [
  { value: 'delivery', label: 'Delivery', description: 'Have the restaurant deliver your order.' },
  { value: 'pickup', label: 'Pickup', description: 'Collect your order from the restaurant. This includes take-out.' },
  { value: 'dine_in', label: 'Dine-in', description: 'Order from your phone while eating at the restaurant.' },
];

export function CheckoutPage({ items }: CheckoutPageProps) {
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [customerName, setCustomerName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const subtotal = useMemo(
    () => items.reduce((total, item) => total + item.product.price * item.quantity, 0),
    [items],
  );

  const isDineIn = orderType === 'dine_in';
  const isDelivery = orderType === 'delivery';
  const canContinue = Boolean(customerName.trim() && mobileNumber.trim())
    && (!isDineIn || tableNumber.trim())
    && (!isDelivery || address.trim());

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
                  <input
                    type="radio"
                    name="orderType"
                    value={type.value}
                    checked={orderType === type.value}
                    onChange={() => setOrderType(type.value)}
                  />
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
                <input
                  type="text"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  autoComplete="name"
                  placeholder="Your name"
                  required
                />
              </label>
              <label>
                <span>Mobile number</span>
                <input
                  type="tel"
                  value={mobileNumber}
                  onChange={(event) => setMobileNumber(event.target.value)}
                  autoComplete="tel"
                  placeholder="09XXXXXXXXX"
                  required
                />
              </label>
            </div>
          </fieldset>

          {isDelivery ? (
            <fieldset className="checkout-section">
              <legend>Delivery address</legend>
              <label>
                <span>Complete address</span>
                <textarea
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="House/building, street, barangay, city"
                  rows={4}
                  required
                />
              </label>
              <p className="checkout-hint">We will add the Philippine address dropdowns and delivery-radius check in the next checkout step.</p>
            </fieldset>
          ) : null}

          {isDineIn ? (
            <fieldset className="checkout-section">
              <legend>Dine-in details</legend>
              <label>
                <span>Table number</span>
                <input
                  type="text"
                  value={tableNumber}
                  onChange={(event) => setTableNumber(event.target.value)}
                  placeholder="e.g. 12"
                  required
                />
              </label>
            </fieldset>
          ) : null}

          <fieldset className="checkout-section">
            <legend>Order notes <span className="optional-label">Optional</span></legend>
            <label>
              <span>Special instructions</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add a note for the restaurant"
                rows={3}
              />
            </label>
          </fieldset>

          <button className="button button-primary checkout-submit" type="submit" disabled={!canContinue}>
            Continue to Payment
          </button>
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
          <div className="cart-summary-row">
            <span>Subtotal</span>
            <strong>₱{subtotal.toFixed(2)}</strong>
          </div>
          <p>Delivery fee, if applicable, will be calculated after the delivery address is validated.</p>
        </aside>
      </div>
    </section>
  );
}
