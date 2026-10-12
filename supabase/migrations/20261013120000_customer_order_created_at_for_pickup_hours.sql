-- Expose the real order creation timestamp for customer-facing pickup hours.
CREATE OR REPLACE FUNCTION public.get_customer_order_created_at(p_order_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT o.created_at
  FROM public.orders AS o
  WHERE o.id = p_order_id
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_order_created_at(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_order_created_at(uuid) TO anon, authenticated;
