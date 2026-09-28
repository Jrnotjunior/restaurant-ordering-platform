type OrderConfirmationPageProps = {
  orderNumber: string;
  paymentMethod: 'cash' | 'gcash';
  total: number;
  onReturnHome: () => void;
};

export function OrderConfirmationPage({
  orderNumber,
  paymentMethod,
  total,
  onReturnHome,
}: OrderConfirmationPageProps) {
  const paymentMessage = paymentMethod === 'gcash'
    ? 'Your order is recorded as pending payment. Online payment instructions will be connected when the payment gateway is integrated.'
    : 'Your order is recorded as pending. Please pay in cash when your order is received or collected.';

  return (
    <section className="order-confirmation-page">
      <div className="order-confirmation-card">
        <p className="eyebrow">Order received</p>
        <h1>Thank you for your order.</h1>
        <p className="order-confirmation-copy">
          Your order has been created and sent to the restaurant order queue.
        </p>

        <div className="order-confirmation-number">
          <span>Order number</span>
          <strong>{orderNumber}</strong>
        </div>

        <div className="order-confirmation-total">
          <span>Order total</span>
          <strong>₱{total.toFixed(2)}</strong>
        </div>

        <p className="order-confirmation-payment">{paymentMessage}</p>

        <button className="button button-primary" type="button" onClick={onReturnHome}>
          Back to Home
        </button>
      </div>
    </section>
  );
}
