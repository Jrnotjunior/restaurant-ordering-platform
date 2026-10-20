-- API callers should not invoke trigger/event-trigger functions directly.
ALTER FUNCTION public.notify_customer_order_changed()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.notify_customer_order_changed()
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.notify_restaurant_order_changed()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.notify_restaurant_order_changed()
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.protect_system_admin_restaurant_tax_settings()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.protect_system_admin_restaurant_tax_settings()
  FROM PUBLIC, anon, authenticated;

-- Some hosted projects provide this event-trigger helper outside the checked-in
-- migration chain. Restrict it when present, but do not require it on clean installs.
DO $event_trigger_acl$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END;
$event_trigger_acl$;

-- System-admin RPCs are for signed-in callers only. Their function bodies retain
-- their own owner/manage/view-only authorization checks.
DO $block$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.proname LIKE 'system_admin_%'
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.signature);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.signature);
  END LOOP;
END;
$block$;
