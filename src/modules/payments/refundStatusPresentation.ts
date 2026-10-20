export type RefundPresentationStatus =
  | "not_required"
  | "pending"
  | "processing"
  | "simulated"
  | "failed"
  | "manual_review"
  | "succeeded"
  | "refunding"
  | string
  | null
  | undefined;

export function getTrackedPaymentStatusLabel(
  paymentStatus: string,
  refundStatus: RefundPresentationStatus,
): string {
  if (refundStatus === "simulated") {
    return "PayMongo still marks this payment PAID · Test refund simulated";
  }
  if (refundStatus === "pending" || refundStatus === "processing" || refundStatus === "refunding") {
    return "PayMongo still marks this payment PAID · Refund processing";
  }
  if (refundStatus === "failed") {
    return "PayMongo still marks this payment PAID · Refund failed";
  }
  if (refundStatus === "manual_review") {
    return "PayMongo still marks this payment PAID · Refund needs review";
  }
  if (refundStatus === "succeeded" || paymentStatus === "refunded") {
    return "Payment refunded";
  }
  if (paymentStatus === "paid") return "Payment confirmed";
  if (paymentStatus === "failed") return "Payment failed";
  return "Payment pending";
}

export function getCancellationResultMessage(
  paymentStatus: string,
  refundStatus: RefundPresentationStatus,
  fallbackMessage: string,
): string {
  if (refundStatus === "simulated") {
    return "TEST MODE ONLY: Your order has been cancelled. The refund was simulated locally; PayMongo still shows the payment as PAID. No refund was issued by PayMongo.";
  }
  if (paymentStatus === "refunded" && refundStatus !== "failed" && refundStatus !== "manual_review") {
    return "Your order has been cancelled and the refund completed successfully.";
  }
  return fallbackMessage;
}
