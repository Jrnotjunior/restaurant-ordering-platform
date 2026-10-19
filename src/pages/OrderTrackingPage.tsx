import { useEffect, useState } from 'react';
import { cancelMyPendingOrder, getOrderStatus, hasGuestOrderCancellationToken, subscribeToOrderTrackingChanges, type OrderStatus } from '../modules/ordering/orderService';
import { supabase } from '../services/supabaseClient';
import '../styles/order-tracking.css';

type OrderTrackingPageProps = {
  orderId: string;
  expectedRestaurantId: string | null;
};

const ACTIVE_ORDER_KEY = 'restaurant-ordering-active-order';

type CustomerStatus = OrderStatus | 'out_for_delivery' | 'arrived';

const deliverySteps: Array<{ key: CustomerStatus; label: string; description: string }> = [
  { key: 'pending', label: 'Order Received', description: 'Your order has been received by the restaurant.' },
  { key: 'confirmed', label: 'Confirmed', description: 'The restaurant has confirmed your order.' },
  { key: 'preparing', label: 'Preparing', description: 'The restaurant is preparing your food.' },
  { key: 'ready', label: 'Ready', description: 'Your order is ready.' },
  { key: 'out_for_delivery', label: 'Out for delivery', description: 'Your rider is on the way to you.' },
  { key: 'arrived', label: 'Arrived at customer', description: 'Your rider has arrived at your location.' },
  { key: 'completed', label: 'Completed', description: 'Your order has been delivered.' },
];

const collectionSteps: Array<{ key: CustomerStatus; label: string; description: string }> = [
  { key: 'pending', label: 'Order Received', description: 'Your order has been received by the restaurant.' },
  { key: 'confirmed', label: 'Confirmed', description: 'The restaurant has confirmed your order.' },
  { key: 'preparing', label: 'Preparing', description: 'The kitchen is preparing your food.' },
  { key: 'ready', label: 'Ready for collection', description: 'Your food is ready to collect from the restaurant.' },
  { key: 'completed', label: 'Collected', description: 'Your order has been collected. Thank you!' },
];

const dineInSteps: Array<{ key: CustomerStatus; label: string; description: string }> = [
  { key: 'pending', label: 'Order Received', description: 'Your order has been received by the restaurant.' },
  { key: 'confirmed', label: 'Confirmed', description: 'The restaurant has confirmed your order.' },
  { key: 'preparing', label: 'Preparing', description: 'The kitchen is preparing your food.' },
  { key: 'ready', label: 'Ready to serve', description: 'Your food is ready. Restaurant staff will bring it to your table.' },
  { key: 'completed', label: 'Served', description: 'Your order has been served. Thank you!' },
];

const deliveryStatusOrder: CustomerStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'arrived', 'completed'];
const pickupStatusOrder: CustomerStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];

