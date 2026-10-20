-- Create the RPC used by the product repository. This function was previously
-- referenced only by ALTER/GRANT statements, so clean installs and the current
-- connected schema had no implementation despite the browser calling it.
CREATE OR REPLACE FUNCTION public.create_restaurant_product(
  p_restaurant_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_category_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_base_slug text;
  v_slug text;
  v_suffix integer := 2;
  v_sort_order integer;
  v_product_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'Multi-factor authentication is required' USING ERRCODE = '42501';
  END IF;

  IF p_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Restaurant is required';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Product name is required';
  END IF;
  IF p_price IS NULL
     OR p_price < 0
     OR p_price::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Product price must be a finite number greater than or equal to zero';
  END IF;
  IF p_category_id IS NULL THEN
    RAISE EXCEPTION 'Product category is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = p_restaurant_id
      AND r.owner_id = auth.uid()
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Restaurant not found or you are not authorized to add products'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = p_category_id
      AND c.restaurant_id = p_restaurant_id
      AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid product category';
  END IF;

  v_base_slug := lower(v_name);
  v_base_slug := regexp_replace(v_base_slug, '[^a-z0-9]+', '-', 'g');
  v_base_slug := regexp_replace(v_base_slug, '(^-+|-+$)', '', 'g');
  IF v_base_slug = '' THEN
    v_base_slug := 'product';
  END IF;
  v_slug := v_base_slug;

  SELECT coalesce(max(p.sort_order), -1) + 1
    INTO v_sort_order
  FROM public.products p
  WHERE p.restaurant_id = p_restaurant_id;

  LOOP
    INSERT INTO public.products (
      restaurant_id,
      category_id,
      name,
      slug,
      description,
      price,
      sort_order,
      is_available
    )
    VALUES (
      p_restaurant_id,
      p_category_id,
      v_name,
      v_slug,
      btrim(coalesce(p_description, '')),
      p_price,
      v_sort_order,
      true
    )
    ON CONFLICT (restaurant_id, slug) DO NOTHING
    RETURNING id INTO v_product_id;

    IF v_product_id IS NOT NULL THEN
      RETURN v_product_id;
    END IF;

    v_slug := v_base_slug || '-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  END LOOP;
END;
$function$;

-- Restrict product creation to authenticated callers. The function already validates
-- auth.uid(), restaurant ownership, active status, and category tenant ownership.
-- The privilege boundary should match that internal authorization boundary.
ALTER FUNCTION public.create_restaurant_product(uuid, text, text, numeric, uuid)
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.create_restaurant_product(uuid, text, text, numeric, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_restaurant_product(uuid, text, text, numeric, uuid)
  TO authenticated;

-- Trigger functions are invoked by their triggers, not directly through the API.
-- Pin their search paths and remove direct API execution privileges.
ALTER FUNCTION public.capture_delivery_assignment_rider_name()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.capture_delivery_assignment_rider_name()
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.set_updated_at()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.set_updated_at()
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.update_restaurant_rider_updated_at()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.update_restaurant_rider_updated_at()
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.set_restaurant_website_customization_updated_at()
  SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.set_restaurant_website_customization_updated_at()
  FROM PUBLIC, anon, authenticated;
