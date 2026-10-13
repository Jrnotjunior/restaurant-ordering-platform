import { useRestaurant } from '../components/RestaurantProvider';

type PolicyKind = 'terms' | 'refunds';

export function CustomerPolicyPage({ kind }: { kind: PolicyKind }) {
  const restaurant = useRestaurant();
  const isTerms = kind === 'terms';
  const title = isTerms ? 'Terms & Conditions' : 'Refund & Cancellation Policy';
  return (
    <main className="restaurant-owner-auth-page">
      <article className="restaurant-owner-auth-card privacy-notice-card" aria-labelledby="customer-policy-title">
        <a className="privacy-notice-back" href="#menu">← Back to menu</a>
        <p className="eyebrow">{restaurant.name}</p>
        <h1 id="customer-policy-title">{title}</h1>
        {isTerms ? (
          <>
            <p>These terms explain the basic rules for placing orders with {restaurant.name} through this online ordering storefront. By submitting an order, you acknowledge these terms.</p>
            <section className="privacy-notice-section"><h2>Who you are ordering from</h2><p>{restaurant.name} is the restaurant offering the listed food and products. Contact the restaurant directly with questions about menu items, orders, or fulfillment.</p></section>
            <section className="privacy-notice-section"><h2>Menu, prices, and availability</h2><p>Menu items, descriptions, prices, and availability may change. Applicable fees should be shown during checkout before you submit your order. The restaurant may contact you if an item is unavailable or an order needs clarification.</p></section>
            <section className="privacy-notice-section"><h2>Orders and fulfillment</h2><p>Submitting an order is a request to purchase the selected items. Follow the fulfillment method selected at checkout. For pickup, collect the order from the restaurant's stated pickup point. For delivery, provide accurate destination and contact details. If you arrange your own courier, you are responsible for booking and paying that courier and should follow the specific terms shown during checkout.</p></section>
            <section className="privacy-notice-section"><h2>Payments and order issues</h2><p>Available payment methods and the amount due are displayed during checkout. If there is a problem with an order, payment, missing item, or fulfillment, contact the restaurant and provide your order number. Refunds and cancellations are handled under the restaurant's Refund & Cancellation Policy and applicable law.</p></section>
            <section className="privacy-notice-section"><h2>Customer information</h2><p>Information provided for an order is handled as described in the <a href="#privacy">Privacy Notice</a>.</p></section>
          </>
        ) : (
          <>
            <p>This policy explains how to raise a cancellation or refund request for an order placed with {restaurant.name}. It must be read together with order-specific information shown at checkout and applicable consumer law.</p>
            <section className="privacy-notice-section"><h2>Requesting help or cancellation</h2><p>Contact the restaurant as soon as possible and provide your order number and the reason for your request. Cancellation may not be possible once preparation, dispatch, or fulfillment has progressed. The restaurant should confirm whether a cancellation can be accepted.</p></section>
            <section className="privacy-notice-section"><h2>Incorrect, missing, or damaged items</h2><p>If your order is incorrect, incomplete, or arrives with a problem, contact the restaurant promptly with your order number and a clear description. The restaurant will review the report and explain available remedies under its procedures and applicable law.</p></section>
            <section className="privacy-notice-section"><h2>Refund decisions and processing</h2><p>Where a refund is approved or legally required, the restaurant will explain the amount and method. The time for funds to appear may depend on the payment method and payment provider. Retain your order confirmation and payment reference.</p></section>
            <section className="privacy-notice-section"><h2>Pickup and third-party courier orders</h2><p>If you arrange your own courier, contact the restaurant about food preparation or order issues. Courier booking, charges, delays, and transit issues may involve the courier provider. This policy does not remove rights or remedies that cannot lawfully be excluded.</p></section>
          </>
        )}
        <section className="privacy-notice-section">
          <h2>Restaurant contact details</h2>
          <p><strong>{restaurant.name}</strong></p>
          {restaurant.locationText && <p>Address: {restaurant.locationText}</p>}
          {restaurant.contactNumber && <p>Phone: {restaurant.contactNumber}</p>}
          {restaurant.email && <p>Email: {restaurant.email}</p>}
          {!restaurant.locationText && !restaurant.contactNumber && !restaurant.email && <p>The restaurant has not configured public contact details yet. Please use the contact method provided with your order confirmation.</p>}
        </section>
        <section className="privacy-notice-section privacy-notice-legal-note">
          <h2>Policy information</h2>
          <p>This is a platform-provided starting template displayed for the restaurant. The restaurant operator must review it, configure accurate business and contact details, and adapt it to actual ordering, cancellation, refund, and fulfillment practices before relying on it as its final policy. Nothing here limits consumer rights under applicable law.</p>
        </section>
      </article>
    </main>
  );
}
