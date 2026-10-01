import '../styles/order-confirmation.css';

type OrderConfirmationPageProps = {
  orderNumber: string;
  paymentMethod: 'cash' | 'gcash';
  orderType: 'delivery' | 'pickup' | 'dine_in';
  total: number;
  onReturnHome: () => void;
};

export function OrderConfirmationPage({ orderNumber, paymentMethod, orderType, total, onReturnHome }: OrderConfirmationPageProps) {
  const paymentMessage = paymentMethod === 'gcash'
    ? 'Your order is recorded as pending payment. Online payment instructions will be shown when the payment gateway is integrated.'
    : orderType === 'dine_in'
      ? 'Please pay the cashier at the restaurant counter. Your order will enter the kitchen after the cashier confirms your payment.'
      : 'Your order is recorded as pending. Please pay in cash when your order is received or collected.';

  function trackOrder() {
    window.location.hash = `#order/${encodeURIComponent(orderNumber)}`;
  }

  return (
    <section className="order-confirmation-page">
      <div className="order-confirmation-card">
        <p className="eyebrow">Order received</p>
        <h1>Thank you for your order.</h1>
        <p className="order-confirmation-copy">Your order has been created and is now waiting for restaurant confirmation.</p>
        {orderType === 'dine_in' && (
          <div className="order-confirmation-counter">
            <strong>Show this order number to the cashier</strong>
            <span>Give the cashier your order number so they can find your order and confirm your payment.</span>
          </div>
        )}
        <div className="order-confirmation-number"><span>Order number</span><strong>{orderNumber}</strong></div>
        <div className="order-confirmation-total"><span>Order total</span><strong>₱{total.toFixed(2)}</strong></div>
        <p className="order-confirmation-payment">{paymentMessage}</p>
        <div className="order-confirmation-actions">
          <button className="button button-primary" type="button" onClick={trackOrder}>Track My Order</button>
          <button className="button button-secondary" type="button" onClick={onReturnHome}>Back to Home</button>
        </div>
      </div>
    </section>
  );
}
