-- SECURITY DEFINER payment RPCs must not implicitly search pg_temp before
-- the trusted schema. Preserve their current authorization grants and logic.
ALTER FUNCTION public.finalize_online_payment(text, text, text, text, numeric, numeric)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.mark_pending_online_payment_status(text, text)
  SET search_path = public, pg_temp;
