import { useEffect, useMemo, useState } from 'react';
import { getRestaurantLoyaltyCustomers, type RestaurantLoyaltyCustomer } from '../modules/loyalty/loyaltyCustomerService';

type Props = { restaurantId: string };

function formatDate(value: string | null): string {
  if (!value) return 'No activity yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatPoints(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function RestaurantLoyaltyCustomers({ restaurantId }: Props) {
  const [customers, setCustomers] = useState<RestaurantLoyaltyCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    getRestaurantLoyaltyCustomers(restaurantId)
      .then((rows) => { if (active) setCustomers(rows); })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load loyalty customers.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [restaurantId]);

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return customers;
    return customers.filter((customer) =>
      customer.name.toLocaleLowerCase().includes(query)
      || customer.email.toLocaleLowerCase().includes(query)
      || (customer.phone ?? '').toLocaleLowerCase().includes(query),
    );
  }, [customers, search]);

  const totalPoints = customers.reduce((sum, customer) => sum + customer.pointsBalance, 0);
  const totalEarned = customers.reduce((sum, customer) => sum + customer.lifetimePointsEarned, 0);
  const totalRedeemed = customers.reduce((sum, customer) => sum + customer.lifetimePointsRedeemed, 0);

  return (
    <section className="restaurant-page restaurant-loyalty-customers">
      <div className="restaurant-shipping-card">
        <div className="restaurant-shipping-section-header">
          <div>
            <p className="eyebrow">Customer accounts</p>
            <h2>Registered customers</h2>
            <p className="restaurant-shipping-help">Customers who created an account for this restaurant and their live loyalty points balance.</p>
          </div>
        </div>

        <div className="restaurant-loyalty-customer-stats">
          <article><span>Registered customers</span><strong>{loading ? '—' : formatPoints(customers.length)}</strong></article>
          <article><span>Points outstanding</span><strong>{loading ? '—' : formatPoints(totalPoints)}</strong></article>
          <article><span>Lifetime points earned</span><strong>{loading ? '—' : formatPoints(totalEarned)}</strong></article>
          <article><span>Lifetime points redeemed</span><strong>{loading ? '—' : formatPoints(totalRedeemed)}</strong></article>
        </div>

        <div className="restaurant-loyalty-customer-toolbar">
          <label htmlFor="restaurant-loyalty-customer-search">Search customers</label>
          <input
            id="restaurant-loyalty-customer-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, email, or mobile"
          />
        </div>

        {error && <div className="restaurant-shipping-message is-error" role="alert">{error}</div>}
        {loading ? (
          <p className="restaurant-loyalty-customer-empty" role="status">Loading registered customers…</p>
        ) : filteredCustomers.length === 0 ? (
          <p className="restaurant-loyalty-customer-empty">
            {search.trim() ? 'No customers match your search.' : 'No customers have registered for this restaurant yet.'}
          </p>
        ) : (
          <div className="restaurant-loyalty-customer-table-wrap">
            <table className="restaurant-loyalty-customer-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Registered</th>
                  <th>Available points</th>
                  <th>Points earned</th>
                  <th>Points redeemed</th>
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((customer) => (
                  <tr key={customer.customerId}>
                    <td>
                      <strong>{customer.name}</strong>
                      <span>{customer.email}</span>
                      {customer.phone && <span>{customer.phone}</span>}
                    </td>
                    <td>{formatDate(customer.registeredAt)}</td>
                    <td><strong>{formatPoints(customer.pointsBalance)}</strong></td>
                    <td>{formatPoints(customer.lifetimePointsEarned)}</td>
                    <td>{formatPoints(customer.lifetimePointsRedeemed)}</td>
                    <td>{formatDate(customer.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        .restaurant-loyalty-customer-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:18px 0 22px}
        .restaurant-loyalty-customer-stats article{display:grid;gap:8px;min-width:0;padding:16px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-background)}
        .restaurant-loyalty-customer-stats article span{color:var(--color-muted);font-size:.78rem}
        .restaurant-loyalty-customer-stats article strong{color:var(--color-text);font-size:1.35rem;font-weight:800}
        .restaurant-loyalty-customer-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 12px}
        .restaurant-loyalty-customer-toolbar label{font-size:.82rem;font-weight:700;color:var(--color-text)}
        .restaurant-loyalty-customer-toolbar input{width:min(100%,320px);min-height:40px;padding:9px 12px;border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-background);color:var(--color-text);font:inherit}
        .restaurant-loyalty-customer-toolbar input:focus{outline:2px solid color-mix(in srgb,var(--color-primary) 15%,transparent);border-color:var(--color-primary)}
        .restaurant-loyalty-customer-table-wrap{width:100%;overflow-x:auto}
        .restaurant-loyalty-customer-table{width:100%;border-collapse:collapse;text-align:left;font-size:.82rem}
        .restaurant-loyalty-customer-table th{padding:11px 10px;border-bottom:1px solid var(--color-border);color:var(--color-muted);font-size:.7rem;text-transform:uppercase;letter-spacing:.035em;white-space:nowrap}
        .restaurant-loyalty-customer-table td{padding:13px 10px;border-bottom:1px solid var(--color-border);color:var(--color-text);vertical-align:top;white-space:nowrap}
        .restaurant-loyalty-customer-table td:first-child{white-space:normal;min-width:190px}
        .restaurant-loyalty-customer-table td:first-child strong,.restaurant-loyalty-customer-table td:first-child span{display:block}
        .restaurant-loyalty-customer-table td:first-child span{margin-top:3px;color:var(--color-muted);font-size:.76rem;overflow-wrap:anywhere}
        .restaurant-loyalty-customer-empty{padding:24px 12px;text-align:center;color:var(--color-muted);font-size:.88rem}
        @media(max-width:900px){.restaurant-loyalty-customer-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:560px){.restaurant-loyalty-customer-toolbar{align-items:stretch;flex-direction:column}.restaurant-loyalty-customer-toolbar input{width:100%;box-sizing:border-box}}
      `}</style>
    </section>
  );
}
