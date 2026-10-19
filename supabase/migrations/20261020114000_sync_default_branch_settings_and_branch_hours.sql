-- Keep legacy single-location settings aligned with the default branch while
-- allowing non-default branches to have their own address, hours and delivery
-- configuration. This migration also makes insert-time availability checks use
-- the branch selected by the branch-aware checkout RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.sync_default_branch_from_restaurant_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Prevent the two compatibility triggers from recursively syncing each other.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  UPDATE public.restaurant_branches
  SET store_address = NEW.store_address,
      restaurant_address = NEW.restaurant_address,
      contact_number = NEW.contact_number,
      operating_hours = coalesce(NEW.operating_hours, '{}'::jsonb),
      delivery_location_latitude = NEW.delivery_location_latitude,
      delivery_location_longitude = NEW.delivery_location_longitude,
      delivery_base_fee = coalesce(NEW.delivery_base_fee, 0),
      delivery_distance_increment_meters = coalesce(NEW.delivery_distance_increment_meters, 500),
      delivery_fee_per_increment = coalesce(NEW.delivery_fee_per_increment, 10),
      delivery_max_distance_meters = coalesce(NEW.delivery_max_distance_meters, 10000),
      updated_at = now()
  WHERE restaurant_id = NEW.id
    AND is_default = true;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_default_branch_to_restaurant_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 OR NOT NEW.is_default THEN
    RETURN NEW;
  END IF;

  UPDATE public.restaurants
  SET store_address = NEW.store_address,
      restaurant_address = NEW.restaurant_address,
      contact_number = NEW.contact_number,
      operating_hours = coalesce(NEW.operating_hours, '{}'::jsonb),
      delivery_location_latitude = NEW.delivery_location_latitude,
      delivery_location_longitude = NEW.delivery_location_longitude,
      delivery_base_fee = coalesce(NEW.delivery_base_fee, 0),
      delivery_distance_increment_meters = coalesce(NEW.delivery_distance_increment_meters, 500),
      delivery_fee_per_increment = coalesce(NEW.delivery_fee_per_increment, 10),
      delivery_max_distance_meters = coalesce(NEW.delivery_max_distance_meters, 10000),
      updated_at = now()
  WHERE id = NEW.restaurant_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS restaurants_sync_default_branch_settings ON public.restaurants;
CREATE TRIGGER restaurants_sync_default_branch_settings
AFTER UPDATE OF store_address, restaurant_address, contact_number, operating_hours,
  delivery_location_latitude, delivery_location_longitude, delivery_base_fee,
  delivery_distance_increment_meters, delivery_fee_per_increment, delivery_max_distance_meters
ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.sync_default_branch_from_restaurant_settings();

DROP TRIGGER IF EXISTS restaurant_branches_sync_default_settings ON public.restaurant_branches;
CREATE TRIGGER restaurant_branches_sync_default_settings
AFTER UPDATE OF is_default, store_address, restaurant_address, contact_number, operating_hours,
  delivery_location_latitude, delivery_location_longitude, delivery_base_fee,
  delivery_distance_increment_meters, delivery_fee_per_increment, delivery_max_distance_meters
ON public.restaurant_branches
FOR EACH ROW EXECUTE FUNCTION public.sync_default_branch_to_restaurant_settings();

REVOKE ALL ON FUNCTION public.sync_default_branch_from_restaurant_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_default_branch_to_restaurant_settings() FROM PUBLIC, anon, authenticated;

-- A branch-aware wrapper sets this transaction-local context before calling the
-- older core RPC. The BEFORE INSERT trigger assigns the selected branch early,
-- so all subsequent order triggers use the same branch consistently.
CREATE OR REPLACE FUNCTION public.assign_default_branch_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
  v_requested_branch_text text;
  v_requested_branch_id uuid;
