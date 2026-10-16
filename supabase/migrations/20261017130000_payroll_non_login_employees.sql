-- Allow restaurant owners to add payroll-only employees without login accounts.
alter table public.restaurant_staff alter column email set default '';

alter table public.restaurant_staff drop constraint if exists restaurant_staff_role_check;
alter table public.restaurant_staff add constraint restaurant_staff_role_check
  check (role in (
    'cashier','kitchen','dispatcher','rider',
    'dining','kitchen_staff','cook','server','cleaner','dishwasher','host','manager','other'
  ));

drop policy if exists "Restaurant owners can insert staff" on public.restaurant_staff;
create policy "Restaurant owners can insert staff"
on public.restaurant_staff
for insert
to authenticated
with check (
  auth_user_id is null
  and coalesce(email, '') = ''
  and exists (
    select 1 from public.restaurants r
    where r.id = restaurant_staff.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);
