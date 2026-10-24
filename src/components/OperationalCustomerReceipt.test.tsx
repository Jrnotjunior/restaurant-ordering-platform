import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OperationalCustomerReceipt, type OperationalCustomerReceiptProps } from './OperationalCustomerReceipt';

const baseReceipt: OperationalCustomerReceiptProps = {
  orderNumber: 'ORD-000020',
  createdAt: '2026-10-24T05:42:25.000Z',
  orderType: 'delivery',
  paymentLabel: 'Cash • Paid',
  customerName: 'Test Customer',
  items: [
    { id: 'a', name: 'Beef Bulgogi Rice Bowl', quantity: 1, lineTotal: 180 },
    { id: 'b', name: 'Chicken Teriyaki Rice Bowl', quantity: 1, lineTotal: 160 },
    { id: 'c', name: 'Chicken Cordon Bleu Rice Bowl', quantity: 1, lineTotal: 150 },
  ],
  grossSales: 490,
  showTaxBreakdown: false,
  vatableSales: 0,
  vatAmount: 0,
  vatExemptSales: 0,
  zeroRatedSales: 0,
  vatRate: 12,
  discountAmount: 0,
  loyaltyDiscountAmount: 0,
  deliveryFee: 70,
  total: 560,
};

describe('OperationalCustomerReceipt', () => {
  it('renders the shared receipt header, order, payment, item totals and delivery fee', () => {
    const html = renderToStaticMarkup(<OperationalCustomerReceipt {...baseReceipt} />);

    expect(html).toContain('CUSTOMER RECEIPT');
    expect(html).toContain('Operational receipt — not a BIR-issued invoice');
    expect(html).toContain('ORD-000020');
    expect(html).toContain('Cash • Paid');
    expect(html).toContain('Beef Bulgogi Rice Bowl');
    expect(html).toContain('Delivery fee');
    expect(html).toContain('₱70.00');
    expect(html).toContain('₱560.00');
  });

  it('shows a statutory discount even when the operational tax breakdown is unavailable', () => {
    const html = renderToStaticMarkup(<OperationalCustomerReceipt
      {...baseReceipt}
      grossSales={620}
      discountAmount={41.34}
      deliveryFee={0}
      total={578.66}
      beneficiaries={[{
        discountType: 'pwd',
        idType: 'pwd_id',
        idNumber: '135626',
        beneficiaryName: 'Test Customer',
        groupSize: 3,
        eligibleGrossAmount: 206.66,
        eligibleAmount: 206.66,
        discountAmount: 41.34,
      }]}
    />);

    expect(html).toContain('SC/PWD discount');
    expect(html).toContain('-₱41.34');
    expect(html).toContain('PWD BENEFICIARY: Test Customer');
    expect(html).toContain('Group size: 3 customers');
    expect(html).toContain('Personal food share: ₱206.66');
  });

  it('renders other discounts separately from SC/PWD and loyalty discounts', () => {
    const html = renderToStaticMarkup(<OperationalCustomerReceipt
      {...baseReceipt}
      grossSales={100}
      showTaxBreakdown={false}
      discountAmount={0}
      otherDiscountAmount={8.5}
      loyaltyDiscountAmount={5}
      deliveryFee={0}
      total={86.5}
    />);

    expect(html).toContain('Other discount');
    expect(html).toContain('-₱8.50');
    expect(html).toContain('Loyalty Discount');
    expect(html).toContain('-₱5.00');
    expect(html).not.toContain('SC/PWD discount');
  });

  it('shows zero-rated sales only as part of a supplied finalized VAT breakdown', () => {
    const html = renderToStaticMarkup(<OperationalCustomerReceipt
      {...baseReceipt}
      grossSales={200}
      showTaxBreakdown={true}
      vatableSales={100}
      vatAmount={12}
      vatExemptSales={50}
      zeroRatedSales={50}
      deliveryFee={0}
      total={212}
    />);

    expect(html).toContain('VATable sales');
    expect(html).toContain('VAT 12.00%');
    expect(html).toContain('VAT-exempt sales');
    expect(html).toContain('Zero-rated sales');
    expect(html).toContain('₱50.00');
  });

  it('does not show a VAT breakdown on a non-VAT receipt even when the gross-sales snapshot exists', () => {
    const html = renderToStaticMarkup(<OperationalCustomerReceipt
      {...baseReceipt}
      orderType="take_out"
      grossSales={310}
      showTaxBreakdown={false}
      vatableSales={0}
      vatAmount={0}
      vatExemptSales={0}
      deliveryFee={0}
      total={310}
    />);

    expect(html).toContain('Subtotal');
    expect(html).not.toContain('VATable sales');
    expect(html).not.toContain('VAT-exempt sales');
    expect(html).not.toContain('VAT 12.00%');
  });

  it('renders the same customer receipt identity and disclaimer for every order type', () => {
    const orderTypes: OperationalCustomerReceiptProps['orderType'][] = ['dine_in', 'take_out', 'pickup', 'delivery'];
    for (const orderType of orderTypes) {
      const html = renderToStaticMarkup(<OperationalCustomerReceipt {...baseReceipt} orderType={orderType} />);
      expect(html).toContain('CUSTOMER RECEIPT');
      expect(html).toContain('Operational receipt — not a BIR-issued invoice');
      expect(html).toContain('ORD-000020');
      expect(html).toContain('TOTAL');
    }
  });

  it('is the single customer receipt template used by both POS and staff order handoff', () => {
    const posSource = readFileSync(fileURLToPath(new URL('../pages/RestaurantCashierPosPage.tsx', import.meta.url)), 'utf8');
    const staffOrdersSource = readFileSync(fileURLToPath(new URL('../pages/RestaurantOrdersPage.tsx', import.meta.url)), 'utf8');

    expect(posSource).toContain('<OperationalCustomerReceipt');
    expect(posSource).toContain('getPosOrderReceiptSnapshot(created.orderId)');
    expect(posSource).toContain('printOrder.receiptSnapshot.items.map');
    expect(staffOrdersSource).toContain('<OperationalCustomerReceipt');
    expect(staffOrdersSource).toContain("mobileNumber={selectedOrder.mobileNumber ?? ''}");
    expect(staffOrdersSource).toContain("deliveryAddress={selectedOrder.deliveryAddress ?? ''}");
    expect(staffOrdersSource).toContain("cashierName={selectedOrder.cashierName ?? ''}");
    expect(staffOrdersSource).toContain('eligibleGrossAmount: beneficiary.eligibleGrossAmount ?? null');
    expect(staffOrdersSource).toContain("showTaxBreakdown={selectedOrder.taxVatRegistered && selectedOrder.taxSnapshotStatus === 'calculated' && selectedOrder.taxGrossSales > 0 && selectedOrder.taxZeroRatedSales != null && selectedOrder.itemsTaxClassified === true}");
    expect(staffOrdersSource).toContain('className="restaurant-pos-print-area"');
    expect(staffOrdersSource).not.toContain('restaurant-order-print-receipt restaurant-customer-receipt');
  });
});
