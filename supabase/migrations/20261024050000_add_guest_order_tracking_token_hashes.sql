-- Add storage for a dedicated guest order-tracking capability.
-- This is additive only: existing UUID-based tracking remains available until
-- the replacement RPC and all checkout/recovery paths are validated end to end.
-- Never store the raw tracking token in the database.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS guest_tracking_token_hash text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_guest_tracking_token_hash_format_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_guest_tracking_token_hash_format_check
  CHECK (
    guest_tracking_token_hash IS NULL
    OR guest_tracking_token_hash ~ '^[0-9a-f]{64}$'
  );

ALTER TABLE public.pending_online_payments
  ADD COLUMN IF NOT EXISTS guest_tracking_token_hash text;

ALTER TABLE public.pending_online_payments
  DROP CONSTRAINT IF EXISTS pending_online_payments_guest_tracking_token_hash_format_check;
ALTER TABLE public.pending_online_payments
  ADD CONSTRAINT pending_online_payments_guest_tracking_token_hash_format_check
  CHECK (
    guest_tracking_token_hash IS NULL
    OR guest_tracking_token_hash ~ '^[0-9a-f]{64}$'
  );

COMMIT;

NOTIFY pgrst, 'reload schema';