export function OrderTrackingPage({ orderId, expectedRestaurantId }: OrderTrackingPageProps) {
  const [order, setOrder] = useState<Awaited<ReturnType<typeof getOrderStatus>> | null>(null);
  const [error, setError] = useState('');
  const [realtimeStatus, setRealtimeStatus] = useState<'connecting' | 'live' | 'error'>('connecting');
  const [isAuthenticatedCustomer, setIsAuthenticatedCustomer] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [cancellationError, setCancellationError] = useState('');
  const [cancellationMessage, setCancellationMessage] = useState('');
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);
  const [showNonDeliveryTimeline, setShowNonDeliveryTimeline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTimelineEntitlement() {
      if (!supabase) return;
      const { data, error: entitlementError } = await supabase.rpc(
        'customer_order_tracking_timeline_enabled',
        { p_order_id: orderId },
      );
      if (!cancelled) {
        setShowNonDeliveryTimeline(!entitlementError && data === true);
      }
    }
    void loadTimelineEntitlement();
    return () => { cancelled = true; };
  }, [orderId, expectedRestaurantId]);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    void supabase.auth.getUser().then(({ data }) => {
      if (mounted) setIsAuthenticatedCustomer(Boolean(data.user));
    }).catch(() => {
      if (mounted) setIsAuthenticatedCustomer(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticatedCustomer(Boolean(session?.user));
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let loadInProgress = false;
    let refreshQueued = false;

    async function load() {
      // Keep only one status fetch in flight. If Realtime fires during a fetch,
      // immediately fetch once more afterward instead of discarding a response
      // just because a newer request started but has not completed yet.
      if (loadInProgress) {
        refreshQueued = true;
        return;
      }
      loadInProgress = true;

      try {
        const result = await getOrderStatus(orderId);
        if (expectedRestaurantId && result.restaurantId !== expectedRestaurantId) {
          throw new Error('Order not found on this restaurant storefront.');
        }
        if (!cancelled) {
          setOrder(result);
          if (result.status === 'completed' || result.status === 'cancelled' || result.deliveryStatus === 'delivered' || result.deliveryStatus === 'failed') {
            if (window.localStorage.getItem('restaurant-ordering-active-order-id') === result.orderId) {
              window.localStorage.removeItem('restaurant-ordering-active-order-id');
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
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load this order.');
        }
      } finally {
        loadInProgress = false;
        if (refreshQueued && !cancelled) {
          refreshQueued = false;
          void load();
        }
      }
    }

    void load();

    const unsubscribe = subscribeToOrderTrackingChanges(
      orderId,
      () => {
        void load();
      },
      (status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setRealtimeStatus('error');
      },
    );

    if (!unsubscribe) {
      setRealtimeStatus('error');
      return () => {
        cancelled = true;
      };
    }

    const refreshInterval = window.setInterval(() => {
      void load();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
      unsubscribe();
    };
  }, [orderId]);

  if (error) {
    return <section className="order-tracking-page"><div className="order-tracking-card"><p className="eyebrow">Order tracking</p><h1>We couldn't load your order.</h1><p>{error}</p><a className="button button-primary" href="./">Back to Home</a></div></section>;
  }

  if (!order) {
    return <section className="order-tracking-page"><div className="order-tracking-card"><p className="eyebrow">Order tracking</p><h1>Loading your order…</h1><p>Please wait while we retrieve the latest status.</p></div></section>;
  }

  // Keep confirmation and preparation separate so tracking reflects the actual saved order status.
  const isCancelled = order.status === 'cancelled';
  const customerStatus: CustomerStatus = order.deliveryStatus === 'failed'
    ? 'completed'
    : order.deliveryStatus === 'delivered'
    ? 'completed'
    : (order.deliveryStatus === 'delivering' || order.deliveryStatus === 'out_for_delivery')
      ? 'out_for_delivery'
      : order.deliveryStatus === 'arrived'
        ? 'arrived'
        : order.status;
  const isPickup = order.orderType === 'pickup';
  const isTakeOut = order.orderType === 'take_out';
  const isDineIn = order.orderType === 'dine_in';
  const isCashDineIn = isDineIn && order.paymentMethod === 'cash';
  const isCashTakeOut = isTakeOut && order.paymentMethod === 'cash';
  const isCollectionOrder = isPickup || isTakeOut;
  const isCustomerCourierPickup = isPickup && order.pickupMethod === 'third_party_courier';
  const steps = isDineIn ? dineInSteps : isCollectionOrder ? collectionSteps : deliverySteps;
  const statusOrder = isDineIn || isCollectionOrder ? pickupStatusOrder : deliveryStatusOrder;
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
  const showPickupLocation = isCollectionOrder && !isCancelled && Boolean(storeAddress);
  const guestCancelTokenAvailable = hasGuestOrderCancellationToken(order.orderId);
  const cancellationEligibleStatus = order.status === 'pending' &&
    (order.paymentStatus === 'pending' || order.paymentStatus === 'paid');
  const canCancelOrder = cancellationEligibleStatus &&
    (isAuthenticatedCustomer || guestCancelTokenAvailable);
  const isLegacyGuestOrderWithoutCancelToken = cancellationEligibleStatus &&
    !isAuthenticatedCustomer && !guestCancelTokenAvailable;

  function cancelOrder() {
    if (!order || cancellingOrder) return;
    setCancellationError('');
    setShowCancelConfirmation(true);
  }

  async function confirmCancelOrder() {
    if (!order || cancellingOrder) return;
    setShowCancelConfirmation(false);
    setCancellingOrder(true);
    setCancellationError('');
    setCancellationMessage('');
    try {
      const result = await cancelMyPendingOrder(order.orderId);
      const refreshedOrder = await getOrderStatus(order.orderId);
      setOrder(refreshedOrder);
      // Refund completion can occur just after the cancellation API response.
      // Prefer the refreshed order's authoritative payment status so the message
      // cannot keep saying "being processed" after the refund is already complete.
      setCancellationMessage(refreshedOrder.paymentStatus === 'refunded'
        ? 'Your order has been cancelled and the refund completed successfully.'
        : result.message);
      if (window.localStorage.getItem('restaurant-ordering-active-order-id') === refreshedOrder.orderId) {
        window.localStorage.removeItem('restaurant-ordering-active-order-id');
        window.localStorage.removeItem(ACTIVE_ORDER_KEY);
        window.dispatchEvent(new Event('restaurant-ordering-active-order-change'));
      }
    } catch (cancelError) {
      setCancellationError(cancelError instanceof Error
        ? cancelError.message
        : 'Unable to cancel this order. Please refresh and try again.');
    } finally {
      setCancellingOrder(false);
    }
  }

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

  function formatStoreTime(value: string) {
    const match = value.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return value;
    const hour = Number(match[1]);
    const minute = match[2];
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${period}`;
  }

  function getOrderDayHours() {
    if (!order || !operatingHours || !order.createdAt) return null;
    const date = new Date(order.createdAt);
    if (Number.isNaN(date.getTime())) return null;
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayKey = dayKeys[date.getDay()];
    const hours = operatingHours[dayKey];
    if (!hours) return null;
    const dayLabel = dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
    const value = hours.isOpen
      ? `${formatStoreTime(hours.open)} – ${formatStoreTime(hours.close)}`
      : 'Closed';
    return { dayLabel, value };
  }

  function openStoreLocation() {
    if (!storeAddress) return;
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(storeAddress)}`, '_blank', 'noopener,noreferrer');
  }




  return (
    <section className="order-tracking-page">
      <div className="order-tracking-card">
        {!isCashDineIn && !isCashTakeOut ? (
          <div className="order-tracking-header">
            <div>
              <p className="eyebrow">Order tracking</p>
              <h1>Order #{order.orderNumber}</h1>
              <p className="order-tracking-subtitle">View your order summary and collection details.</p>
            </div>
            <span className={`order-tracking-live-status is-${realtimeStatus}`}>
              <span className="order-tracking-live-dot" />
              {realtimeStatus === 'live' ? 'Live' : realtimeStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            </span>
          </div>
        ) : null}

        {(isCashDineIn || isCashTakeOut) && !isCancelled ? (
          <section className="order-dine-in-number-card" aria-label="Cash order number for cashier">
            <p className="eyebrow">{isCashDineIn ? 'Dine-in' : 'Take-out'} · Tell the cashier</p>
            <strong className="order-dine-in-number">{order.orderNumber}</strong>
            <p>Give this order number to the cashier to help them find your order.</p>
          </section>
        ) : null}
        <details className="order-tracking-details">
          <summary className="order-tracking-section-heading">
            <span className="order-details-title"><span className="eyebrow">Your order</span><strong>Order details</strong></span>
            <span className="order-details-toggle">View details <span className="order-details-chevron" aria-hidden="true">⌄</span></span>
          </summary>
          {order.items.length > 0 ? (
            <div className="order-tracking-items">
              {order.items.map((item) => (
                <div className="order-tracking-item" key={item.id}>
                  <div className="order-tracking-item-name"><strong>{item.productName}</strong><span>{item.quantity} × ₱{item.unitPrice.toFixed(2)}</span></div>
                  <strong className="order-tracking-item-total">₱{item.lineTotal.toFixed(2)}</strong>
                </div>
              ))}
            </div>
          ) : <p className="order-tracking-muted">Item details are unavailable for this order.</p>}
          <div className="order-tracking-billing">
            <h3>Billing summary</h3>
            <div className="order-tracking-billing-row"><span>Subtotal</span><span>₱{order.subtotal.toFixed(2)}</span></div>
            {order.discountAmount > 0 && <div className="order-tracking-billing-row is-discount"><span>Discount</span><span>−₱{order.discountAmount.toFixed(2)}</span></div>}
            {order.loyaltyDiscountAmount > 0 && Math.abs(order.loyaltyDiscountAmount - order.discountAmount) > 0.009 && <div className="order-tracking-billing-row is-discount"><span>Loyalty reward</span><span>−₱{order.loyaltyDiscountAmount.toFixed(2)}</span></div>}
            {order.taxVatRegistered && <>
              <div className="order-tracking-billing-row"><span>VAT ({order.taxVatRate.toFixed(2)}%)</span><span>₱{order.taxVatAmount.toFixed(2)}</span></div>
              {order.taxVatExemptSales > 0 && <div className="order-tracking-billing-row"><span>VAT-exempt sales</span><span>₱{order.taxVatExemptSales.toFixed(2)}</span></div>}
            </>}
            <div className="order-tracking-billing-row"><span>{isCollectionOrder ? 'Collection fee' : isDineIn ? 'Service fee' : 'Delivery fee'}</span><span>₱{order.shippingFee.toFixed(2)}</span></div>
            <div className="order-tracking-billing-row is-total"><strong>Total paid / due</strong><strong>₱{order.total.toFixed(2)}</strong></div>
            <p className="order-tracking-payment-note">{order.paymentStatus === 'paid' ? 'Payment confirmed' : order.paymentStatus === 'refunded' ? 'Payment refunded' : order.paymentStatus === 'failed' ? 'Payment failed' : 'Payment pending'} · {order.paymentMethod === 'gcash' ? 'Online payment' : 'Cash'}</p>
          </div>
          {canCancelOrder ? (
            <div className="order-tracking-cancel order-tracking-cancel--details">
              <button className="button order-cancel-action" type="button" onClick={() => void cancelOrder()} disabled={cancellingOrder}>
                {cancellingOrder ? 'Cancelling…' : 'Cancel order'}
              </button>
            </div>
          ) : null}
          {isLegacyGuestOrderWithoutCancelToken ? (
            <p className="order-tracking-muted order-cancellation-unavailable" role="note">
              This guest order's cancellation token isn't available in this browser. Please reopen the order in the browser where you placed it.
            </p>
          ) : null}
          {cancellationError ? <p className="checkout-error" role="alert">{cancellationError}</p> : null}
          {cancellationMessage ? <p className="checkout-success" role="status">{cancellationMessage}</p> : null}
        </details>

        {showCancelConfirmation ? (
          <div className="order-cancel-modal-backdrop" role="presentation" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !cancellingOrder) setShowCancelConfirmation(false);
          }}>
            <section className="order-cancel-modal" role="dialog" aria-modal="true" aria-labelledby="order-cancel-modal-title" aria-describedby="order-cancel-modal-description">
              <div className="order-cancel-modal-icon" aria-hidden="true">!</div>
              <h2 id="order-cancel-modal-title">Cancel this order?</h2>
              <p id="order-cancel-modal-description">{order.paymentStatus === 'paid' ? 'This order was paid online. Cancelling it will also request a refund to the original payment method. Refund timing depends on the payment provider.' : 'Are you sure you want to cancel this order? This action cannot be undone.'}</p>
              <div className="order-cancel-modal-actions">
                <button className="button order-cancel-modal-confirm" type="button" onClick={() => void confirmCancelOrder()} disabled={cancellingOrder}>
                  {cancellingOrder ? 'Cancelling…' : 'Yes, cancel order'}
                </button>
                <button className="button order-cancel-modal-dismiss" type="button" onClick={() => setShowCancelConfirmation(false)} disabled={cancellingOrder}>
                  Keep order
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {order.deliveryStatus === 'failed' ? (
          <div className="order-tracking-cancelled">
            <strong>Delivery failed</strong>
            <span>{order.deliveryFailureReason ? `Reason: ${order.deliveryFailureReason}. ` : ''}The order was not delivered and no cash payment was collected.</span>
          </div>
        ) : isCancelled ? (
          <div className="order-tracking-cancelled"><strong>Order cancelled</strong><span>This order has been cancelled by the restaurant or customer.</span></div>
        ) : !isCancelled && (order.orderType === 'delivery' || showNonDeliveryTimeline) ? (
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
        ) : null}

        {isCustomerCourierPickup && !isCancelled && order.status !== 'completed' && (
          <div className="order-tracking-cancelled" role="note">
            <strong>Pickup with your own courier</strong>
            <span>Your order is prepared by the restaurant for pickup. Please make sure your courier is available when the order is ready. Courier delays or unavailability after the order is ready are the customer's responsibility.</span>
          </div>
        )}

        {showPickupLocation && !isTakeOut && (
          <section className="order-pickup-location-card order-pickup-location-card--compact" aria-label="Store pickup location">
            <p className="order-rider-label">{isTakeOut ? "TAKE-OUT COLLECTION LOCATION" : "PICKUP LOCATION"}</p>
            <h2>{order.restaurantName}</h2>
            {getOrderDayHours() && (
              <p className="order-pickup-hours-summary order-pickup-hours-summary--centered">
                <strong>Store hours · {getOrderDayHours()?.dayLabel}</strong>
                <span>{getOrderDayHours()?.value}</span>
              </p>
            )}
            <div className="order-pickup-location-actions">
              <button className="button button-primary order-pickup-map-button" type="button" onClick={openStoreLocation}>
                Open in Google Maps
              </button>
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
          <span>{order.orderType === 'dine_in' ? 'Dine-in' : order.orderType === 'take_out' ? 'Take-out' : order.orderType === 'pickup' ? (order.pickupMethod === 'third_party_courier' ? 'Pickup with Your Own Courier' : 'Pickup') : 'Delivery'}</span>
          <span>{order.paymentMethod === 'gcash' ? 'Online Payment' : 'Cash'}</span>
        </div>
      </div>
    </section>
  );
}
