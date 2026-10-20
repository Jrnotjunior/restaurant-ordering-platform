ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS paymongo_refund_transfer_link text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_cancellation_refund_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_cancellation_refund_status_check
  CHECK (
    cancellation_refund_status IS NULL
    OR cancellation_refund_status = ANY (
      ARRAY['not_required','pending','processing','succeeded','failed','manual_review','simulated']::text[]
    )
  );

COMMENT ON COLUMN public.orders.paymongo_refund_transfer_link IS
  'PayMongo QR Ph refund claim link. It remains usable while the refund is processing and should be shared securely with the customer.';
