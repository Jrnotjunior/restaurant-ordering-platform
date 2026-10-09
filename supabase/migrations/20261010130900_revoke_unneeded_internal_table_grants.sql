-- These RLS-protected tables are accessed through authorized SECURITY DEFINER
-- functions or trusted server-side code, not directly by browser API roles.
-- Remove unnecessary table-level privileges (including REFERENCES, TRIGGER, TRUNCATE)
-- without changing service_role access or function execution grants.
REVOKE ALL PRIVILEGES ON TABLE
  public.delivery_quotes,
  public.pending_online_payments,
  public.restaurant_module_overrides,
  public.restaurant_order_counters,
  public.restaurant_subscriptions,
  public.system_admin_access,
  public.system_modules,
  public.system_package_modules,
  public.system_packages
FROM anon, authenticated;
