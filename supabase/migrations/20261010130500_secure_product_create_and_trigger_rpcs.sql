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
