-- Introduce a token-authorized guest tracking read without removing the
-- legacy UUID RPC yet. The frontend can switch to this RPC in a later commit
-- after the token has been threaded through every guest entry path.
--
-- The function is derived from the current, privacy-redacted UUID tracking
-- function so the response shape and existing authenticated-owner check stay
-- aligned. Anonymous callers additionally need the SHA-256 hash of the
-- dedicated guest tracking capability. The raw token must never be sent to SQL.

DO $migration$
DECLARE
  v_definition text;
  v_tracking_definition text;
  v_where text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_order_status_by_id'
    AND pg_get_function_identity_arguments(p.oid) = 'p_order_id uuid';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected get_order_status_by_id(uuid) function was not found';
  END IF;

  v_tracking_definition := replace(
    v_definition,
    'public.get_order_status_by_id(p_order_id uuid)',
    'public.get_guest_order_status_by_tracking_token(p_order_id uuid, p_guest_tracking_token_hash text)'
  );

  IF v_tracking_definition = v_definition THEN
    RAISE EXCEPTION 'Could not derive guest token tracking function signature';
  END IF;

  v_where := 'where o.id = p_order_id';
  IF position(v_where in lower(v_tracking_definition)) = 0 THEN
    RAISE EXCEPTION 'Expected order ID predicate was not found in tracking function';
  END IF;

  -- The original function's owner check remains in place. This additional
  -- predicate means anonymous callers must present a correctly formatted
  -- matching hash for a guest order; authenticated owner access remains intact.
  v_tracking_definition := regexp_replace(
    v_tracking_definition,
    'where o\.id = p_order_id',
    'where o.id = p_order_id
      AND (
        auth.uid() IS NOT NULL
        OR (
          o.customer_id IS NULL
          AND p_guest_tracking_token_hash ~ ''^[0-9a-f]{64}$''
          AND o.guest_tracking_token_hash = p_guest_tracking_token_hash
        )
      )',
    'i'
  );

  IF position('p_guest_tracking_token_hash' in v_tracking_definition) = 0
     OR position('o.guest_tracking_token_hash = p_guest_tracking_token_hash' in v_tracking_definition) = 0 THEN
    RAISE EXCEPTION 'Could not safely add guest tracking token authorization predicate';
  END IF;

  EXECUTE v_tracking_definition;
END;
$migration$;

REVOKE ALL ON FUNCTION public.get_guest_order_status_by_tracking_token(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_order_status_by_tracking_token(uuid, text) TO anon, authenticated;
