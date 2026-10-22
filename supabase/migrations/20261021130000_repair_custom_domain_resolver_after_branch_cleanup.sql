-- Repair the tenant custom-domain resolver after the legacy location_text column was retired.
-- Preserve the public RPC contract used by storefronts: restaurant_address is the returned field.

BEGIN;

DO $migration$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.resolve_restaurant_by_domain(text)'::regprocedure);
  v_def := replace(v_def, 'location_text text', 'restaurant_address text');
  v_def := replace(v_def, 'r.location_text', 'r.restaurant_address');

  DROP FUNCTION public.resolve_restaurant_by_domain(text);
  EXECUTE v_def;

  REVOKE ALL ON FUNCTION public.resolve_restaurant_by_domain(text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.resolve_restaurant_by_domain(text) TO anon, authenticated;
END
$migration$;

COMMIT;
