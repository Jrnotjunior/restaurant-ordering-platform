import { useEffect, useState } from 'react';
import { getOrderStatus, type OrderStatus } from '../services/orderRepository';
import '../styles/order-tracking.css';

type OrderTrackingPageProps = {
  orderNumber: string;
};

const steps: Array<{ key: OrderStatus; label: string; description: string }> = [
  { key: 'pending', label: 'Order Received', description: 'Your order has been received by the restaurant.' },
  { key: 'confirmed', label: 'Confirmed', description: 'The restaurant has confirmed your order.' },
  { key: 'preparing', label: 'Preparing', description: 'The kitchen is preparing your food.' },
  { key: 'ready', label: 'Ready', description: 'Your order is ready.' },
  { key: 'completed', label: 'Completed', description: 'Your order has been completed.' },
];

const statusOrder: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];

export function OrderTrackingPage({ orderNumber }: OrderTrackingPageProps) {
  const [order, setOrder] = useState<Awaited<ReturnType<typeof getOrderStatus>> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await getOrderStatus(orderNumber);
        if (!cancelled) setOrder(result);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load this order.');
      }
    }

    void load();
    const timer = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [orderNumber]);

  if (error) {
    return <section className="order-tracking-page"><div className="order-tracking-card"><p className="eyebrow">Order tracking</p><h1>We couldn't load your order.</h1><p>{error}</p><a className="button button-primary" href="./">Back to Home</a></div></section>;
  }

  if (!order) {
    return <section className="order-tracking-page"><div className="order-tracking-card"><p className="eyebrow">Order tracking</p><h1>Loading your order…</h1><p>Please wait while we retrieve the latest status.</p></div></section>;
  }

  const currentIndex = statusOrder.indexOf(order.status);
  const isCancelled = order.status === 'cancelled';
  const riderAssigned = order.orderType === 'delivery' && Boolean(order.riderName && order.riderPhone);
  const deliveryStatusLabel = order.deliveryStatus === 'out_for_delivery'
    ? 'Out for delivery'
    : order.deliveryStatus === 'delivered'
      ? 'Delivered'
      : 'Rider assigned';

  return (
    <section className="order-tracking-page">
      <div className="order-tracking-card">
        <p className="eyebrow">Order tracking</p>
        <h1>Order #{order.orderNumber}</h1>
        <div className="order-tracking-total"><span>Total</span><strong>₱{Number(order.total).toFixed(2)}</strong></div>

        {isCancelled ? (
          <div className="order-tracking-cancelled"><strong>Order cancelled</strong><span>This order has been cancelled by the restaurant or customer.</span></div>
        ) : (
          <div className="order-status-timeline" aria-label="Order status">
            {steps.map((step, index) => {
              const complete = index <= currentIndex;
              const current = index === currentIndex;
              return (
                <div className={`order-status-step ${complete ? 'is-complete' : ''} ${current ? 'is-current' : ''}`} key={step.key}>
                  <div className="order-status-marker">{complete ? '✓' : index + 1}</div>
                  <div><strong>{step.label}</strong><p>{step.description}</p></div>
                </div>
              );
            })}
          </div>
        )}

        {riderAssigned && !isCancelled && (
          <section className="order-rider-card" aria-label="Assigned rider">
            <div className="order-rider-card-header">
              <div>
                <p className="order-rider-label">Your rider</p>
                <h2>{order.riderName}</h2>
              </div>
              <span className="order-rider-status">{deliveryStatusLabel}</span>
            </div>
            <p className="order-rider-message">Hi! I'm {order.riderName}, and I'll be the one delivering your order. You can contact me if you need assistance.</p>
            <a className="order-rider-phone" href={`tel:${order.riderPhone}`} aria-label={`Call ${order.riderName}`}>
              <span>📞</span>{order.riderPhone}
            </a>
            <div className="order-rider-actions">
              <a className="button button-primary" href={`tel:${order.riderPhone}`}>Call Rider</a>
              <a className="button button-secondary" href={`sms:${order.riderPhone}`}>Text Rider</a>
            </div>
          </section>
        )}

        <div className="order-tracking-meta">
          <span>{order.orderType === 'dine_in' ? 'Dine-in' : order.orderType === 'pickup' ? 'Pickup / Take-out' : 'Delivery'}</span>
          <span>{order.paymentMethod === 'gcash' ? 'GCash' : 'Cash'}</span>
        </div>
      </div>
    </section>
  );
}
