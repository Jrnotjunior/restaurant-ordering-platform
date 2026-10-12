-- Return the order timestamp as a named row so the frontend RPC helper can read created_at.
DROP FUNCTION IF EXISTS public.get_customer_order_created_at(uuid);

CREATE FUNCTION public.get_customer_order_created_at(p_order_id uuid)
RETURNS TABLE(created_at timestamptz)
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
