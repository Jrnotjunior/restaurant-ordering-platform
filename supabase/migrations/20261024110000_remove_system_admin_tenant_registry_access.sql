-- This Supabase project belongs to the Restaurant Ordering Platform.
-- The System Admin application is moving to another repository; authenticated
-- System Admin clients must not enumerate or mutate restaurant tenants here.
-- Preserve System Admin's own access-management RPCs, but revoke tenant/platform
-- operations whose results or effects are tied to restaurant records.
REVOKE ALL ON FUNCTION public.system_admin_get_tenant_registry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_get_dashboard_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_get_audit_logs(uuid, text, integer, integer, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_get_restaurant_package(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_get_available_packages() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_get_mapbox_usage(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_get_mapbox_usage_daily(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_assign_restaurant_owner(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_assign_restaurant_package(uuid, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_create_restaurant_from_invitation(uuid, uuid, text, text, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_expire_tenant_invitation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_set_restaurant_domain(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_set_restaurant_module_override(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_remove_restaurant_owner(uuid) FROM PUBLIC, anon, authenticated;
