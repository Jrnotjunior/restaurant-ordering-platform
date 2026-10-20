-- Trigger-only functions should not be exposed as callable PostgREST RPCs.
-- PostgreSQL triggers can continue to invoke their trigger function; no trigger
-- currently references this helper, and no client caller should invoke it.
REVOKE ALL ON FUNCTION public.enforce_cash_on_pickup_setting() FROM PUBLIC, anon, authenticated;
