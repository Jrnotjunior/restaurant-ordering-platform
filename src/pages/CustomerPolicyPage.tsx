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
            <p>These Terms &amp; Conditions apply when you browse this ordering storefront or place an order with {restaurant.name} through it. Please read them before ordering. By submitting an order, you confirm that you have read and agree to these terms. These terms do not remove any consumer rights that cannot be excluded under applicable law.</p>

            <section className="privacy-notice-section"><h2>1. Who provides the products and ordering service</h2><p>{restaurant.name} is the restaurant or business presenting the menu and responsible for the products it offers and for preparing, fulfilling, or arranging fulfillment of accepted orders. Web2Table provides the online ordering software that makes this storefront available. Unless the storefront expressly says otherwise, your purchase is from {restaurant.name}, not Web2Table. This description does not exclude any responsibility that applicable law places on Web2Table or another party.</p></section>

            <section className="privacy-notice-section"><h2>2. Eligibility and accurate information</h2><p>You must be legally able to enter into the transaction. Provide accurate, current contact and order information, and review it before submitting. Depending on the fulfillment method, the checkout may ask for your name, phone number, email address, delivery address, and order notes or special instructions. You are responsible for checking that the information and instructions you submit are correct.</p></section>

            <section className="privacy-notice-section"><h2>3. Menu, prices, and availability</h2><p>Menu descriptions, images, prices, options, and availability are provided by or for the restaurant and may change. Images are illustrative where applicable. Please review the item, quantity, selected options, charges, and total displayed at checkout before placing your order. Any applicable fees disclosed at checkout form part of the amount shown. If a listed item or price appears incorrect, the restaurant may need to contact you or resolve the issue before fulfilling the order. Nothing in this section permits a business to disregard consumer protection law.</p></section>

            <section className="privacy-notice-section"><h2>4. Placing and accepting an order</h2><p>Submitting an order sends an order request to the restaurant; it does not by itself guarantee that every requested item is available or that the order can be fulfilled. Review the order details and total before submission. The restaurant's order confirmation or status shown through the website indicates the progress or acceptance of your order. If the restaurant cannot fulfill an order, it should update you through the available website order flow and address any payment or refund due under applicable law and the Refund &amp; Cancellation Policy. Keep your order reference for questions or complaints.</p></section>

            <section className="privacy-notice-section"><h2>5. Payments</h2><p>The payment methods available for an order, and the payment status recorded for it, are shown in the ordering flow. Follow the payment instructions presented at checkout. Payment-card details, where applicable, are handled by the relevant payment provider rather than stored by Web2Table. Do not assume an order is paid unless the displayed order or payment status indicates that payment has been completed. For a payment discrepancy, contact the restaurant using the details below and provide your order reference and relevant payment information. Do not send full payment-card credentials in a support message.</p></section>

            <section className="privacy-notice-section"><h2>6. Pickup and delivery</h2><p>Choose the fulfillment method available for your order and follow the instructions displayed at checkout. For pickup, collect the order at the restaurant's stated location and follow any pickup instructions provided with the order. For delivery, provide a complete and accurate delivery address and contact information, and ensure the recipient can be reached as reasonably needed to complete delivery. Delivery availability, estimated timing, and fulfillment arrangements depend on the options shown for the restaurant.</p><p>If you choose or arrange your own third-party courier, you are responsible for arranging that courier and any disclosed courier charges. The courier may have separate terms. Contact the restaurant about preparation or item issues and the courier about matters within its control, such as its booking or transit service. This does not limit any rights you may have against the restaurant, courier, platform, or other party under applicable law.</p></section>

            <section className="privacy-notice-section"><h2>7. Food information and special instructions</h2><p>Read menu descriptions and available food or allergen information carefully, and contact the restaurant before ordering if you have an allergy or dietary concern that is not adequately addressed by the information shown. Special instructions can be submitted with an order, but the restaurant may not be able to accommodate every request. If a food allergy or other dietary requirement is critical, obtain confirmation from the restaurant before relying on a special instruction. Do not treat a submitted note as confirmation that a requested change has been accepted.</p></section>

            <section className="privacy-notice-section"><h2>8. Changes, cancellations, and refunds</h2><p>Contact {restaurant.name} promptly if you need to correct or cancel an order. A change or cancellation may not be possible after preparation, dispatch, or fulfillment has progressed. The restaurant should tell you whether it can accept the request. Refunds, missing or incorrect items, and other order problems are addressed under the <a href="#refunds">Refund &amp; Cancellation Policy</a> and applicable law. These terms do not waive a remedy or consumer right that the law requires to be available.</p></section>

            <section className="privacy-notice-section"><h2>9. Customer conduct</h2><p>Use the storefront lawfully and provide information that you are authorized to provide. Do not misuse the ordering service, interfere with its operation or security, submit fraudulent orders, or use it to infringe another person's rights. We may take reasonable steps to address suspected misuse, subject to applicable law and any obligations to customers.</p></section>

            <section className="privacy-notice-section"><h2>10. Personal information</h2><p>Personal information submitted during browsing, checkout, or ordering is handled as described in the <a href="#privacy">Privacy Notice</a>. Information needed to process an order may be made available to authorized personnel of the restaurant after you submit it and may be processed by service providers as described in that notice. Please review the Privacy Notice to understand the purposes of processing, access arrangements, retention, and your applicable privacy rights.</p></section>

            <section className="privacy-notice-section"><h2>11. Service availability and technical issues</h2><p>The storefront may occasionally be unavailable, delayed, or affected by technical or network problems. We will take reasonable steps to maintain the service, but uninterrupted availability cannot be guaranteed. If a technical issue appears to have affected your order or payment, contact the restaurant with your order reference and details. Nothing in these terms excludes liability where such exclusion is prohibited by law.</p></section>

            <section className="privacy-notice-section"><h2>12. Responsibility and consumer rights</h2><p>The restaurant is responsible for the menu it offers and for its own preparation, order handling, and fulfillment obligations. Web2Table provides the ordering software. Each party remains responsible for its own acts and obligations under applicable law. To the extent permitted by law, a party is not responsible for losses that it did not cause or that are not legally attributable to it; however, these terms do not exclude or restrict liability, warranties, remedies, or consumer rights that cannot lawfully be excluded or restricted.</p></section>

            <section className="privacy-notice-section"><h2>13. Changes to these terms</h2><p>These terms may be updated when the ordering service or applicable requirements change. The version displayed on this storefront applies to your use of the service, subject to any mandatory legal requirements. Material changes will not remove rights that have already accrued or rights protected by law.</p></section>

            <section className="privacy-notice-section"><h2>14. Applicable law and complaints</h2><p>These terms are intended to be interpreted consistently with applicable laws of the Philippines, including applicable consumer-protection and internet-transaction requirements. If you have a question, complaint, or concern about an order, contact {restaurant.name} using the details below and include your order reference. This does not prevent you from approaching a competent government agency or using any dispute-resolution or legal remedy available to you.</p></section>
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
