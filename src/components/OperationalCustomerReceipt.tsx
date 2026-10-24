export type OperationalReceiptItem = {
  id: string;
  name: string;
  quantity: number;
  lineTotal: number;
};

export type OperationalReceiptBeneficiary = {
  discountType: string;
  idType?: string | null;
  idNumber: string;
  beneficiaryName?: string | null;
  beneficiaryAddress?: string | null;
  beneficiaryTin?: string | null;
  groupSize?: number | null;
  eligibleGrossAmount?: number | null;
  eligibleAmount: number;
  discountAmount: number;
};

export type OperationalCustomerReceiptProps = {
  orderNumber: string;
  createdAt: string;
  orderType: 'delivery' | 'take_out' | 'pickup' | 'dine_in';
  paymentLabel: string;
  customerName: string;
  items: OperationalReceiptItem[];
  grossSales: number;
  showTaxBreakdown: boolean;
  vatableSales: number;
  vatAmount: number;
  vatExemptSales: number;
  zeroRatedSales: number;
  vatRate: number;
  discountAmount: number;
  loyaltyDiscountAmount: number;
  deliveryFee: number;
  total: number;
  mobileNumber?: string;
  deliveryAddress?: string;
  cashierName?: string;
  notes?: string;
  cashReceived?: number;
  change?: number;
  beneficiaries?: OperationalReceiptBeneficiary[];
};

function orderTypeLabel(orderType: OperationalCustomerReceiptProps['orderType']) {
  switch (orderType) {
    case 'dine_in': return 'DINE-IN';
    case 'take_out': return 'TAKE-OUT';
    case 'pickup': return 'PICKUP';
    case 'delivery': return 'DELIVERY';
  }
}

/**
 * Shared operational customer receipt layout for cashier POS and staff order
 * handoff. It is not an official BIR-issued invoice and does not certify tax.
 */
