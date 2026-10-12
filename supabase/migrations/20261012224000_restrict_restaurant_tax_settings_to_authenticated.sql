-- Tax settings are an owner/cashier configuration endpoint, not a public
-- storefront lookup. Keep the function's internal tenant authorization and
-- remove anonymous EXECUTE permission at the RPC boundary.
revoke all on function public.get_restaurant_tax_settings(uuid) from public;
revoke execute on function public.get_restaurant_tax_settings(uuid) from anon;
grant execute on function public.get_restaurant_tax_settings(uuid) to authenticated, postgres;
