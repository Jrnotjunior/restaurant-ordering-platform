-- Store the short/preferred display name used on cashier receipts.
alter table public.restaurant_staff
  add column if not exists preferred_name text;

update public.restaurant_staff
set preferred_name = name
where preferred_name is null or btrim(preferred_name) = '';

drop policy if exists "Staff can read own profile" on public.restaurant_staff;
create policy "Staff can read own profile"
on public.restaurant_staff
for select
to authenticated
using (
  auth_user_id = auth.uid()
  and is_active = true
);
