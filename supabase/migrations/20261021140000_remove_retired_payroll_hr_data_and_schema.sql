-- Fully remove the retired Payroll & HR feature from the development database.
-- All rows in these six feature-only tables are development/test data.
-- Keep public.restaurant_staff intact because POS cashier, kitchen, dispatcher, and rider flows use it.

BEGIN;

-- Remove the Payroll & HR-only triggers and helper functions.
DROP TRIGGER IF EXISTS restaurant_salary_history_trigger ON public.restaurant_employee_salary_profiles;
DROP TRIGGER IF EXISTS restaurant_payroll_item_guard ON public.restaurant_payroll_items;
DROP TRIGGER IF EXISTS restaurant_payroll_run_state_guard ON public.restaurant_payroll_runs;

DROP FUNCTION IF EXISTS public.restaurant_record_salary_profile_history();
DROP FUNCTION IF EXISTS public.restaurant_guard_finalized_payroll_item();
DROP FUNCTION IF EXISTS public.restaurant_guard_payroll_run_state();

-- Delete feature-only test tables in foreign-key dependency order.
DROP TABLE IF EXISTS public.restaurant_employee_documents;
DROP TABLE IF EXISTS public.restaurant_payroll_items;
DROP TABLE IF EXISTS public.restaurant_payroll_runs;
DROP TABLE IF EXISTS public.restaurant_employee_shifts;
DROP TABLE IF EXISTS public.restaurant_employee_salary_history;
DROP TABLE IF EXISTS public.restaurant_employee_salary_profiles;

-- The composite unique index was introduced solely to support the retired
-- payroll/employee foreign keys. Current orders and delivery assignments use id.
DROP INDEX IF EXISTS public.restaurant_staff_tenant_id_uq;

-- Remove the retired module from package configuration and tenant overrides.
DELETE FROM public.system_package_modules WHERE module_key = 'payroll';
DELETE FROM public.restaurant_module_overrides WHERE module_key = 'payroll';
DELETE FROM public.system_modules WHERE module_key = 'payroll';

COMMIT;
