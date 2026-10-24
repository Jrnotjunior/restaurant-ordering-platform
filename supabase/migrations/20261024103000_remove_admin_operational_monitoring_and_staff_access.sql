-- Prevent System Admin RPCs from inspecting restaurant operations/customer activity or changing restaurant staff.
-- Platform-level tenant/package administration remains separate.
REVOKE ALL ON FUNCTION public.system_admin_get_restaurant_monitoring() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_set_restaurant_staff_active(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_delete_restaurant_staff(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.system_admin_prepare_restaurant_delete() FROM PUBLIC, anon, authenticated;
