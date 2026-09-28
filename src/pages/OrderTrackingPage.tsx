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

        <div className="order-tracking-meta">
          <span>{order.orderType === 'dine_in' ? 'Dine-in' : order.orderType === 'pickup' ? 'Pickup / Take-out' : 'Delivery'}</span>
          <span>{order.paymentMethod === 'gcash' ? 'GCash' : 'Cash'}</span>
        </div>
      </div>
    </section>
  );
}
