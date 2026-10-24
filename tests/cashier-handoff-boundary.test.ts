import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ordersPage = readFileSync(
  new URL('../src/pages/RestaurantOrdersPage.tsx', import.meta.url),
  'utf8',
);

function sectionBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing source section: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing end source section after: ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('cashier handoff workflow boundary', () => {
  const cashConfirmation = sectionBetween(
    ordersPage,
    'async function confirmCashPayment',
    'async function printAndSendToKitchen',
  );
  const paidOrderHandoff = sectionBetween(
    ordersPage,
    'async function printAndSendToKitchen',
    'async function cancel(',
  );

  it('keeps cash confirmation restricted to the cashier role', () => {
    expect(cashConfirmation).toContain("if (role !== 'cashier') return;");
    expect(cashConfirmation).toContain('await confirmPosCashPayment(order.orderId)');
  });

  it('persists the kitchen handoff before printing and closes cashier modals afterward', () => {
    expect(paidOrderHandoff).toContain("if (role !== 'cashier') return;");
    expect(paidOrderHandoff).toContain('if (!isPaymentReady(order))');
    expect(paidOrderHandoff).toContain('await sendOrderToKitchen(order.orderId)');
    expect(paidOrderHandoff.indexOf('await sendOrderToKitchen(order.orderId)'))
      .toBeLessThan(paidOrderHandoff.indexOf('window.print()'));
    expect(paidOrderHandoff).toContain('flushSync(() =>');
    expect(paidOrderHandoff).toContain('closeOrderList()');
    expect(paidOrderHandoff.indexOf('window.print()'))
      .toBeLessThan(paidOrderHandoff.indexOf('closeOrderList()'));
  });

  it('closes the parent and selected-order dialogs after cash receipt printing', () => {
    expect(cashConfirmation).toContain('window.print()');
    expect(cashConfirmation).toContain('closeOrderList()');
    expect(cashConfirmation.indexOf('window.print()'))
      .toBeLessThan(cashConfirmation.indexOf('closeOrderList()'));
  });

  it('keeps the internal kitchen ticket separate from the customer receipt template', () => {
    expect(ordersPage).toContain('restaurant-pos-kitchen-receipt');
    expect(ordersPage).toContain('KITCHEN ORDER');
    expect(ordersPage).toContain('<OperationalCustomerReceipt');
    expect(ordersPage).toContain('className="restaurant-pos-print-area"');
    expect(ordersPage).toContain('className="restaurant-order-modal"');
  });
});
