-- Operational branch order listing is not a public endpoint.
REVOKE EXECUTE ON FUNCTION public.get_restaurant_orders_with_branch(uuid, uuid) FROM anon;