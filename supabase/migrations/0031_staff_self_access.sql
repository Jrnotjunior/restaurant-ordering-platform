-- Allow an authenticated employee to read only their own restaurant staff record.
-- This is used to determine the role after sign-in.

grant select on table public.restaurant_staff to authenticated;

drop policy if exists "Staff can read own account" on public.restaurant_staff;

create policy "Staff can read own account"
on public.restaurant_staff
for select
to authenticated
using (
  auth_user_id = auth.uid()
  and is_active = true
);

-- Owners retain access to their restaurant's staff through the existing owner policy.
