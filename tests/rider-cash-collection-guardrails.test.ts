import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const riderPage = readFileSync(
  new URL('../src/pages/RiderDeliveryPage.tsx', import.meta.url),
  'utf8',
);
const dispatchService = readFileSync(
  new URL('../src/modules/dispatch/dispatchService.ts', import.meta.url),
  'utf8',
);

describe('rider cash collection and delivery totals guardrails', () => {
  it('only exposes cash collection after delivery is completed and payment is still pending', () => {
    expect(riderPage).toContain("delivery.paymentMethod !== 'cash'");
    expect(riderPage).toContain("delivery.paymentStatus === 'paid'");
    expect(riderPage).toContain("delivery.status !== 'delivered'");
    expect(riderPage).toContain("await supabaseRpc('rider_confirm_cash_collection'");
    expect(riderPage).toContain("delivery.paymentStatus !== 'paid' ? (");
    expect(riderPage).toContain('Cash collection pending');
    expect(riderPage).toContain("'Slide to mark delivered'");
    expect(riderPage).not.toContain('Slide to collect cash');
  });

  it('shows subtotal, delivery fee, and order total as separate values', () => {
    expect(riderPage).toContain('<span>Subtotal</span><strong>₱{delivery.subtotal.toFixed(2)}</strong>');
    expect(riderPage).toContain('<span>Delivery fee</span><strong>₱{delivery.deliveryFee.toFixed(2)}</strong>');
    expect(riderPage).toContain('<span>Order total</span><strong>₱{delivery.total.toFixed(2)}</strong>');
  });

  it('scopes rider delivery lookup to the authenticated rider assignment', () => {
    expect(riderPage).toContain(".eq('auth_user_id', user.id)");
    expect(riderPage).toContain(".eq('rider_id', rider.id)");
    expect(riderPage).toContain("throw new Error('This delivery is no longer assigned to your rider account.')");
  });

  it('routes payment collection through the server RPC instead of browser-side order updates', () => {
    const collectionStart = riderPage.indexOf('async function confirmCashCollected()');
    const collectionEnd = riderPage.indexOf('async function reportFailedDelivery', collectionStart);
    expect(collectionStart).toBeGreaterThanOrEqual(0);
    expect(collectionEnd).toBeGreaterThan(collectionStart);
    const collection = riderPage.slice(collectionStart, collectionEnd);
    expect(collection).toContain("supabaseRpc('rider_confirm_cash_collection'");
    expect(collection).not.toContain(".from('orders').update(");
    expect(dispatchService).toContain('getRiderDashboardData');
  });
});
