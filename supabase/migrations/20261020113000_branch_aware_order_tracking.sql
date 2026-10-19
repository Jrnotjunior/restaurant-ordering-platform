-- Preserve the existing public tracking RPC signatures while making the
-- displayed pickup address and operating hours branch-aware.
DO $branch_tracking$
DECLARE
  v_definition text;
  v_replaced text;
  v_function_name text;
  v_identity_args text;
  v_join_marker text;
BEGIN
  FOREACH v_function_name IN ARRAY ARRAY['get_order_status', 'get_order_status_by_id']
  LOOP
    v_identity_args := CASE
      WHEN v_function_name = 'get_order_status' THEN 'p_order_number text'
      ELSE 'p_order_id uuid'
    END;

    SELECT pg_get_functiondef(p.oid)
      INTO v_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = v_function_name
      AND pg_get_function_identity_arguments(p.oid) = v_identity_args;

    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'Expected tracking function % was not found', v_function_name;
    END IF;

    IF v_function_name = 'get_order_status' THEN
      v_replaced := replace(
        v_definition,
        'coalesce(nullif(trim(r.store_address), ''''), nullif(trim(r.store_address), ''''))',
        'coalesce(nullif(trim(b.store_address), ''''), nullif(trim(b.restaurant_address), ''''), nullif(trim(r.store_address), ''''))'
      );
      v_join_marker := '  left join public.restaurant_staff rs';
    ELSE
      v_replaced := replace(
        v_definition,
        'COALESCE(NULLIF(trim(r.store_address), ''''), NULLIF(trim(r.store_address), ''''))',
        'COALESCE(NULLIF(trim(b.store_address), ''''), NULLIF(trim(b.restaurant_address), ''''), NULLIF(trim(r.store_address), ''''))'
      );
      v_join_marker := '  LEFT JOIN public.restaurant_staff rs';
    END IF;

    IF v_replaced = v_definition THEN
      RAISE EXCEPTION 'Could not patch pickup address in %', v_function_name;
    END IF;

    v_definition := v_replaced;
    v_replaced := replace(v_definition, 'r.operating_hours,', 'coalesce(b.operating_hours, r.operating_hours),');
    IF v_replaced = v_definition THEN
      RAISE EXCEPTION 'Could not patch operating hours in %', v_function_name;
    END IF;

    v_definition := v_replaced;
    IF v_function_name = 'get_order_status' THEN
      v_replaced := replace(
        v_definition,
        v_join_marker,
        '  left join public.restaurant_branches b on b.id = o.branch_id and b.restaurant_id = o.restaurant_id' || E'\n' || v_join_marker
      );
    ELSE
      v_replaced := replace(
        v_definition,
        v_join_marker,
        '  LEFT JOIN public.restaurant_branches b ON b.id = o.branch_id AND b.restaurant_id = o.restaurant_id' || E'\n' || v_join_marker
      );
    END IF;

    IF v_replaced = v_definition THEN
      RAISE EXCEPTION 'Could not add branch join to %', v_function_name;
    END IF;

    EXECUTE v_replaced;
  END LOOP;
END;
$branch_tracking$;