BEGIN
  v_requested_branch_text := nullif(current_setting('web2table.branch_id', true), '');

  IF v_requested_branch_text IS NOT NULL THEN
    BEGIN
      v_requested_branch_id := v_requested_branch_text::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid selected branch';
    END;

    IF NEW.branch_id IS NOT NULL AND NEW.branch_id <> v_requested_branch_id THEN
      RAISE EXCEPTION 'Selected branch does not match the order branch';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.restaurant_branches b
      WHERE b.id = v_requested_branch_id
        AND b.restaurant_id = NEW.restaurant_id
        AND b.is_active = true
    ) THEN
      RAISE EXCEPTION 'Selected branch does not belong to this restaurant or is inactive';
    END IF;

    NEW.branch_id := v_requested_branch_id;
  ELSIF NEW.branch_id IS NULL THEN
    SELECT b.id INTO v_branch_id
    FROM public.restaurant_branches b
    WHERE b.restaurant_id = NEW.restaurant_id
      AND b.is_default = true
      AND b.is_active = true
    LIMIT 1;

    IF v_branch_id IS NULL THEN
      RAISE EXCEPTION 'The restaurant has no active default branch configured';
    END IF;
    NEW.branch_id := v_branch_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.restaurant_branches b
    WHERE b.id = NEW.branch_id
      AND b.restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'Selected branch does not belong to this restaurant';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.assign_default_branch_before_insert() FROM PUBLIC, anon, authenticated;

-- Use the branch selected before INSERT, not the old business-wide hours field.
-- restaurants.ordering_enabled remains the business-wide emergency pause.
CREATE OR REPLACE FUNCTION public.prevent_orders_when_store_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ordering_enabled boolean;
  v_branch_ordering_enabled boolean;
  v_operating_hours jsonb;
  v_day_key text;
  v_day jsonb;
  v_open text;
  v_close text;
  v_now_minutes integer;
  v_open_minutes integer;
  v_close_minutes integer;
  v_is_open boolean;
  v_customer_id uuid;
BEGIN
  SELECT r.ordering_enabled, b.ordering_enabled, b.operating_hours
    INTO v_ordering_enabled, v_branch_ordering_enabled, v_operating_hours
  FROM public.restaurants r
  JOIN public.restaurant_branches b
    ON b.id = NEW.branch_id
   AND b.restaurant_id = r.id
   AND b.is_active = true
  WHERE r.id = NEW.restaurant_id
    AND r.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant or selected branch is not available';
  END IF;

  -- Automatically link signed-in customers to their orders.
  IF auth.uid() IS NOT NULL AND NEW.customer_id IS NULL THEN
    SELECT cp.id INTO v_customer_id
    FROM public.customer_profiles cp
    WHERE cp.restaurant_id = NEW.restaurant_id
      AND cp.auth_user_id = auth.uid()
    LIMIT 1;

    IF v_customer_id IS NOT NULL THEN
      NEW.customer_id := v_customer_id;
    END IF;
  END IF;

  IF NOT coalesce(v_ordering_enabled, true) THEN
    RAISE EXCEPTION 'The store is currently closed and is not accepting new orders.';
  END IF;

  IF NOT coalesce(v_branch_ordering_enabled, true) THEN
    RAISE EXCEPTION 'This branch has paused online ordering.';
  END IF;

  IF v_operating_hours IS NULL THEN
    RETURN NEW;
  END IF;

  v_day_key := lower(to_char(now() at time zone 'Asia/Manila', 'FMDay'));
  v_day := v_operating_hours -> v_day_key;

  IF v_day IS NULL OR coalesce((v_day ->> 'isOpen')::boolean, true) = false THEN
    RAISE EXCEPTION 'This branch is currently closed and is not accepting new orders.';
  END IF;

  v_open := v_day ->> 'open';
  v_close := v_day ->> 'close';

  IF v_open IS NULL OR v_close IS NULL THEN
    RAISE EXCEPTION 'This branch has incomplete operating hours and cannot accept orders.';
  END IF;

  v_now_minutes :=
    extract(hour from (now() at time zone 'Asia/Manila'))::integer * 60
    + extract(minute from (now() at time zone 'Asia/Manila'))::integer;

  v_open_minutes := split_part(v_open, ':', 1)::integer * 60
    + split_part(v_open, ':', 2)::integer;

  v_close_minutes := split_part(v_close, ':', 1)::integer * 60
    + split_part(v_close, ':', 2)::integer;

  v_is_open := CASE
    WHEN v_open_minutes = v_close_minutes THEN true
    WHEN v_close_minutes > v_open_minutes THEN
      v_now_minutes >= v_open_minutes AND v_now_minutes < v_close_minutes
    ELSE
      v_now_minutes >= v_open_minutes OR v_now_minutes < v_close_minutes
  END;

  IF NOT v_is_open THEN
    RAISE EXCEPTION 'This branch is currently closed and is not accepting new orders.';
  END IF;

  RETURN NEW;
