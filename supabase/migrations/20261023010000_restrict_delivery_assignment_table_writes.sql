-- Browser clients only need to read delivery assignment rows for dispatch/rider views.
-- All assignment writes must go through validated SECURITY DEFINER RPCs, which
-- enforce tenant, role, MFA, and order-state checks server-side.
-- Keep SELECT available and remove direct table mutation/destructive privileges.
-- This does not change data, RLS policies, or function-owner/service-role behavior.

BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.delivery_assignments
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.delivery_assignments
  TO anon, authenticated;

COMMIT;
