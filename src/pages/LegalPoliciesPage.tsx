import './LegalPoliciesPage.css';

const policies = [
  {
    href: '#privacy',
    title: 'Privacy Notice',
    description: 'Learn how personal information is collected, used, and protected.',
    icon: 'shield',
  },
  {
    href: '#terms',
    title: 'Terms & Conditions',
    description: 'Review the terms for using this storefront and placing orders.',
    icon: 'document',
  },
  {
    href: '#refunds',
    title: 'Refund & Cancellation Policy',
    description: 'Understand order cancellation, refund requests, and order issues.',
    icon: 'refresh',
  },
] as const;

function PolicyIcon({ type }: { type: (typeof policies)[number]['icon'] }) {
  if (type === 'shield') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></svg>;
  }
  if (type === 'document') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 12-2L20 12M4 12l2.5 5a7 7 0 0 0 12-2" /></svg>;
}

export function LegalPoliciesPage() {
  return (
    <section className="customer-legal-page" aria-labelledby="customer-legal-title">
      <section className="customer-legal-intro">
        <h1 id="customer-legal-title">Legal &amp; Policies</h1>
      </section>

      <nav className="customer-legal-list" aria-label="Legal documents">
        {policies.map((policy) => (
          <a className="customer-legal-link" href={policy.href} key={policy.href}>
            <span className="customer-legal-icon"><PolicyIcon type={policy.icon} /></span>
            <span className="customer-legal-copy">
              <strong>{policy.title}</strong>
              <span>{policy.description}</span>
            </span>
            <span className="customer-legal-arrow" aria-hidden="true">›</span>
          </a>
        ))}
      </nav>

    </section>
  );
}
