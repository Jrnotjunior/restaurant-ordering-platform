-- Restore active columns and audit primitives that exist on the live project
-- but were missing from the checked-in migration chain. This is additive and
-- intentionally excludes the retired multi-branch subsystem.

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_third_party_courier boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paymongo_refund_transfer_link text;

ALTER TABLE public.delivery_assignments
  ADD COLUMN IF NOT EXISTS rider_name text,
  ADD COLUMN IF NOT EXISTS picked_up_at timestamptz;

-- Internal order-number counter is only called by SECURITY DEFINER RPCs.
ALTER TABLE public.restaurant_order_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.restaurant_order_counters FROM PUBLIC, anon, authenticated;

-- Immutable-by-API audit history. All inserts go through the guarded RPC below.
CREATE TABLE IF NOT EXISTS public.system_admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_admin_audit_logs_action
  ON public.system_admin_audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_system_admin_audit_logs_admin_user_id
  ON public.system_admin_audit_logs (admin_user_id);
CREATE INDEX IF NOT EXISTS idx_system_admin_audit_logs_created_at
  ON public.system_admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_admin_audit_logs_event_type
  ON public.system_admin_audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_system_admin_audit_logs_restaurant_id
  ON public.system_admin_audit_logs (restaurant_id);

ALTER TABLE public.system_admin_audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.system_admin_audit_logs FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "System admins can view audit logs" ON public.system_admin_audit_logs;
CREATE POLICY "System admins can view audit logs"
ON public.system_admin_audit_logs FOR SELECT TO authenticated
USING (public.system_admin_has_access());

