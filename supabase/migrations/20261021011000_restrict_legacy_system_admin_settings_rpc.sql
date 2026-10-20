-- Restore the authenticated-only access contract for the legacy settings RPC
-- overload that includes the online-payment setting. Do not expose this
-- management function to anonymous callers.
REVOKE ALL ON FUNCTION public.system_admin_update_restaurant_settings(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_update_restaurant_settings(uuid,boolean,boolean,boolean,boolean,boolean,boolean,boolean,numeric) TO authenticated;
