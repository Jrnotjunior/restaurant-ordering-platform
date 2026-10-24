-- Restaurant owners control tenant workflow/payment/tax settings after System Admin isolation.
-- This changes authorization only; it does not change restaurant records.
CREATE OR REPLACE FUNCTION public.protect_system_admin_online_payments_toggle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF coalesce((NEW.online_payment_methods ->> 'enabled')::boolean, true)
       IS DISTINCT FROM coalesce((OLD.online_payment_methods ->> 'enabled')::boolean, true)
     AND NOT EXISTS (
       SELECT 1 FROM public.restaurants r
       WHERE r.id = OLD.id AND r.owner_id = auth.uid()
     )
  THEN
    RAISE EXCEPTION 'Only the restaurant owner may change online payment availability.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_system_admin_restaurant_tax_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF (
       NEW.tax_vat_registered IS DISTINCT FROM OLD.tax_vat_registered
       OR NEW.tax_prices_vat_inclusive IS DISTINCT FROM OLD.tax_prices_vat_inclusive
       OR NEW.tax_vat_rate IS DISTINCT FROM OLD.tax_vat_rate
       OR NEW.cash_on_pickup_enabled IS DISTINCT FROM OLD.cash_on_pickup_enabled
       OR NEW.cash_on_take_out_enabled IS DISTINCT FROM OLD.cash_on_take_out_enabled
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.restaurants r
       WHERE r.id = OLD.id AND r.owner_id = auth.uid()
     )
  THEN
    RAISE EXCEPTION 'Only the restaurant owner may change restaurant tax and pickup/take-out settings.';
  END IF;
  RETURN NEW;
END;
$function$;

-- The earlier migration created this unused function, but no trigger was attached to it.
DROP FUNCTION IF EXISTS public.protect_system_workflow_settings();
