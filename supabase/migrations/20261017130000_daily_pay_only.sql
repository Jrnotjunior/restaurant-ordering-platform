-- Daily-pay-only policy for current salary profiles.
-- Preserve prior monthly values in salary history and finalized payroll snapshots.
alter table public.restaurant_employee_salary_profiles
  drop constraint if exists restaurant_employee_salary_profiles_salary_basis_check;

update public.restaurant_employee_salary_profiles
set salary_basis = 'daily',
    updated_at = now()
where salary_basis <> 'daily';

alter table public.restaurant_employee_salary_profiles
  add constraint restaurant_employee_salary_profiles_salary_basis_check
  check (salary_basis = 'daily');
