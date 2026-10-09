-- Pin SECURITY DEFINER name resolution for guest checkout and public lookup RPCs.
-- These RPCs remain callable by anon where the storefront requires it; this migration
-- does not change their execute grants or business logic.
ALTER FUNCTION public.create_order(uuid, text, text, text, text, text, text, text, text, boolean, jsonb)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.create_order(uuid, text, text, text, text, text, text, text, text, boolean, jsonb, text, text, text, double precision, double precision, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.create_order_from_delivery_quote(uuid, text, text, text, text, text, text, text, jsonb, text, text, text, double precision, double precision, text, uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.create_pending_online_payment(uuid, text, text, text, text, text, text, text, boolean, jsonb, boolean)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.create_pending_online_payment(uuid, text, text, text, text, text, text, text, boolean, jsonb, boolean, text, text, text, double precision, double precision, text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.create_pending_online_payment_from_delivery_quote(uuid, text, text, text, text, text, text, jsonb, boolean, text, text, text, double precision, double precision, text, uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_online_payment_status(text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_order_status(text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.get_restaurant_tax_settings(uuid)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.resolve_restaurant_by_domain(text)
  SET search_path = public, pg_temp;
ALTER FUNCTION public.restaurant_public_self_ordering_enabled(uuid)
  SET search_path = public, pg_temp;