export function OperationalCustomerReceipt({
  orderNumber,
  createdAt,
  orderType,
  paymentLabel,
  customerName,
  items,
  grossSales,
  showTaxBreakdown,
  vatableSales,
  vatAmount,
  vatExemptSales,
  zeroRatedSales,
  vatRate,
  discountAmount,
  loyaltyDiscountAmount,
  deliveryFee,
  total,
  mobileNumber,
  deliveryAddress,
  cashierName,
  notes,
  cashReceived,
  change,
  beneficiaries = [],
}: OperationalCustomerReceiptProps) {
  const receiptDate = new Date(createdAt);
  const dateLabel = Number.isNaN(receiptDate.getTime()) ? 'Order date unavailable' : receiptDate.toLocaleString();
  const showTaxLines = showTaxBreakdown && grossSales > 0;

  return (
    <div className="restaurant-pos-print-receipt restaurant-pos-customer-receipt">
      <div className="pos-receipt-center">
        <div className="pos-receipt-title">CUSTOMER RECEIPT</div>
        <div className="pos-receipt-muted">Operational receipt — not a BIR-issued invoice</div>
        <div className="pos-receipt-order-number">{orderNumber}</div>
        <div className="pos-receipt-muted">{dateLabel}</div>
      </div>
      <hr className="pos-receipt-divider" />
      <div className="pos-receipt-center">
        <div className="pos-receipt-label">{orderTypeLabel(orderType)}</div>
        <div>{paymentLabel}</div>
      </div>
      <hr className="pos-receipt-divider" />
      <div>
        <div className="pos-receipt-label">Customer</div>
        <div>{customerName || 'Guest'}</div>
        {orderType === 'delivery' && mobileNumber?.trim() && <div>{mobileNumber}</div>}
        {orderType === 'delivery' && deliveryAddress?.trim() && <div>{deliveryAddress}</div>}
      </div>
      {cashierName?.trim() && <div className="pos-receipt-row"><span>Cashier</span><span>{cashierName}</span></div>}
      {notes?.trim() && (
        <>
          <hr className="pos-receipt-divider" />
          <div className="pos-receipt-label">Special instructions</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{notes}</div>
        </>
      )}
      <hr className="pos-receipt-divider" />
      <div>
        {items.map((item) => (
          <div className="pos-receipt-row" key={item.id}>
            <span>{item.quantity} × {item.name}</span>
            <span>₱{item.lineTotal.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <hr className="pos-receipt-divider" />
      {showTaxLines ? (
        <>
          <div className="pos-receipt-row"><span>Gross sales</span><span>₱{grossSales.toFixed(2)}</span></div>
          <div className="pos-receipt-row"><span>VATable sales</span><span>₱{vatableSales.toFixed(2)}</span></div>
          {vatAmount > 0 && <div className="pos-receipt-row"><span>VAT {vatRate.toFixed(2)}%</span><span>₱{vatAmount.toFixed(2)}</span></div>}
          {vatExemptSales > 0 && <div className="pos-receipt-row"><span>VAT-exempt sales</span><span>₱{vatExemptSales.toFixed(2)}</span></div>}
          {zeroRatedSales > 0 && <div className="pos-receipt-row"><span>Zero-rated sales</span><span>₱{zeroRatedSales.toFixed(2)}</span></div>}
        </>
      ) : (
        <div className="pos-receipt-row"><span>Subtotal</span><span>₱{grossSales.toFixed(2)}</span></div>
      )}
      {discountAmount > 0 && <div className="pos-receipt-row"><span>SC/PWD discount</span><span>-₱{discountAmount.toFixed(2)}</span></div>}
      {loyaltyDiscountAmount > 0 && <div className="pos-receipt-row"><span>Loyalty Discount</span><span>-₱{loyaltyDiscountAmount.toFixed(2)}</span></div>}
      {deliveryFee > 0 && <div className="pos-receipt-row"><span>Delivery fee</span><span>₱{deliveryFee.toFixed(2)}</span></div>}
      <div className="pos-receipt-row pos-receipt-total">
        <span>TOTAL</span>
        <span>₱{total.toFixed(2)}</span>
      </div>
      {cashReceived !== undefined && <div className="pos-receipt-row"><span>Cash received</span><span>₱{cashReceived.toFixed(2)}</span></div>}
      {change !== undefined && <div className="pos-receipt-row"><span>Change</span><span>₱{change.toFixed(2)}</span></div>}
      {beneficiaries.length > 0 && (
        <>
          <hr className="pos-receipt-divider" />
          <div className="pos-receipt-label">SC/PWD DETAILS</div>
          {beneficiaries.map((beneficiary, index) => (
            <div key={index} className="pos-receipt-discount-detail">
              <div>{beneficiary.discountType.toUpperCase()} BENEFICIARY{beneficiary.beneficiaryName ? `: ${beneficiary.beneficiaryName}` : ''}</div>
              {beneficiary.beneficiaryAddress && <div>Address: {beneficiary.beneficiaryAddress}</div>}
              {beneficiary.beneficiaryTin?.trim() && <div>TIN: {beneficiary.beneficiaryTin}</div>}
              {beneficiary.idType && <div>{beneficiary.idType.replaceAll('_', ' ').toUpperCase()}: {beneficiary.idNumber}</div>}
              {!beneficiary.idType && <div>ID: {beneficiary.idNumber}</div>}
              {beneficiary.groupSize != null && <div>Group size: {beneficiary.groupSize} {beneficiary.groupSize === 1 ? 'customer' : 'customers'}</div>}
              {beneficiary.eligibleGrossAmount != null && <div>Personal food share: ₱{beneficiary.eligibleGrossAmount.toFixed(2)}</div>}
              <div>Eligible net amount: ₱{beneficiary.eligibleAmount.toFixed(2)} · Discount: ₱{beneficiary.discountAmount.toFixed(2)}</div>
            </div>
          ))}
          <div className="pos-receipt-signature">Customer signature: ____________________</div>
        </>
      )}
      <hr className="pos-receipt-divider" />
      <div className="pos-receipt-center">Thank you for your order!</div>
    </div>
  );
}
