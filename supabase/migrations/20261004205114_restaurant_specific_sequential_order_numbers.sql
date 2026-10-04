BEGIN;

CREATE TABLE IF NOT EXISTS public.restaurant_order_counters (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  last_order_number bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;

WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY restaurant_id
      ORDER BY created_at ASC, id ASC
    ) AS order_sequence
  FROM public.orders
)
UPDATE public.orders o
SET order_number = 'ORD-' || LPAD(numbered.order_sequence::text, 6, '0')
FROM numbered
WHERE o.id = numbered.id;

INSERT INTO public.restaurant_order_counters (restaurant_id, last_order_number)
SELECT restaurant_id, COUNT(*)::bigint
FROM public.orders
GROUP BY restaurant_id
ON CONFLICT (restaurant_id) DO UPDATE
SET last_order_number = EXCLUDED.last_order_number,
    updated_at = now();

CREATE UNIQUE INDEX IF NOT EXISTS orders_restaurant_order_number_key
  ON public.orders (restaurant_id, order_number);

CREATE OR REPLACE FUNCTION public.next_restaurant_order_number(p_restaurant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_next bigint;
BEGIN
  IF p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant is required';
  END IF;

  INSERT INTO public.restaurant_order_counters (
    restaurant_id,
    last_order_number
  )
  VALUES (p_restaurant_id, 1)
  ON CONFLICT (restaurant_id)
  DO UPDATE
    SET last_order_number = public.restaurant_order_counters.last_order_number + 1,
        updated_at = now()
  RETURNING last_order_number INTO v_next;

  RETURN 'ORD-' || LPAD(v_next::text, 6, '0');
END;
$function$;

REVOKE ALL ON FUNCTION public.next_restaurant_order_number(uuid) FROM PUBLIC;

DO $migration$
DECLARE
  v_definition text;
  v_replaced text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_order'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_order_type text, p_delivery_barangay text, p_delivery_address text, p_notes text, p_payment_method text, p_is_third_party_courier boolean, p_items jsonb';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected create_order function was not found';
  END IF;

  v_replaced := regexp_replace(
    v_definition,
    'v_order_number :=[[:space:]]*''ORD-''[[:space:]]*\|\|[[:space:]]*to_char\(now\(\), ''YYYYMMDD-HH24MISS''\)[[:space:]]*\|\|[[:space:]]*''-''[[:space:]]*\|\|[[:space:]]*upper\(substr\(replace\(gen_random_uuid\(\)::text, ''-'', ''''\), 1, 6\)\);',
    'v_order_number := public.next_restaurant_order_number(p_restaurant_id);',
    1,
    0,
    'n'
  );

  IF v_replaced = v_definition THEN
    RAISE EXCEPTION 'Expected legacy order-number generator was not found in create_order';
  END IF;

  EXECUTE v_replaced;
END;
$migration$;

COMMIT;