-- Restrict RPCs that are designed for authenticated staff/System Admin users.
-- Keep authenticated execution so existing signed-in UI flows continue to work.
REVOKE ALL ON FUNCTION public.system_admin_get_restaurant_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_get_restaurant_settings(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_update_restaurant_settings(uuid, boolean, boolean, boolean, boolean, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_update_restaurant_settings(uuid, boolean, boolean, boolean, boolean, boolean, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_update_restaurant_settings(uuid, boolean, boolean, boolean, boolean, boolean, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_update_restaurant_settings(uuid, boolean, boolean, boolean, boolean, boolean, boolean, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.system_admin_update_restaurant_settings(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_update_restaurant_settings(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean, numeric) TO authenticated;

-- The kitchen workflow checks auth.uid() and restaurant owner/cashier membership.
-- Do not expose the RPC to anonymous users or PUBLIC.
REVOKE ALL ON FUNCTION public.send_order_to_kitchen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_order_to_kitchen(uuid) TO authenticated;
