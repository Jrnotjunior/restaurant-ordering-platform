-- Restore two account/onboarding RPCs that existed in the connected schema but
-- were missing from the checked-in clean-install migration history.

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS restaurant_address text;

CREATE OR REPLACE FUNCTION public.resolve_my_account_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_restaurant jsonb;
  v_staff_role text;
  v_staff_restaurant_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT lower(u.email)
    INTO v_user_email
  FROM auth.users u
  WHERE u.id = v_user_id
    AND u.email_confirmed_at IS NOT NULL;

  SELECT jsonb_build_object(
    'id', r.id,
    'slug', r.slug,
    'name', r.name,
    'tagline', r.tagline,
    'logo_url', r.logo_url,
    'restaurant_address', r.restaurant_address,
    'contact_number', r.contact_number,
    'email', r.email,
    'is_active', r.is_active
  )
  INTO v_restaurant
  FROM public.restaurants r
  WHERE r.owner_id = v_user_id
    AND r.is_active = true
  LIMIT 1;

  IF v_restaurant IS NOT NULL THEN
    RETURN jsonb_build_object(
      'restaurant', v_restaurant,
      'accountType', 'owner',
      'staffRole', NULL,
      'staffRestaurantId', NULL
    );
  END IF;

  SELECT s.role, s.restaurant_id
    INTO v_staff_role, v_staff_restaurant_id
  FROM public.restaurant_staff s
  WHERE s.is_active = true
    AND (
      s.auth_user_id = v_user_id
      OR (v_user_email IS NOT NULL AND lower(s.email) = v_user_email)
    )
  ORDER BY CASE WHEN s.auth_user_id = v_user_id THEN 0 ELSE 1 END, s.id
  LIMIT 1;

  IF v_staff_role IS NOT NULL THEN
    RETURN jsonb_build_object(
      'restaurant', NULL,
      'accountType', 'staff',
      'staffRole', v_staff_role,
      'staffRestaurantId', v_staff_restaurant_id
    );
  END IF;

  RETURN jsonb_build_object(
    'restaurant', NULL,
    'accountType', 'customer',
    'staffRole', NULL,
    'staffRestaurantId', NULL
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_my_account_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_my_account_context() TO authenticated;

CREATE OR REPLACE FUNCTION public.create_restaurant_from_tenant_invitation(
  p_invitation_id uuid,
  p_name text,
  p_slug text,
  p_tagline text DEFAULT '',
  p_logo_url text DEFAULT NULL,
  p_location_text text DEFAULT NULL,
  p_contact_number text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE(restaurant_id uuid, slug text, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invitation public.tenant_invitations%rowtype;
  v_restaurant_id uuid;
  v_name text;
  v_slug text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in';
  END IF;

  SELECT *
    INTO v_invitation
  FROM public.tenant_invitations
  WHERE id = p_invitation_id
    AND status = 'pending'
    AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This tenant invitation is invalid, expired, or already used';
  END IF;

  IF v_invitation.auth_user_id IS NOT NULL
     AND v_invitation.auth_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'This tenant invitation belongs to another account';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurants r WHERE r.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'This account already owns a restaurant';
  END IF;

  v_name := trim(coalesce(p_name, ''));
  v_slug := lower(trim(coalesce(p_slug, '')));

  IF length(v_name) < 2 THEN
    RAISE EXCEPTION 'Restaurant name is required';
  END IF;

  IF v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Slug must use lowercase letters, numbers, and single hyphens';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurants r WHERE lower(r.slug) = v_slug
  ) THEN
    RAISE EXCEPTION 'That restaurant identity is already in use';
  END IF;

  INSERT INTO public.restaurants (
    owner_id,
    name,
    slug,
    tagline,
    logo_url,
    restaurant_address,
    contact_number,
    email,
    is_active
  )
  VALUES (
    auth.uid(),
    v_name,
    v_slug,
    trim(coalesce(p_tagline, '')),
    nullif(trim(coalesce(p_logo_url, '')), ''),
    nullif(trim(coalesce(p_location_text, '')), ''),
    nullif(trim(coalesce(p_contact_number, '')), ''),
    nullif(trim(coalesce(p_email, '')), ''),
    true
  )
  RETURNING id INTO v_restaurant_id;

  UPDATE public.tenant_invitations
  SET status = 'accepted',
      auth_user_id = auth.uid(),
      accepted_at = now(),
      restaurant_id = v_restaurant_id,
      updated_at = now()
  WHERE id = v_invitation.id;

  RETURN QUERY
  SELECT r.id, r.slug, r.name
  FROM public.restaurants r
  WHERE r.id = v_restaurant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_restaurant_from_tenant_invitation(uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_restaurant_from_tenant_invitation(uuid, text, text, text, text, text, text, text) TO authenticated;
