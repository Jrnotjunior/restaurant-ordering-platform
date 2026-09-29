import { useState } from 'react';
import { DeliveryNavigation } from '../components/DeliveryNavigation';
import { CustomerContactActions } from '../components/CustomerContactActions';

const previewDelivery = {
  orderNumber: '#1024',
  customerName: 'Juan Dela Cruz',
  mobileNumber: '0917 123 4567',
  address: 'Blk 12 Lot 8, Dalandanan, Valenzuela City',
  total: 350,
  items: [
    { quantity: 2, name: 'Chicken Meal', total: 240 },
    { quantity: 1, name: 'Iced Tea', total: 60 },
    { quantity: 1, name: 'Fries', total: 50 },
  ],
};

const deliveryStatuses = [
  { label: 'Assigned', detail: 'Dispatcher assigned this delivery to you.' },
  { label: 'Out for delivery', detail: 'You are heading to the customer.' },
  { label: 'Delivered', detail: 'The order was delivered to the customer.' },
];

export function RiderDeliveryPage() {
  const [statusIndex, setStatusIndex] = useState(0);
  const currentStatus = deliveryStatuses[statusIndex];
  const isDelivered = statusIndex === deliveryStatuses.length - 1;

  function advanceStatus() {
    if (!isDelivered) setStatusIndex((current) => current + 1);
  }

  return (
    <section className="rider-delivery-page">
      <div className="rider-delivery-preview-banner">
        <span>UI PREVIEW</span>
        <p>This screen uses sample data only. No Supabase data is changed.</p>
      </div>

      <header className="rider-delivery-header">
        <div>
          <p className="eyebrow">My delivery</p>
          <h1>{previewDelivery.orderNumber}</h1>
          <p>Deliver this order to the customer.</p>
        </div>
        <span className="rider-delivery-status">{currentStatus.label}</span>
      </header>

      <div className="rider-delivery-layout">
        <main className="rider-delivery-main">
          <section className="rider-delivery-card">
            <div className="rider-delivery-card-heading">
              <div>
                <p className="rider-delivery-label">Customer</p>
                <h2>{previewDelivery.customerName}</h2>
              </div>
              <span className="rider-delivery-customer-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M5 20c.8-3.4 3.2-5.2 7-5.2s6.2 1.8 7 5.2" />
                </svg>
              </span>
            </div>
            <p className="rider-delivery-phone">{previewDelivery.mobileNumber}</p>
            <CustomerContactActions mobileNumber={previewDelivery.mobileNumber} />
          </section>

          <section className="rider-delivery-card">
            <div className="rider-delivery-card-heading">
              <div>
                <p className="rider-delivery-label">Delivery destination</p>
                <h2>Customer address</h2>
              </div>
              <span className="rider-delivery-location-icon" aria-hidden="true">⌖</span>
            </div>
            <DeliveryNavigation address={previewDelivery.address} />
            <p className="rider-delivery-helper">Tap the address to open Google Maps or Waze.</p>
          </section>

          <section className="rider-delivery-card">
            <div className="rider-delivery-card-heading">
              <div>
                <p className="rider-delivery-label">Order</p>
                <h2>Items to deliver</h2>
              </div>
            </div>
            <div className="rider-delivery-items">
              {previewDelivery.items.map((item) => (
                <div className="rider-delivery-item" key={item.name}>
                  <span><strong>{item.quantity}×</strong> {item.name}</span>
                  <span>₱{item.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="rider-delivery-total">
              <span>Order total</span>
              <strong>₱{previewDelivery.total.toFixed(2)}</strong>
            </div>
          </section>
        </main>

        <aside className="rider-delivery-sidebar">
          <section className="rider-delivery-card rider-delivery-progress-card">
            <p className="rider-delivery-label">Delivery status</p>
            <h2>{currentStatus.label}</h2>
            <div className="rider-delivery-steps">
              {deliveryStatuses.map((status, index) => (
                <div className="rider-delivery-step" key={status.label}>
                  <span className={`rider-delivery-step-marker ${index <= statusIndex ? 'is-done' : ''}`}>
                    {index <= statusIndex ? '✓' : index + 1}
                  </span>
                  <div>
                    <strong>{status.label}</strong>
                    <p>{status.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              className="button button-primary rider-delivery-primary-action"
              type="button"
              onClick={advanceStatus}
              disabled={isDelivered}
            >
              {statusIndex === 0 ? 'Start Delivery' : isDelivered ? 'Delivered' : 'Mark Delivered'}
            </button>
          </section>

          <section className="rider-delivery-safety-card">
            <strong>Important</strong>
            <p>You do not accept or reject deliveries. When the dispatcher assigns an order to you, it is your delivery to complete.</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
