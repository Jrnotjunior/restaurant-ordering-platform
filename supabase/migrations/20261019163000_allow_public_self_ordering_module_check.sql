CREATE OR REPLACE FUNCTION public.public_restaurant_has_module(
  p_restaurant_id uuid,
  p_module_key text DEFAULT 'dispatch_delivery'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    -- Only expose public storefront/ordering and delivery availability checks.
    -- Staff/owner modules remain protected by restaurant_has_module guards.
    WHEN p_module_key NOT IN ('dispatch_delivery', 'self_ordering') THEN false
    ELSE COALESCE(
      (
        SELECT o.enabled
        FROM public.restaurant_module_overrides o
        WHERE o.restaurant_id = p_restaurant_id
          AND o.module_key = p_module_key
      ),
      EXISTS (
        SELECT 1
        FROM public.restaurant_subscriptions s
        JOIN public.system_package_modules pm ON pm.package_id = s.package_id
        JOIN public.system_modules m ON m.module_key = pm.module_key
        WHERE s.restaurant_id = p_restaurant_id
          AND s.status = 'active'
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND m.module_key = p_module_key
          AND m.is_active = true
      )
    )
  END;
$function$;

REVOKE ALL ON FUNCTION public.public_restaurant_has_module(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_restaurant_has_module(uuid, text) TO anon, authenticated;
