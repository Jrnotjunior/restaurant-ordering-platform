import { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
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

function exportCustomers(customers: RestaurantLoyaltyCustomer[]): void {
  const rows: (string | number)[][] = [
    ['WEB2TABLE | LOYALTY CUSTOMER REPORT'],
    ['Report generated', new Date().toLocaleString()],
    ['Registered customers', customers.length],
    ['Total available points', customers.reduce((sum, customer) => sum + customer.pointsBalance, 0)],
    [],
    [
      'Customer name',
      'Email address',
      'Mobile number',
      'Registration date',
      'Available points',
      'Lifetime points earned',
      'Lifetime points redeemed',
      'Last activity',
    ],
    ...customers.map((customer) => [
      customer.name,
      customer.email,
      customer.phone ?? '',
      customer.registeredAt ? new Date(customer.registeredAt).toLocaleDateString() : '',
      customer.pointsBalance,
      customer.lifetimePointsEarned,
      customer.lifetimePointsRedeemed,
      customer.lastActivityAt ? new Date(customer.lastActivityAt).toLocaleDateString() : 'No activity yet',
    ]),
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const navy = '17243A';
  const blue = '2563EB';
  const paleGray = 'F4F6FA';
  const border = { style: 'thin', color: { rgb: 'D9E1EE' } };
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  worksheet['!cols'] = [
    { wch: 26 }, { wch: 34 }, { wch: 20 }, { wch: 19 },
    { wch: 18 }, { wch: 24 }, { wch: 25 }, { wch: 19 },
  ];
  worksheet['!rows'] = rows.map((row, index) => ({ hpt: index === 0 ? 30 : index === 5 ? 28 : 22 }));
  worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: columnCount - 1 } }];
  worksheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 5, c: 0 }, e: { r: rows.length - 1, c: columnCount - 1 } }),
  };
  worksheet['!freeze'] = { xSplit: 0, ySplit: 6 };

  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < columnCount; col += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (!cell) continue;
      const isTitle = row === 0;
      const isHeader = row === 5;
      const isSummary = row >= 1 && row <= 3;
      cell.s = {
        font: {
          name: 'Aptos',
          sz: isTitle ? 16 : 10,
          bold: isTitle || isHeader || (isSummary && col === 0),
          color: { rgb: isTitle || isHeader ? 'FFFFFF' : navy },
        },
        fill: {
          patternType: 'solid',
          fgColor: { rgb: isTitle ? navy : isHeader ? blue : isSummary ? 'E8F0FE' : row % 2 === 0 ? 'FFFFFF' : paleGray },
        },
        alignment: { vertical: 'center', wrapText: isTitle || isHeader || String(cell.v ?? '').length > 34 },
        border: { bottom: border },
      };
      if (row >= 6 && col >= 4 && col <= 6 && typeof cell.v === 'number') {
        cell.z = '#,##0;[Red](#,##0);-';
        cell.s.alignment = { horizontal: 'right', vertical: 'center' };
      }
      if (row >= 6 && col === 3 && customers[row - 6]?.registeredAt) {
        cell.z = 'mmm d, yyyy';
      }
      if (row >= 6 && col === 7 && customers[row - 6]?.lastActivityAt) {
        cell.z = 'mmm d, yyyy';
      }
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Loyalty Customers');
  XLSX.writeFile(workbook, `web2table-loyalty-customers-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
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
          <div className="restaurant-loyalty-customer-search">
            <label htmlFor="restaurant-loyalty-customer-search">Search customers</label>
            <input
              id="restaurant-loyalty-customer-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, email, or mobile"
            />
          </div>
          <button
            className="button button-primary restaurant-loyalty-export"
            type="button"
            onClick={() => exportCustomers(filteredCustomers)}
            disabled={loading || filteredCustomers.length === 0}
          >
            Export Excel{search.trim() ? ` (${filteredCustomers.length})` : ''}
          </button>
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
        .restaurant-loyalty-customer-toolbar{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:0 0 12px}\n        .restaurant-loyalty-customer-search{display:grid;gap:6px;flex:1;min-width:0}\n        .restaurant-loyalty-export{min-height:40px;white-space:nowrap}\n        .restaurant-loyalty-export:disabled{opacity:.55;cursor:not-allowed}
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
        @media(max-width:560px){.restaurant-loyalty-customer-toolbar{align-items:stretch;flex-direction:column}.restaurant-loyalty-customer-toolbar input{width:100%;box-sizing:border-box}.restaurant-loyalty-export{width:100%}}
      `}</style>
    </section>
  );
}
