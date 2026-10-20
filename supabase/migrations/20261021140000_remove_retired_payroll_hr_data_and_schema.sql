-- Fully remove the retired Payroll & HR feature from the development database.
-- All rows in these six feature-only tables are development/test data.
-- Keep public.restaurant_staff intact because POS cashier, kitchen, dispatcher, and rider flows use it.

BEGIN;

-- Remove helper functions created solely for Payroll & HR.
DROP FUNCTION IF EXISTS public.restaurant_record_salary_profile_history() CASCADE;
DROP FUNCTION IF EXISTS public.restaurant_guard_finalized_payroll_item() CASCADE;
DROP FUNCTION IF EXISTS public.restaurant_guard_payroll_run_state() CASCADE;

-- Drop all feature-only tables and their stored test records.
-- CASCADE removes only objects dependent on these retired tables, such as their
-- indexes, row-security policies, triggers, and foreign-key constraints.
DROP TABLE IF EXISTS
  public.restaurant_employee_documents,
  public.restaurant_payroll_items,
  public.restaurant_payroll_runs,
  public.restaurant_employee_shifts,
  public.restaurant_employee_salary_history,
  public.restaurant_employee_salary_profiles
CASCADE;

-- The composite unique index was introduced solely to support the retired
-- payroll/employee foreign keys. Current orders and delivery assignments use id.
DROP INDEX IF EXISTS public.restaurant_staff_tenant_id_uq;

-- Remove the retired module from package configuration and tenant overrides.
DELETE FROM public.system_package_modules WHERE module_key = 'payroll';
DELETE FROM public.restaurant_module_overrides WHERE module_key = 'payroll';
DELETE FROM public.system_modules WHERE module_key = 'payroll';

COMMIT;
