-- Ensure every delivery order enters dispatch with an explicit unassigned state.
-- Existing NULL delivery states are normalized so Delivery Dispatch can find them.

UPDATE public.orders
SET delivery_status = 'unassigned'
WHERE order_type = 'delivery'
  AND delivery_status IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN delivery_status SET DEFAULT 'unassigned';
