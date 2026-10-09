-- Harden SECURITY DEFINER product RPCs.
-- Product management is owner-only; kitchen staff may only change availability
-- through update_product_availability, which has its own kitchen/owner check.

CREATE OR REPLACE FUNCTION public.update_restaurant_product(
  p_product_id uuid,
  p_name text,
  p_description text,
  p_price numeric,
  p_category_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_restaurant_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Product name is required';
  END IF;
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'Product price must be zero or greater';
  END IF;

  SELECT p.restaurant_id INTO v_restaurant_id
  FROM public.products p
  JOIN public.restaurants r ON r.id = p.restaurant_id
  WHERE p.id = p_product_id
    AND r.owner_id = auth.uid()
    AND r.is_active = true;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Product not found or you are not authorized to update it' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.id = p_category_id
      AND c.restaurant_id = v_restaurant_id
      AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid product category';
  END IF;

  UPDATE public.products
  SET name = btrim(p_name),
      description = btrim(coalesce(p_description, '')),
      price = p_price,
      category_id = p_category_id,
      updated_at = now()
  WHERE id = p_product_id
    AND restaurant_id = v_restaurant_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_restaurant_product(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.products p
  USING public.restaurants r
  WHERE p.id = p_product_id
    AND r.id = p.restaurant_id
    AND r.owner_id = auth.uid()
    AND r.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found or you are not authorized to delete it' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_restaurant_product_image(
  p_product_id uuid,
  p_image_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_image_url IS NULL OR btrim(p_image_url) = '' THEN
    RAISE EXCEPTION 'Product image URL is required';
  END IF;

  UPDATE public.products p
  SET image_url = btrim(p_image_url),
      updated_at = now()
  FROM public.restaurants r
  WHERE p.id = p_product_id
    AND r.id = p.restaurant_id
    AND r.owner_id = auth.uid()
    AND r.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found or you are not authorized to update it' USING ERRCODE = '42501';
  END IF;
END;
$function$;

-- Remove the implicit PUBLIC/anonymous execution path. Authenticated callers
-- still pass the owner authorization checks inside each SECURITY DEFINER RPC.
REVOKE ALL ON FUNCTION public.update_restaurant_product(uuid, text, text, numeric, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_restaurant_product(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_restaurant_product_image(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_restaurant_product(uuid, text, text, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_restaurant_product(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_restaurant_product_image(uuid, text) TO authenticated;

-- Availability has its own owner/kitchen checks, but should never be callable
-- by anonymous users.
REVOKE ALL ON FUNCTION public.update_product_availability(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_product_availability(uuid, boolean) TO authenticated;
