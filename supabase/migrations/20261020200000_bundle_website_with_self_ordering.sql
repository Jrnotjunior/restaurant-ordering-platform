-- Treat Website as part of the Self Ordering offering, not a standalone module.
-- Keep the legacy 'website' key working for existing frontend guards while
-- package entitlements and module lists count only 'self_ordering'.

BEGIN;

-- Website is not independently packageable or independently displayed.
DELETE FROM public.system_package_modules
WHERE module_key = 'website';

UPDATE public.system_modules
SET is_active = false,
    updated_at = now()
WHERE module_key = 'website';

-- Preserve compatibility with existing route guards that still ask for
-- module_key='website': that check now uses the Self Ordering entitlement.
CREATE OR REPLACE FUNCTION public.restaurant_has_module(
  p_restaurant_id uuid,
  p_module_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_enabled boolean;
  v_effective_module_key text;
BEGIN
  v_effective_module_key := CASE
    WHEN p_module_key = 'website' THEN 'self_ordering'
    ELSE p_module_key
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = p_restaurant_id
      AND (
        r.owner_id = (SELECT auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.restaurant_staff rs
          WHERE rs.restaurant_id = r.id
            AND rs.auth_user_id = (SELECT auth.uid())
            AND rs.is_active = true
        )
        OR public.system_admin_has_access()
      )
  ) THEN
    RETURN false;
  END IF;

  SELECT o.enabled
    INTO v_enabled
  FROM public.restaurant_module_overrides o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.module_key = v_effective_module_key;

  IF FOUND THEN
    RETURN v_enabled;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.restaurant_subscriptions s
    JOIN public.system_package_modules pm ON pm.package_id = s.package_id
    JOIN public.system_modules m ON m.module_key = pm.module_key
    WHERE s.restaurant_id = p_restaurant_id
      AND s.status = 'active'
      AND (s.expires_at IS NULL OR s.expires_at > now())
      AND m.module_key = v_effective_module_key
      AND m.is_active = true
  );
END;
$function$;

-- Public storefront checks also treat legacy Website requests as Self Ordering.
-- Continue exposing only the approved public availability checks.
CREATE OR REPLACE FUNCTION public.public_restaurant_has_module(
  p_restaurant_id uuid,
  p_module_key text DEFAULT 'dispatch_delivery'::text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_module_key NOT IN ('dispatch_delivery', 'self_ordering', 'website') THEN false
    ELSE COALESCE(
      (
        SELECT o.enabled
        FROM public.restaurant_module_overrides o
        WHERE o.restaurant_id = p_restaurant_id
          AND o.module_key = CASE
            WHEN p_module_key = 'website' THEN 'self_ordering'
            ELSE p_module_key
          END
      ),
      EXISTS (
        SELECT 1
        FROM public.restaurant_subscriptions s
        JOIN public.system_package_modules pm ON pm.package_id = s.package_id
        JOIN public.system_modules m ON m.module_key = pm.module_key
        WHERE s.restaurant_id = p_restaurant_id
          AND s.status = 'active'
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND m.module_key = CASE
            WHEN p_module_key = 'website' THEN 'self_ordering'
            ELSE p_module_key
          END
          AND m.is_active = true
      )
    )
  END;
$function$;

COMMIT;
