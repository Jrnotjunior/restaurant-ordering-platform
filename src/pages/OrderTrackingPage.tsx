import { useEffect, useState } from 'react';
import { getOrderStatus, type OrderStatus } from '../services/orderRepository';
import { supabase } from '../services/supabaseClient';
import '../styles/order-tracking.css';

type OrderTrackingPageProps = {
  orderNumber: string;
};

type CustomerStatus = OrderStatus | 'out_for_delivery';

const steps: Array<{ key: CustomerStatus; label: string; description: string }> = [
  { key: 'pending', label: 'Order Received', description: 'Your order has been received by the restaurant.' },
  { key: 'confirmed', label: 'Confirmed', description: 'The restaurant has confirmed your order.' },
  { key: 'preparing', label: 'Preparing', description: 'The kitchen is preparing your food.' },
  { key: 'ready', label: 'Ready', description: 'Your order is ready.' },
  { key: 'out_for_delivery', label: 'Out for delivery', description: 'Your rider is on the way to you.' },
  { key: 'completed', label: 'Completed', description: 'Your order has been delivered.' },
];

const statusOrder: CustomerStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed'];

export function OrderTrackingPage({ orderNumber }: OrderTrackingPageProps) {
  const [order, setOrder] = useState<Awaited<ReturnType<typeof getOrderStatus>> | null>(null);
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await getOrderStatus(orderNumber);
        if (!cancelled) {
          setOrder(result);
          setError('');
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load this order.');
      }
    }

    void load();

    const client = supabase;
    if (!client) {
      setRealtimeStatus('error');
      return () => {
        cancelled = true;
      };
    }

    const channel = client
      .channel(`order-tracking:${orderNumber}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `order_number=eq.${orderNumber}`,
        },
        () => {
          void load();
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('error');
      });

    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [orderNumber]);

  if (error) {
    return <section className="order-tracking-page"><div className="order-tracking-card"><p className="eyebrow">Order tracking</p><h1>We couldn't load your order.</h1><p>{error}</p><a className="button button-primary" href="./">Back to Home</a></div></section>;
  }

  if (!order) {
    return <section className="order-tracking-page"><div className="order-tracking-card"><p className="eyebrow">Order tracking</p><h1>Loading your order…</h1><p>Please wait while we retrieve the latest status.</p></div></section>;
  }

  // Restaurant uses "confirmed" for orders that have entered the kitchen.
  // The customer-facing timeline should show that stage as "Preparing".
  const isCancelled = order.status === 'cancelled';
  const customerStatus: CustomerStatus = order.deliveryStatus === 'delivered'
    ? 'completed'
    : (order.deliveryStatus === 'delivering' || order.deliveryStatus === 'out_for_delivery')
      ? 'out_for_delivery'
      : order.status === 'confirmed'
        ? 'preparing'
        : order.status;
  const currentIndex = statusOrder.indexOf(customerStatus);
  const riderAssigned = order.orderType === 'delivery' && Boolean(order.riderName && order.riderPhone);
  const deliveryStatusLabel = order.deliveryStatus === 'out_for_delivery'
    ? 'Out for delivery'
    : order.deliveryStatus === 'delivered'
      ? 'Delivered'
      : 'Rider assigned';

  return (
    <section className="order-tracking-page">
      <div className="order-tracking-card">
        <div className="order-tracking-header">
          <div>
            <p className="eyebrow">Order tracking</p>
            <h1>Order #{order.orderNumber}</h1>
            <p className="order-tracking-subtitle">Track your order from confirmation to completion.</p>
          </div>
          <span className={`order-tracking-live-status is-${realtimeStatus}`}>
            <span className="order-tracking-live-dot" />
            {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        </div>

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
            <p className="order-rider-message">Hi! I'm {order.riderName}, and I'll be delivering your order shortly. You can contact me at {order.riderPhone} if you need assistance.</p>
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
