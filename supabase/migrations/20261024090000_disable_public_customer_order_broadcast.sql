-- The legacy customer tracking broadcast uses a public topic and exposes order
-- numbers/statuses to anyone who subscribes. Protected tracking reads and the
-- page's refresh fallback do not need this broadcast payload.
BEGIN;

DROP TRIGGER IF EXISTS orders_customer_realtime_trigger ON public.orders;

REVOKE ALL ON FUNCTION public.notify_customer_order_changed()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
