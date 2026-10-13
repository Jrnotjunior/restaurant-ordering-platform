import { useRestaurant } from '../components/RestaurantProvider';

export function PrivacyNoticePage() {
  const restaurant = useRestaurant();
  return (
    <main className="restaurant-owner-auth-page">
      <article className="restaurant-owner-auth-card privacy-notice-card" aria-labelledby="privacy-notice-title">
        <a className="privacy-notice-back" href="#signup">← Back to Create Account</a>

        <p className="eyebrow">Data Privacy</p>
        <h1 id="privacy-notice-title">Privacy Notice</h1>
        <p>
          This notice explains how {restaurant.name} and the systems supporting its online
          ordering storefront collect and process personal information when you create an
          account or place an order.
        </p>

        <section className="privacy-notice-section">
          <h2>Who is responsible for your information?</h2>
          <p>
            {restaurant.name} operates this storefront and is responsible for determining how
            customer information is used for its restaurant business. Web2Table provides the
            software platform and service providers may process information to support account,
            ordering, payment, security, and operational functions. The parties' actual legal
            roles depend on how the service is operated.
          </p>
        </section>

        <section className="privacy-notice-section">
          <h2>What information do we collect?</h2>
          <ul>
            <li><strong>Full name</strong> — to identify your customer account and orders.</li>
            <li><strong>Phone number</strong> — if you choose to provide it, for order-related communication and account information.</li>
            <li><strong>Email address</strong> — for account authentication and account-related communication.</li>
            <li><strong>Account information</strong> — information required to create and maintain your customer account.</li>
            <li><strong>Order information</strong> — information associated with orders you place, such as items, amounts, delivery details, and order status.</li>
            <li><strong>Payment-related information</strong> — information needed to record and reconcile online payments. Sensitive payment credentials are handled by the applicable payment processor rather than stored as part of your customer account in this application.</li>
          </ul>
        </section>

        <section className="privacy-notice-section">
          <h2>Why do we process your information?</h2>
          <p>We process personal information for purposes including:</p>
          <ul>
            <li>creating and managing your customer account;</li>
            <li>authenticating you and keeping your account secure;</li>
            <li>receiving, processing, and tracking your orders;</li>
            <li>communicating with you about your account and orders;</li>
            <li>processing and reconciling payments when you choose online payment; and</li>
            <li>maintaining and improving the ordering service.</li>
          </ul>
        </section>

        <section className="privacy-notice-section">
          <h2>How is your information processed?</h2>
          <p>
            Personal information is processed through the systems used to operate the ordering
            platform, including Supabase for application data and authentication. When you choose
            online payment, the payment flow uses PayMongo as the payment processor. Access should
            be limited to authorized persons and service providers who need the information for
            legitimate ordering, account, payment, security, or operational purposes.
          </p>
        </section>

        <section className="privacy-notice-section">
          <h2>How long do we keep it?</h2>
          <p>
            Personal information is retained only for as long as reasonably necessary for the
            purposes for which it was collected, including account, order, payment, security,
            operational, and legal requirements. The exact retention period should be established
            by the restaurant operator based on its actual business and legal requirements.
          </p>
        </section>

        <section className="privacy-notice-section">
          <h2>Your rights</h2>
          <p>
            Under the Data Privacy Act of 2012 (Republic Act No. 10173), data subjects have
            rights regarding their personal information, subject to applicable conditions and
            limitations. These include the right to be informed, the right to access, the right
            to correct inaccurate information, and other rights provided by applicable privacy law.
          </p>
        </section>

        <section className="privacy-notice-section">
          <h2>Questions or privacy requests</h2>
          <p>
            For questions about your personal information, privacy requests, or how your
            information is handled, contact {restaurant.name} using the details below.
          </p>
        </section>

        <section className="privacy-notice-section">
          <h2>Restaurant contact details</h2>
          <p><strong>{restaurant.name}</strong></p>
          {restaurant.locationText && <p>Address: {restaurant.locationText}</p>}
          {restaurant.contactNumber && <p>Phone: {restaurant.contactNumber}</p>}
          {restaurant.email && <p>Email: {restaurant.email}</p>}
          {!restaurant.locationText && !restaurant.contactNumber && !restaurant.email && <p>The restaurant has not configured public contact details yet. Please use the contact method provided with your order confirmation.</p>}
        </section>

        <section className="privacy-notice-section privacy-notice-legal-note">
          <h2>About this notice</h2>
          <p>
            This privacy notice is intended to explain the current customer-facing data practices
            of the application. The restaurant operator should review and update it with its
            official privacy contact details, retention periods, authorized recipients, and other
            organization-specific information before production use.
          </p>
          <p>
            This notice is provided in accordance with the transparency principles of Republic Act
            No. 10173, the Data Privacy Act of 2012, and does not replace legal advice.
          </p>
        </section> 
      </article>
    </main>
  );
}
