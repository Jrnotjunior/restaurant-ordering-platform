-- Retire Payroll & HR from Web2Table's available product modules.
-- Keep existing payroll tables and records for historical/reference purposes;
-- this migration removes access and package inclusion without destroying data.

BEGIN;

UPDATE public.system_modules
SET is_active = false,
    updated_at = now()
WHERE module_key = 'payroll';

DELETE FROM public.system_package_modules
WHERE module_key = 'payroll';

UPDATE public.restaurant_module_overrides
SET enabled = false,
    updated_at = now()
WHERE module_key = 'payroll';

COMMIT;