END;
$function$;

-- Patch the branch-aware orderability guard: non-default locations must have
-- an address and every branch must have a complete hours entry for each day.
DO $branch_guard$
DECLARE
  v_definition text;
  v_replaced text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'assert_restaurant_branch_orderable'
    AND pg_get_function_identity_arguments(p.oid) = 'p_restaurant_id uuid, p_branch_id uuid';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected branch-orderability guard was not found';
  END IF;

  v_replaced := replace(
    v_definition,
    '  IF NOT v_branch.ordering_enabled THEN',
    '  IF NOT v_branch.is_default
    AND nullif(trim(coalesce(v_branch.store_address, '''')), '''') IS NULL
    AND nullif(trim(coalesce(v_branch.restaurant_address, '''')), '''') IS NULL THEN
    RAISE EXCEPTION ''This branch must have a store address configured before it can accept orders'';
  END IF;

  IF NOT v_branch.ordering_enabled THEN'
  );

  IF v_replaced = v_definition THEN
    RAISE EXCEPTION 'Could not add branch address validation';
  END IF;

  v_definition := v_replaced;
  v_replaced := replace(
    v_definition,
    '  IF v_hours IS NOT NULL THEN',
    '  IF v_hours IS NULL THEN
    RAISE EXCEPTION ''This branch has not configured operating hours'';
  END IF;

  IF v_hours IS NOT NULL THEN'
  );

  IF v_replaced = v_definition THEN
    RAISE EXCEPTION 'Could not require branch operating hours';
  END IF;

  EXECUTE v_replaced;
END;
$branch_guard$;

-- Ensure the branch context is set in every overload carrying p_branch_id.
DO $branch_wrappers$
DECLARE
  v_row record;
  v_definition text;
  v_replaced text;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'create_order_with_guest_cancel_token',
        'create_order_from_delivery_quote_with_guest_cancel_token',
        'create_pending_online_payment_with_guest_cancel_token',
        'create_pending_online_payment_from_delivery_quote_with_guest_cancel_token'
      )
      AND pg_get_function_identity_arguments(p.oid) LIKE '%p_branch_id uuid'
  LOOP
    v_definition := pg_get_functiondef(v_row.oid);
    v_replaced := replace(
      v_definition,
      'PERFORM public.assert_restaurant_branch_orderable(p_restaurant_id, p_branch_id);',
      'PERFORM set_config(''web2table.branch_id'', p_branch_id::text, true);' || E'\n  ' ||
      'PERFORM public.assert_restaurant_branch_orderable(p_restaurant_id, p_branch_id);'
    );

    IF v_replaced = v_definition THEN
      RAISE EXCEPTION 'Could not set selected branch context in % (%)', v_row.proname, v_row.args;
    END IF;

    EXECUTE v_replaced;
    v_count := v_count + 1;
  END LOOP;

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Expected to patch 4 branch-aware order RPCs, patched %', v_count;
  END IF;
END;
$branch_wrappers$;

COMMIT;
