-- Preserve payroll history while allowing a staff member to be permanently removed.
-- Payroll items keep employee_name_snapshot / employee_role_snapshot and salary snapshots;
-- employee_id becomes nullable when its staff record is deleted.
alter table public.restaurant_payroll_items
  alter column employee_id drop not null;

alter table public.restaurant_payroll_items
  drop constraint if exists restaurant_payroll_items_employee_id_fkey;

alter table public.restaurant_payroll_items
  drop constraint if exists restaurant_payroll_items_restaurant_id_employee_id_fkey;

alter table public.restaurant_payroll_items
  add constraint restaurant_payroll_items_employee_id_fkey
  foreign key (employee_id)
  references public.restaurant_staff(id)
  on delete set null;

alter table public.restaurant_payroll_items
  add constraint restaurant_payroll_items_restaurant_id_employee_id_fkey
  foreign key (restaurant_id, employee_id)
  references public.restaurant_staff(restaurant_id, id)
  on delete set null (employee_id);
