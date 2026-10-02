import { useEffect, useState } from 'react';
import { getOrderStatus, type OrderStatus } from '../services/orderRepository';
import { supabase } from '../services/supabaseClient';
import '../styles/order-tracking.css';

type OrderTrackingPageProps = {
  orderNumber: string;
};

const ACTIVE_ORDER_KEY = 'restaurant-ordering-active-order';

type CustomerStatus = OrderStatus | 'out_for_delivery' | 'arrived';

const deliverySteps: Array<{ key: CustomerStatus; label: string; description: string }> = [
  { key: 'pending', label: 'Order Received', description: 'Your order has been received by the restaurant.' },
  { key: 'confirmed', label: 'Confirmed', description: 'The restaurant has confirmed your order.' },
  { key: 'preparing', label: 'Preparing', description: 'The kitchen is preparing your food.' },
  { key: 'ready', label: 'Ready', description: 'Your order is ready.' },
  { key: 'out_for_delivery', label: 'Out for delivery', description: 'Your rider is on the way to you.' },
  { key: 'arrived', label: 'Arrived at customer', description: 'Your rider has arrived at your location.' },
  { key: 'completed', label: 'Completed', description: 'Your order has been delivered.' },
];

const pickupSteps: Array<{ key: CustomerStatus; label: string; description: string }> = [
  { key: 'pending', label: 'Order Received', description: 'Your order has been received by the restaurant.' },
  { key: 'confirmed', label: 'Confirmed', description: 'The restaurant has confirmed your order.' },
  { key: 'preparing', label: 'Preparing', description: 'The kitchen is preparing your food.' },
  { key: 'ready', label: 'Ready for pickup', description: 'Your order is ready to be picked up.' },
  { key: 'completed', label: 'Picked up', description: 'Your order has been picked up.' },
];

const deliveryStatusOrder: CustomerStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived', 'completed'];
const pickupStatusOrder: CustomerStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];

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
          if (result.status === 'completed' || result.status === 'cancelled' || result.deliveryStatus === 'delivered' || result.deliveryStatus === 'failed') {
            if (window.localStorage.getItem(ACTIVE_ORDER_KEY) === result.orderNumber) {
              window.localStorage.removeItem(ACTIVE_ORDER_KEY);
              window.dispatchEvent(new Event('restaurant-ordering-active-order-change'));
            }
          }
          setError('');

          // Only clear a persisted cart after the online payment for that exact order
          // has been confirmed. A cancelled/failed payment keeps the cart intact.
          const pendingPaymentOrder = window.localStorage.getItem('restaurant-ordering-pending-payment-order');
          if (result.paymentStatus === 'paid' && pendingPaymentOrder === result.orderNumber) {
            window.dispatchEvent(new Event('restaurant-ordering-cart-clear'));
          }
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
      .channel(`customer-order:${orderNumber}`)
      .on(
        'broadcast',
        { event: 'customer_order_changed' },
        () => {
          void load();
        },
      )
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

    const refreshInterval = window.setInterval(() => {
      void load();
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
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
  const customerStatus: CustomerStatus = order.deliveryStatus === 'failed'
    ? 'completed'
    : order.deliveryStatus === 'delivered'
    ? 'completed'
    : (order.deliveryStatus === 'delivering' || order.deliveryStatus === 'out_for_delivery')
      ? 'out_for_delivery'
      : order.deliveryStatus === 'arrived'
        ? 'arrived'
        : order.status === 'confirmed'
        ? 'preparing'
        : order.status;
  const isPickup = order.orderType === 'pickup';
  const steps = isPickup ? pickupSteps : deliverySteps;
  const statusOrder = isPickup ? pickupStatusOrder : deliveryStatusOrder;
  const currentIndex = statusOrder.indexOf(customerStatus);
  const riderAssigned = order.orderType === 'delivery' && Boolean(order.riderName && order.riderPhone);
  const deliveryStatusLabel = order.deliveryStatus === 'delivering' || order.deliveryStatus === 'out_for_delivery'
    ? 'Out for delivery'
    : order.deliveryStatus === 'arrived'
      ? 'Arrived at customer'
      : order.deliveryStatus === 'delivered'
        ? 'Delivered'
        : 'Rider assigned';
  const storeAddress = order.storeAddress;
  const operatingHours = order.operatingHours;
  const showPickupLocation = isPickup && order.status === 'completed' && Boolean(storeAddress);

  function formatOperatingHours() {
    if (!operatingHours) return [];
    return ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      .map((day) => {
        const hours = operatingHours[day];
        if (!hours) return null;
        const label = day.charAt(0).toUpperCase() + day.slice(1);
        return { label, value: hours.isOpen ? `${hours.open}–${hours.close}` : 'Closed' };
      })
      .filter((entry): entry is { label: string; value: string } => Boolean(entry));
  }

  function openStoreLocation() {
    if (!storeAddress) return;
    const query = encodeURIComponent(storeAddress);
    window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank', 'noopener,noreferrer');
  }

  async function copyStoreAddress() {
    if (!storeAddress || !navigator.clipboard) return;
    await navigator.clipboard.writeText(storeAddress);
  }

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

        {order.deliveryStatus === 'failed' ? (
          <div className="order-tracking-cancelled">
            <strong>Delivery failed</strong>
            <span>{order.deliveryFailureReason ? `Reason: ${order.deliveryFailureReason}. ` : ''}The order was not delivered and no cash payment was collected.</span>
          </div>
        ) : isCancelled ? (
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

        {showPickupLocation && (
          <section className="order-pickup-location-card" aria-label="Store pickup location">
            <div className="order-pickup-location-header">
              <div>
                <p className="order-rider-label">Pickup location</p>
                <h2>Pick up your order here</h2>
              </div>
              <span className="order-rider-status">Store</span>
            </div>
            <p className="order-pickup-location-message">Your order is complete. Please pick up your order at our store:</p>
            <strong className="order-pickup-address">{storeAddress}</strong>
            {formatOperatingHours().length > 0 && (
              <div className="order-pickup-hours">
                <strong>Store hours</strong>
                {formatOperatingHours().map((entry) => <span key={entry.label}>{entry.label}: {entry.value}</span>)}
              </div>
            )}
            <div className="order-rider-actions">
              <button className="button button-primary" type="button" onClick={openStoreLocation}>Open / Pin in Google Maps</button>
              <button className="button button-secondary" type="button" onClick={() => void copyStoreAddress()}>Copy Address</button>
            </div>
          </section>
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
          <span>{order.paymentMethod === 'gcash' ? 'Online Payment' : 'Cash'}</span>
        </div>
      </div>
    </section>
  );
}