-- Remove the old profile RPC overloads before changing the result contract.
-- PostgreSQL cannot replace a function with a different RETURNS TABLE signature.
DROP FUNCTION IF EXISTS public.upsert_customer_profile(uuid, text, text);
DROP FUNCTION IF EXISTS public.upsert_customer_profile(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.system_admin_write_audit_log(p_event_type text, p_action text, p_restaurant_id uuid DEFAULT NULL::uuid, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_details jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
DECLARE
  v_log_id uuid;
BEGIN
  IF NOT public.system_admin_has_manage_access() THEN
    RAISE EXCEPTION 'System Administrator authorization required';
  END IF;

  INSERT INTO public.system_admin_audit_logs (
    admin_user_id,
    restaurant_id,
    event_type,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    auth.uid(),
    p_restaurant_id,
    p_event_type,
    p_action,
    p_entity_type,
    p_entity_id,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_touch_presence()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated customer required';
  END IF;

  UPDATE public.customer_profiles
  SET
    last_seen_at = now(),
    updated_at = now()
  WHERE auth_user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer profile not found';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_customer_profile(p_restaurant_id uuid, p_first_name text, p_last_name text, p_phone text DEFAULT NULL::text)
 RETURNS TABLE(customer_id uuid, restaurant_id uuid, first_name text, last_name text, phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE v_customer_id uuid; v_first_name text := trim(coalesce(p_first_name, '')); v_last_name text := trim(coalesce(p_last_name, '')); BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in'; END IF; IF p_restaurant_id IS NULL OR p_restaurant_id <> public.get_request_restaurant_id() THEN RAISE EXCEPTION 'Customer account must be created for the current restaurant'; END IF; IF NOT EXISTS (SELECT 1 FROM public.restaurants AS r WHERE r.id = p_restaurant_id AND r.is_active = true) THEN RAISE EXCEPTION 'Restaurant not found or inactive'; END IF; IF v_first_name = '' OR v_last_name = '' THEN RAISE EXCEPTION 'First name and last name are required'; END IF; INSERT INTO public.customer_profiles AS cp (restaurant_id, auth_user_id, first_name, last_name, phone) VALUES (p_restaurant_id, auth.uid(), v_first_name, v_last_name, nullif(trim(coalesce(p_phone, '')), '')) ON CONFLICT ON CONSTRAINT customer_profiles_restaurant_user_unique DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = EXCLUDED.phone, updated_at = now() RETURNING cp.id INTO v_customer_id; INSERT INTO public.customer_loyalty_accounts AS cla(customer_id) VALUES (v_customer_id) ON CONFLICT ON CONSTRAINT customer_loyalty_accounts_customer_id_key DO NOTHING; RETURN QUERY SELECT profile.id, profile.restaurant_id, profile.first_name, profile.last_name, profile.phone FROM public.customer_profiles AS profile WHERE profile.id = v_customer_id; END; $function$;

CREATE OR REPLACE FUNCTION public.restaurant_change_inventory_unit(p_item_id uuid, p_new_unit text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_item public.restaurant_inventory_items%ROWTYPE;
  v_old_key text;
  v_new_key text;
  v_old_factor numeric;
  v_new_factor numeric;
  v_old_dimension text;
  v_new_dimension text;
  v_stock numeric;
  v_threshold numeric;
BEGIN
  IF NOT public.privileged_restaurant_mfa_verified() THEN
    RAISE EXCEPTION 'Multi-factor authentication is required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item
  FROM public.restaurant_inventory_items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory item not found.';
  END IF;
  IF NOT public.is_restaurant_owner(v_item.restaurant_id) THEN
    RAISE EXCEPTION 'Not authorized to change this inventory item.';
  END IF;

  v_old_key := lower(btrim(v_item.unit));
  v_new_key := lower(btrim(coalesce(p_new_unit, '')));
  IF v_new_key = '' THEN
    RAISE EXCEPTION 'Choose a stock unit.';
  END IF;
  IF v_old_key = v_new_key THEN
    RETURN;
  END IF;

  -- Convert only measurements with a known, safe relationship. Package units
  -- such as pack, bottle, box, and bag are intentionally not interchangeable.
  CASE v_old_key
    WHEN 'mg' THEN v_old_dimension := 'mass'; v_old_factor := 0.000001;
    WHEN 'g' THEN v_old_dimension := 'mass'; v_old_factor := 0.001;
    WHEN 'kg' THEN v_old_dimension := 'mass'; v_old_factor := 1;
    WHEN 'ml' THEN v_old_dimension := 'volume'; v_old_factor := 0.001;
    WHEN 'l' THEN v_old_dimension := 'volume'; v_old_factor := 1;
    WHEN 'pcs' THEN v_old_dimension := 'count'; v_old_factor := 1;
    WHEN 'pc' THEN v_old_dimension := 'count'; v_old_factor := 1;
    WHEN 'piece' THEN v_old_dimension := 'count'; v_old_factor := 1;
    WHEN 'pieces' THEN v_old_dimension := 'count'; v_old_factor := 1;
    WHEN 'unit' THEN v_old_dimension := 'count'; v_old_factor := 1;
    WHEN 'units' THEN v_old_dimension := 'count'; v_old_factor := 1;
    ELSE v_old_dimension := 'custom'; v_old_factor := 1;
  END CASE;

  CASE v_new_key
    WHEN 'mg' THEN v_new_dimension := 'mass'; v_new_factor := 0.000001;
    WHEN 'g' THEN v_new_dimension := 'mass'; v_new_factor := 0.001;
    WHEN 'kg' THEN v_new_dimension := 'mass'; v_new_factor := 1;
    WHEN 'ml' THEN v_new_dimension := 'volume'; v_new_factor := 0.001;
    WHEN 'l' THEN v_new_dimension := 'volume'; v_new_factor := 1;
    WHEN 'pcs' THEN v_new_dimension := 'count'; v_new_factor := 1;
    WHEN 'pc' THEN v_new_dimension := 'count'; v_new_factor := 1;
    WHEN 'piece' THEN v_new_dimension := 'count'; v_new_factor := 1;
    WHEN 'pieces' THEN v_new_dimension := 'count'; v_new_factor := 1;
    WHEN 'unit' THEN v_new_dimension := 'count'; v_new_factor := 1;
    WHEN 'units' THEN v_new_dimension := 'count'; v_new_factor := 1;
    WHEN 'pack' THEN v_new_dimension := 'custom'; v_new_factor := 1;
    WHEN 'bottle' THEN v_new_dimension := 'custom'; v_new_factor := 1;
    WHEN 'box' THEN v_new_dimension := 'custom'; v_new_factor := 1;
    WHEN 'bag' THEN v_new_dimension := 'custom'; v_new_factor := 1;
    WHEN 'can' THEN v_new_dimension := 'custom'; v_new_factor := 1;
    WHEN 'portion' THEN v_new_dimension := 'custom'; v_new_factor := 1;
    WHEN 'roll' THEN v_new_dimension := 'custom'; v_new_factor := 1;
    ELSE RAISE EXCEPTION 'Unsupported stock unit: %', p_new_unit;
  END CASE;

  IF v_old_dimension <> v_new_dimension OR v_old_dimension = 'custom' THEN
    RAISE EXCEPTION 'Cannot automatically convert % to %. Choose a compatible measurement (g/kg/mg, ml/L, or pieces), or keep the current unit.', v_item.unit, p_new_unit;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurant_inventory_items other
    WHERE other.restaurant_id = v_item.restaurant_id
      AND other.id <> v_item.id
      AND lower(btrim(other.name)) = lower(btrim(v_item.name))
      AND lower(btrim(other.unit)) = v_new_key
  ) THEN
    RAISE EXCEPTION 'Another inventory item already uses this name and stock unit.';
  END IF;

  v_stock := v_item.quantity_on_hand * v_old_factor / v_new_factor;
  v_threshold := v_item.low_stock_threshold * v_old_factor / v_new_factor;
  IF v_stock <> round(v_stock, 3) OR v_threshold <> round(v_threshold, 3) THEN
    RAISE EXCEPTION 'This conversion needs more than 3 decimal places. Choose a larger unit so stock can be represented accurately.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.restaurant_menu_recipe_ingredients r
    WHERE r.inventory_item_id = v_item.id
      AND (r.quantity_per_product * v_old_factor / v_new_factor) <> round(r.quantity_per_product * v_old_factor / v_new_factor, 3)
  ) THEN
    RAISE EXCEPTION 'A linked recipe quantity cannot be represented accurately in the new stock unit. Update the recipe quantities first.';
  END IF;

  UPDATE public.restaurant_inventory_items
  SET unit = CASE WHEN v_new_key = 'l' THEN 'L' ELSE
                  CASE WHEN v_new_key IN ('pc','piece','pieces','unit','units') THEN 'pcs' ELSE btrim(p_new_unit) END
             END,
      quantity_on_hand = v_stock,
      low_stock_threshold = v_threshold,
      updated_at = now()
  WHERE id = v_item.id;

  UPDATE public.restaurant_menu_recipe_ingredients
  SET quantity_per_product = quantity_per_product * v_old_factor / v_new_factor,
      updated_at = now()
  WHERE inventory_item_id = v_item.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_order_to_kitchen(p_order_id uuid)
 RETURNS TABLE(order_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_restaurant_id uuid;
  v_owner_id uuid;
  v_role text;
  v_status text;
  v_payment_status text;
  v_cancellation_refund_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT o.restaurant_id, r.owner_id, o.status, o.payment_status, o.cancellation_refund_status
    INTO v_restaurant_id, v_owner_id, v_status, v_payment_status, v_cancellation_refund_status
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE o.id = p_order_id AND r.is_active = true
  FOR UPDATE OF o;

  IF NOT public.privileged_restaurant_mfa_verified() THEN
    RAISE EXCEPTION 'Multi-factor authentication is required' USING ERRCODE = '42501';
  END IF;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Order not found or restaurant is inactive' USING ERRCODE = '42501';
  END IF;

  IF v_owner_id = auth.uid() THEN
    v_role := 'owner';
  ELSE
    SELECT s.role INTO v_role
    FROM public.restaurant_staff s
    WHERE s.restaurant_id = v_restaurant_id
      AND s.auth_user_id = auth.uid()
      AND s.is_active = true
      AND s.role IN ('cashier', 'kitchen')
    LIMIT 1;
  END IF;

  IF v_role NOT IN ('owner', 'cashier') OR v_role IS NULL THEN
    RAISE EXCEPTION 'Only an authorized cashier or restaurant owner can send this order to the kitchen' USING ERRCODE = '42501';
  END IF;

  IF v_cancellation_refund_status = 'processing' THEN
    RAISE EXCEPTION 'A payment refund is in progress; this order cannot be sent to the kitchen yet' USING ERRCODE = '42501';
  END IF;

  IF v_payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Payment must be completed before sending this order to the kitchen' USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('pending', 'confirmed', 'preparing') THEN
    RAISE EXCEPTION 'This order cannot be sent to the kitchen from its current status' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  UPDATE public.orders o
  SET status = 'preparing', updated_at = now()
  WHERE o.id = p_order_id AND o.restaurant_id = v_restaurant_id
  RETURNING o.id, o.status;
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_get_audit_logs(p_restaurant_id uuid DEFAULT NULL::uuid, p_event_type text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text, p_start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_date timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, admin_user_id uuid, admin_email text, admin_name text, restaurant_id uuid, restaurant_name text, event_type text, action text, entity_type text, entity_id uuid, details jsonb, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.system_admin_has_access() THEN
    RAISE EXCEPTION 'System Administrator authorization required';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 50;
  END IF;

  IF p_limit > 100 THEN
    p_limit := 100;
  END IF;

  IF p_offset IS NULL OR p_offset < 0 THEN
    p_offset := 0;
  END IF;

  RETURN QUERY
  SELECT
    sal.id,
    sal.admin_user_id,
    au.email::text AS admin_email,
    COALESCE(
      au.raw_user_meta_data ->> 'full_name',
      au.raw_user_meta_data ->> 'name'
    )::text AS admin_name,
    sal.restaurant_id,
    r.name::text AS restaurant_name,
    sal.event_type,
    sal.action,
    sal.entity_type,
    sal.entity_id,
    sal.details,
    sal.created_at
  FROM public.system_admin_audit_logs sal
  LEFT JOIN auth.users au
    ON au.id = sal.admin_user_id
  LEFT JOIN public.restaurants r
    ON r.id = sal.restaurant_id
  WHERE
    (p_restaurant_id IS NULL OR sal.restaurant_id = p_restaurant_id)
    AND (p_event_type IS NULL OR sal.event_type = p_event_type)
    AND (p_start_date IS NULL OR sal.created_at >= p_start_date)
    AND (p_end_date IS NULL OR sal.created_at < p_end_date)
    AND (
      p_search IS NULL
      OR btrim(p_search) = ''
      OR (
        COALESCE(au.email, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(
          au.raw_user_meta_data ->> 'full_name',
          au.raw_user_meta_data ->> 'name',
          ''
        ) ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(r.name, '') ILIKE '%' || btrim(p_search) || '%'
        OR sal.event_type ILIKE '%' || btrim(p_search) || '%'
        OR sal.action ILIKE '%' || btrim(p_search) || '%'
        OR sal.entity_type ILIKE '%' || btrim(p_search) || '%'
        OR sal.details::text ILIKE '%' || btrim(p_search) || '%'
      )
    )
  ORDER BY sal.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_get_dashboard_summary()
 RETURNS TABLE(total_restaurants bigint, active_restaurants bigint, inactive_restaurants bigint, active_system_administrators bigint, pending_system_administrators bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.system_admin_has_access() THEN
    RAISE EXCEPTION 'System Administrator authorization required';
  END IF;

  RETURN QUERY
  SELECT
    (
      SELECT COUNT(*)
      FROM public.restaurants
    ) AS total_restaurants,

    (
      SELECT COUNT(*)
      FROM public.restaurants
      WHERE is_active = true
    ) AS active_restaurants,

    (
      SELECT COUNT(*)
      FROM public.restaurants
      WHERE is_active = false
    ) AS inactive_restaurants,

    (
      SELECT COUNT(*)
      FROM public.system_admin_access
      WHERE is_active = true
        AND status = 'active'
    ) AS active_system_administrators,

    (
      SELECT COUNT(*)
      FROM public.system_admin_access
      WHERE status = 'pending'
    ) AS pending_system_administrators;
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_get_restaurant_monitoring()
 RETURNS TABLE(restaurant_id uuid, restaurant_name text, is_active boolean, customer_accounts bigint, customers_ordered_today bigint, orders_today bigint, processing_orders bigint, last_activity timestamp with time zone, logged_in_now bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.system_admin_has_access() THEN
    RAISE EXCEPTION 'System Administrator authorization required';
  END IF;

  RETURN QUERY
  SELECT
    r.id AS restaurant_id,
    r.name AS restaurant_name,
    r.is_active,

    (
      SELECT COUNT(*)
      FROM public.customer_profiles cp
      WHERE cp.restaurant_id = r.id
    ) AS customer_accounts,

    (
      SELECT COUNT(DISTINCT o.customer_id)
      FROM public.orders o
      WHERE o.restaurant_id = r.id
        AND o.created_at >= date_trunc(
          'day',
          now() AT TIME ZONE 'Asia/Manila'
        ) AT TIME ZONE 'Asia/Manila'
        AND o.created_at <
          (
            date_trunc(
              'day',
              now() AT TIME ZONE 'Asia/Manila'
            ) + interval '1 day'
          ) AT TIME ZONE 'Asia/Manila'
        AND o.customer_id IS NOT NULL
    ) AS customers_ordered_today,

    (
      SELECT COUNT(*)
      FROM public.orders o
      WHERE o.restaurant_id = r.id
        AND o.created_at >= date_trunc(
          'day',
          now() AT TIME ZONE 'Asia/Manila'
        ) AT TIME ZONE 'Asia/Manila'
        AND o.created_at <
          (
            date_trunc(
              'day',
              now() AT TIME ZONE 'Asia/Manila'
            ) + interval '1 day'
          ) AT TIME ZONE 'Asia/Manila'
    ) AS orders_today,

    (
      SELECT COUNT(*)
      FROM public.orders o
      WHERE o.restaurant_id = r.id
        AND o.status IN (
          'pending',
          'confirmed',
          'preparing',
          'ready',
          'out_for_delivery'
        )
    ) AS processing_orders,

    (
      SELECT MAX(o.updated_at)
      FROM public.orders o
      WHERE o.restaurant_id = r.id
    ) AS last_activity,

    (
      SELECT COUNT(*)
      FROM public.customer_profiles cp
      WHERE cp.restaurant_id = r.id
        AND cp.last_seen_at >= now() - interval '5 minutes'
    ) AS logged_in_now

  FROM public.restaurants r
  ORDER BY r.name ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_get_restaurant_settings(p_restaurant_id uuid)
 RETURNS TABLE(cash_on_delivery_enabled boolean, cash_on_pickup_enabled boolean, cash_on_take_out_enabled boolean, automatic_rider_assignment_enabled boolean, tax_vat_registered boolean, tax_prices_vat_inclusive boolean, tax_vat_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.system_admin_has_access() then raise exception 'System Administrator access required.'; end if;
  return query
  select r.cash_on_delivery_enabled, r.cash_on_pickup_enabled, r.cash_on_take_out_enabled,
         r.automatic_rider_assignment_enabled, r.tax_vat_registered,
         r.tax_prices_vat_inclusive, r.tax_vat_rate
  from public.restaurants r where r.id = p_restaurant_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_update_restaurant_settings(p_restaurant_id uuid, p_cash_on_delivery_enabled boolean, p_cash_on_pickup_enabled boolean, p_cash_on_take_out_enabled boolean, p_online_payment_enabled boolean, p_automatic_rider_assignment_enabled boolean, p_tax_vat_registered boolean, p_tax_prices_vat_inclusive boolean, p_tax_vat_rate numeric)
 RETURNS TABLE(cash_on_delivery_enabled boolean, cash_on_pickup_enabled boolean, cash_on_take_out_enabled boolean, online_payment_enabled boolean, automatic_rider_assignment_enabled boolean, tax_vat_registered boolean, tax_prices_vat_inclusive boolean, tax_vat_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
 if not public.system_admin_has_manage_access() then raise exception 'System Administrator access required.'; end if;
 if not exists(select 1 from public.restaurants where id=p_restaurant_id) then raise exception 'Restaurant not found.'; end if;
 if p_tax_vat_rate is null or p_tax_vat_rate<0 or p_tax_vat_rate>100 then raise exception 'VAT rate must be between 0 and 100.'; end if;
 update public.restaurants set cash_on_delivery_enabled=coalesce(p_cash_on_delivery_enabled,false),cash_on_pickup_enabled=coalesce(p_cash_on_pickup_enabled,false),cash_on_take_out_enabled=coalesce(p_cash_on_take_out_enabled,false),online_payment_enabled=coalesce(p_online_payment_enabled,true),automatic_rider_assignment_enabled=coalesce(p_automatic_rider_assignment_enabled,false),tax_vat_registered=coalesce(p_tax_vat_registered,false),tax_prices_vat_inclusive=case when coalesce(p_tax_vat_registered,false) then coalesce(p_tax_prices_vat_inclusive,false) else false end,tax_vat_rate=case when coalesce(p_tax_vat_registered,false) then round(p_tax_vat_rate,2) else 0 end where id=p_restaurant_id;
 return query select r.cash_on_delivery_enabled,r.cash_on_pickup_enabled,r.cash_on_take_out_enabled,r.online_payment_enabled,r.automatic_rider_assignment_enabled,r.tax_vat_registered,r.tax_prices_vat_inclusive,r.tax_vat_rate from public.restaurants r where r.id=p_restaurant_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.system_admin_update_restaurant_settings(p_restaurant_id uuid, p_cash_on_delivery_enabled boolean, p_cash_on_pickup_enabled boolean, p_cash_on_take_out_enabled boolean, p_automatic_rider_assignment_enabled boolean, p_tax_vat_registered boolean, p_tax_prices_vat_inclusive boolean, p_tax_vat_rate numeric)
 RETURNS TABLE(cash_on_delivery_enabled boolean, cash_on_pickup_enabled boolean, cash_on_take_out_enabled boolean, automatic_rider_assignment_enabled boolean, tax_vat_registered boolean, tax_prices_vat_inclusive boolean, tax_vat_rate numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.system_admin_has_manage_access() then raise exception 'System Administrator access required.'; end if;
  if not exists(select 1 from public.restaurants where id=p_restaurant_id) then raise exception 'Restaurant not found.'; end if;
  if p_tax_vat_rate is null or p_tax_vat_rate < 0 or p_tax_vat_rate > 100 then raise exception 'VAT rate must be between 0 and 100.'; end if;
  update public.restaurants
  set cash_on_delivery_enabled=coalesce(p_cash_on_delivery_enabled,false),
      cash_on_pickup_enabled=coalesce(p_cash_on_pickup_enabled,false),
      cash_on_take_out_enabled=coalesce(p_cash_on_take_out_enabled,false),
      automatic_rider_assignment_enabled=coalesce(p_automatic_rider_assignment_enabled,false),
      tax_vat_registered=coalesce(p_tax_vat_registered,false),
      tax_prices_vat_inclusive=case when coalesce(p_tax_vat_registered,false) then coalesce(p_tax_prices_vat_inclusive,false) else false end,
      tax_vat_rate=case when coalesce(p_tax_vat_registered,false) then round(p_tax_vat_rate,2) else 0 end
  where id=p_restaurant_id;
  return query select r.cash_on_delivery_enabled,r.cash_on_pickup_enabled,r.cash_on_take_out_enabled,
      r.automatic_rider_assignment_enabled,r.tax_vat_registered,r.tax_prices_vat_inclusive,r.tax_vat_rate
  from public.restaurants r where r.id=p_restaurant_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_add_user(p_admin_user_id uuid, p_access_level text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
DECLARE
  v_access_id uuid;
BEGIN
  IF NOT public.system_admin_is_owner() THEN
    RAISE EXCEPTION 'System Administrator Owner authorization required';
  END IF;

  IF p_access_level NOT IN ('administrator', 'view_only') THEN
    RAISE EXCEPTION
      'New System Administrators can only be Administrator or View Only';
  END IF;

  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Administrator user ID is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = p_admin_user_id
  ) THEN
    RAISE EXCEPTION 'Auth user not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.system_admin_access
    WHERE admin_user_id = p_admin_user_id
  ) THEN
    RAISE EXCEPTION 'This user already has System Administrator access';
  END IF;

  INSERT INTO public.system_admin_access (
    admin_user_id,
    access_level,
    is_active,
    status,
    granted_by
  )
  VALUES (
    p_admin_user_id,
    p_access_level,
    false,
    'pending',
    auth.uid()
  )
  RETURNING id INTO v_access_id;

  PERFORM public.system_admin_write_audit_log(
    'ADMIN_ACTION',
    'SYSTEM_ADMIN_INVITED',
    NULL,
    'system_admin_access',
    v_access_id,
    jsonb_build_object(
      'target_admin_user_id', p_admin_user_id,
      'access_level', p_access_level,
      'status', 'pending'
    )
  );

  RETURN v_access_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_delete_revoked_access(p_admin_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
DECLARE
  v_access_level text;
  v_status text;
  v_email text;
BEGIN
  -- Only the System Administrator Owner can permanently delete
  -- another System Administrator account.
  IF NOT public.system_admin_is_owner() THEN
    RAISE EXCEPTION 'System Administrator Owner authorization required';
  END IF;

  -- Never allow the current Owner to delete themselves.
  IF p_admin_user_id = auth.uid() THEN
    RAISE EXCEPTION 'The Owner cannot delete their own account';
  END IF;

  SELECT
    saa.access_level,
    saa.status,
    au.email
  INTO
    v_access_level,
    v_status,
    v_email
  FROM public.system_admin_access saa
  LEFT JOIN auth.users au
    ON au.id = saa.admin_user_id
  WHERE saa.admin_user_id = p_admin_user_id;

  IF v_access_level IS NULL THEN
    RAISE EXCEPTION 'System Administrator account not found';
  END IF;

  IF v_access_level = 'owner' THEN
    RAISE EXCEPTION 'The Owner account cannot be deleted';
  END IF;

  IF v_status <> 'revoked' THEN
    RAISE EXCEPTION 'Only a revoked System Administrator account can be permanently deleted';
  END IF;

  -- Record the deletion before removing the Auth account.
  PERFORM public.system_admin_write_audit_log(
    'ADMIN_ACTION',
    'SYSTEM_ADMIN_ACCESS_DELETED',
    NULL,
    'system_admin_access',
    p_admin_user_id,
    jsonb_build_object(
      'email', v_email,
      'access_level', v_access_level,
      'previous_status', v_status,
      'deleted_by', auth.uid()
    )
  );

  -- auth.users has ON DELETE CASCADE to system_admin_access,
  -- while audit admin_user_id uses ON DELETE SET NULL.
  DELETE FROM auth.users
  WHERE id = p_admin_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth account could not be deleted';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_restore_access(p_admin_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
DECLARE
  v_access_level text;
  v_status text;
BEGIN
  IF NOT public.system_admin_is_owner() THEN
    RAISE EXCEPTION 'System Administrator Owner authorization required';
  END IF;

  SELECT access_level, status
  INTO v_access_level, v_status
  FROM public.system_admin_access
  WHERE admin_user_id = p_admin_user_id;

  IF v_access_level IS NULL THEN
    RAISE EXCEPTION 'System Administrator not found';
  END IF;

  IF v_access_level = 'owner' THEN
    RAISE EXCEPTION 'The Owner account does not need to be restored';
  END IF;

  IF v_status <> 'revoked' THEN
    RAISE EXCEPTION
      'Only revoked System Administrator accounts can be restored';
  END IF;

  UPDATE public.system_admin_access
  SET
    is_active = true,
    status = 'active',
    updated_at = now()
  WHERE admin_user_id = p_admin_user_id;

  PERFORM public.system_admin_write_audit_log(
    'ADMIN_ACTION',
    'SYSTEM_ADMIN_ACCESS_RESTORED',
    NULL,
    'system_admin_access',
    p_admin_user_id,
    jsonb_build_object(
      'access_level', v_access_level
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_revoke_access(p_admin_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
DECLARE
  v_access_level text;
BEGIN
  IF NOT public.system_admin_is_owner() THEN
    RAISE EXCEPTION 'System Administrator Owner authorization required';
  END IF;

  IF p_admin_user_id = auth.uid() THEN
    RAISE EXCEPTION 'The Owner cannot revoke their own access';
  END IF;

  SELECT access_level
  INTO v_access_level
  FROM public.system_admin_access
  WHERE admin_user_id = p_admin_user_id;

  IF v_access_level IS NULL THEN
    RAISE EXCEPTION 'System Administrator not found';
  END IF;

  IF v_access_level = 'owner' THEN
    RAISE EXCEPTION 'The Owner account cannot be revoked';
  END IF;

  UPDATE public.system_admin_access
  SET
    is_active = false,
    status = 'revoked',
    updated_at = now()
  WHERE admin_user_id = p_admin_user_id;

  PERFORM public.system_admin_write_audit_log(
    'ADMIN_ACTION',
    'SYSTEM_ADMIN_ACCESS_REVOKED',
    NULL,
    'system_admin_access',
    p_admin_user_id,
    jsonb_build_object(
      'previous_access_level', v_access_level
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_set_access_level(p_admin_user_id uuid, p_access_level text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
DECLARE
  v_current_access_level text;
BEGIN
  IF NOT public.system_admin_is_owner() THEN
    RAISE EXCEPTION 'System Administrator Owner authorization required';
  END IF;

  IF p_access_level NOT IN ('administrator', 'view_only') THEN
    RAISE EXCEPTION
      'Access level must be Administrator or View Only';
  END IF;

  SELECT access_level
  INTO v_current_access_level
  FROM public.system_admin_access
  WHERE admin_user_id = p_admin_user_id;

  IF v_current_access_level IS NULL THEN
    RAISE EXCEPTION 'System Administrator not found';
  END IF;

  IF v_current_access_level = 'owner' THEN
    RAISE EXCEPTION 'The Owner access level cannot be changed';
  END IF;

  UPDATE public.system_admin_access
  SET
    access_level = p_access_level,
    updated_at = now()
  WHERE admin_user_id = p_admin_user_id;

  PERFORM public.system_admin_write_audit_log(
    'ADMIN_ACTION',
    'SYSTEM_ADMIN_ACCESS_CHANGED',
    NULL,
    'system_admin_access',
    p_admin_user_id,
    jsonb_build_object(
      'from_access_level', v_current_access_level,
      'to_access_level', p_access_level
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_set_restaurant_staff_active(p_staff_id uuid, p_is_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
DECLARE
  v_staff_role text;
  v_active_assignment_count integer;
BEGIN
  -- System Admin authorization
  IF NOT public.system_admin_has_manage_access() THEN
    RAISE EXCEPTION 'System Administrator authorization required';
  END IF;

  -- Confirm staff exists and get role
  SELECT role
  INTO v_staff_role
  FROM public.restaurant_staff
  WHERE id = p_staff_id;

  IF v_staff_role IS NULL THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  -- When deactivating a rider, prevent deactivation
  -- while they still have an unfinished delivery.
  IF p_is_active = false
     AND v_staff_role = 'rider'
  THEN

    SELECT COUNT(*)
    INTO v_active_assignment_count
    FROM public.delivery_assignments
    WHERE rider_id = p_staff_id
      AND status IN (
        'assigned',
        'delivering',
        'arrived'
      );

    IF v_active_assignment_count > 0 THEN
      RAISE EXCEPTION
        'This rider cannot be deactivated because they have % active delivery assignment(s). Complete or reassign the delivery first.',
        v_active_assignment_count;
    END IF;

  END IF;

  -- Activate or deactivate the staff member.
  UPDATE public.restaurant_staff
  SET
    is_active = p_is_active,
    updated_at = now()
  WHERE id = p_staff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member could not be updated';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.system_admin_delete_restaurant_staff(p_staff_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp', 'pg_temp'
AS $function$
DECLARE
  v_staff_role text;
  v_active_assignment_count integer;
  v_auth_user_id uuid;
  v_restaurant_id uuid;
  v_staff_name text;
  v_staff_email text;
  v_is_active boolean;
BEGIN
  -- ONLY the System Administrator Owner may permanently delete staff.
  IF NOT public.system_admin_is_owner() THEN
    RAISE EXCEPTION 'System Administrator Owner authorization required';
  END IF;

  -- Capture the staff information before deletion.
  SELECT
    restaurant_id,
    auth_user_id,
    name,
    email,
    role,
    is_active
  INTO
    v_restaurant_id,
    v_auth_user_id,
    v_staff_name,
    v_staff_email,
    v_staff_role,
    v_is_active
  FROM public.restaurant_staff
  WHERE id = p_staff_id;

  IF v_staff_role IS NULL THEN
    RAISE EXCEPTION 'Staff member not found';
  END IF;

  -- Preserve the existing rider safety protection.
  IF v_staff_role = 'rider' THEN

    SELECT COUNT(*)
    INTO v_active_assignment_count
    FROM public.delivery_assignments
    WHERE rider_id = p_staff_id
      AND status IN (
        'assigned',
        'delivering',
        'arrived'
      );

    IF v_active_assignment_count > 0 THEN
      RAISE EXCEPTION
        'This rider cannot be deleted because they have % active delivery assignment(s). Complete or reassign the delivery first.',
        v_active_assignment_count;
    END IF;

  END IF;

  -- Permanently remove the staff relationship.
  -- Historical rider/order relationships are preserved by the
  -- existing ON DELETE SET NULL design.
  DELETE FROM public.restaurant_staff
  WHERE id = p_staff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member could not be deleted';
  END IF;

  -- Permanent deletion audit.
  INSERT INTO public.system_admin_audit_logs (
    admin_user_id,
    restaurant_id,
    event_type,
    action,
    entity_type,
    entity_id,
    details
  )
  VALUES (
    auth.uid(),
    v_restaurant_id,
    'ADMIN_ACTION',
    'STAFF_PERMANENT_DELETE',
    'RESTAURANT_STAFF',
    p_staff_id,
    jsonb_build_object(
      'staff_id', p_staff_id,
      'auth_user_id', v_auth_user_id,
      'name', v_staff_name,
      'email', v_staff_email,
      'role', v_staff_role,
      'was_active', v_is_active,
      'permanent', true
    )
  );
END;
$function$;


-- Every SECURITY DEFINER endpoint has an intentional grant list. Keep guest
-- checkout RPCs public only where specifically designed for anonymous checkout;
-- these management helpers require an authenticated, authorized caller.

REVOKE ALL ON FUNCTION public.system_admin_write_audit_log(text,text,uuid,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_write_audit_log(text,text,uuid,text,uuid,jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.customer_touch_presence() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_touch_presence() TO authenticated;

REVOKE ALL ON FUNCTION public.upsert_customer_profile(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_customer_profile(uuid,text,text,text) TO authenticated;

REVOKE ALL ON FUNCTION public.restaurant_change_inventory_unit(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restaurant_change_inventory_unit(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.send_order_to_kitchen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_order_to_kitchen(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_get_audit_logs(uuid,text,integer,integer,text,timestamptz,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_get_audit_logs(uuid,text,integer,integer,text,timestamptz,timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_get_dashboard_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_get_dashboard_summary() TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_get_restaurant_monitoring() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_get_restaurant_monitoring() TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_get_restaurant_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_get_restaurant_settings(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_update_restaurant_settings(uuid,boolean,boolean,boolean,boolean,boolean,boolean,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_update_restaurant_settings(uuid,boolean,boolean,boolean,boolean,boolean,boolean,numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_add_user(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_add_user(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_delete_revoked_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_delete_revoked_access(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_restore_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_restore_access(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_revoke_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_revoke_access(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_set_access_level(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_set_access_level(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_set_restaurant_staff_active(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_set_restaurant_staff_active(uuid,boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_delete_restaurant_staff(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_delete_restaurant_staff(uuid) TO authenticated;

-- Legacy single-customer POS discount RPC is not used by the current frontend.
-- Disable direct access rather than preserve its implicit PUBLIC EXECUTE grant.
REVOKE ALL ON FUNCTION public.apply_pos_discount(uuid,text,text) FROM PUBLIC, anon, authenticated;

-- The counter is internal-only; no client should call its SECURITY DEFINER helper.
REVOKE ALL ON FUNCTION public.next_restaurant_order_number(uuid) FROM PUBLIC, anon, authenticated;

-- Trigger helpers are run by their triggers, never as direct API calls.
REVOKE ALL ON FUNCTION public.enforce_cash_on_pickup_setting() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restaurant_record_salary_profile_history() FROM PUBLIC, anon, authenticated;
