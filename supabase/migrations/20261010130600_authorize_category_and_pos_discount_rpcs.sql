-- Category creation/reactivation is an owner-only management action.
CREATE OR REPLACE FUNCTION public.get_or_create_restaurant_category(
  p_restaurant_id uuid,
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_name text := trim(p_name);
  v_slug text;
  v_category_id uuid;
  v_sort_order integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'Category name is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = p_restaurant_id
      AND r.is_active = true
      AND r.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You are not authorized to manage categories for this restaurant'
      USING ERRCODE = '42501';
  END IF;

  v_slug := lower(v_name);
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
  v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');

  IF v_slug = '' THEN
    RAISE EXCEPTION 'Category name must contain letters or numbers.';
  END IF;

  SELECT c.id
    INTO v_category_id
  FROM public.categories c
  WHERE c.restaurant_id = p_restaurant_id
    AND lower(trim(c.name)) = lower(v_name)
  LIMIT 1;

  IF v_category_id IS NOT NULL THEN
    UPDATE public.categories
    SET is_active = true,
        name = v_name,
        updated_at = now()
    WHERE id = v_category_id;

    RETURN v_category_id;
  END IF;

  SELECT coalesce(max(c.sort_order), -1) + 1
    INTO v_sort_order
  FROM public.categories c
  WHERE c.restaurant_id = p_restaurant_id;

  INSERT INTO public.categories (
    restaurant_id, name, slug, description, sort_order, is_active
  )
  VALUES (
    p_restaurant_id, v_name, v_slug, '', v_sort_order, true
  )
  ON CONFLICT (restaurant_id, slug)
  DO UPDATE SET
    is_active = true,
    name = excluded.name,
    updated_at = now()
  RETURNING id INTO v_category_id;

  RETURN v_category_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_or_create_restaurant_category(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_restaurant_category(uuid, text)
  TO authenticated;

-- POS financial finalization already validates owner/cashier membership internally.
-- Match the SQL privilege boundary to that authorization and pin name resolution.
ALTER FUNCTION public.apply_pos_group_discounts(uuid, integer, jsonb)
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.apply_pos_group_discounts(uuid, integer, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_pos_group_discounts(uuid, integer, jsonb)
  TO authenticated;
