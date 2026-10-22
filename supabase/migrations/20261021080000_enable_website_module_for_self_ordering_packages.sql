-- Website customization is bundled with Self Ordering and is not a
-- separately packageable module. Keep the legacy module key inactive and
-- remove any standalone package assignments. Frontend and RPC checks must use
-- the Self Ordering entitlement for website customization access.
BEGIN;

DELETE FROM public.system_package_modules
WHERE module_key = 'website';

UPDATE public.system_modules
SET is_active = false,
    updated_at = now()
WHERE module_key = 'website';

COMMIT;
