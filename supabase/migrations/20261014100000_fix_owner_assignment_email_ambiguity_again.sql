-- Fix ambiguous email reference in owner assignment.
-- The RETURNS TABLE output includes a column named email, so Auth columns
-- must be qualified inside PL/pgSQL statements.
CREATE OR REPLACE FUNCTION public.system_admin_assign_restaurant_owner(
  p_restaurant_id uuid,
  p_email text
)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user auth.users%rowtype;
  v_previous_owner_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.system_admin_has_manage_access() THEN
    RAISE EXCEPTION 'System Administrator access required.';
  END IF;

  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'Owner email is required.';
  END IF;

  SELECT r.owner_id
    INTO v_previous_owner_id
  FROM public.restaurants AS r
  WHERE r.id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found.';
  END IF;

  SELECT u.*
    INTO v_user
  FROM auth.users AS u
  WHERE lower(u.email) = lower(trim(p_email))
  LIMIT 1
  FOR UPDATE;

  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'No Auth account was found for that email.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.restaurants AS r
    WHERE r.owner_id = v_user.id
      AND r.id <> p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'This account already owns another restaurant.';
  END IF;

  UPDATE public.restaurants AS r
  SET owner_id = v_user.id
  WHERE r.id = p_restaurant_id;

  PERFORM public.system_admin_write_audit_log(
    p_event_type := 'ADMIN_ACTION',
    p_action := 'RESTAURANT_OWNER_ASSIGNED',
    p_restaurant_id := p_restaurant_id,
    p_entity_type := 'RESTAURANT',
    p_entity_id := p_restaurant_id,
    p_details := jsonb_build_object(
      'previous_owner_auth_user_id', v_previous_owner_id,
      'new_owner_auth_user_id', v_user.id,
      'owner_email', v_user.email
    )
  );

  RETURN QUERY
  SELECT
    v_user.id,
    v_user.email::text,
    coalesce(
      nullif(v_user.raw_user_meta_data ->> 'full_name', ''),
      nullif(v_user.raw_user_meta_data ->> 'name', '')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.system_admin_assign_restaurant_owner(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_assign_restaurant_owner(uuid, text) TO authenticated;
