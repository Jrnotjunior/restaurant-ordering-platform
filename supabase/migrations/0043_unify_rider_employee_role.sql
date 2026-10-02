-- Unify Riders with restaurant staff while preserving the delivery-specific rider profile.
-- New Riders are created through create-staff; restaurant_riders remains the delivery profile.

alter table public.restaurant_riders
  add column if not exists is_active boolean not null default true;

create index if not exists restaurant_riders_active_idx
  on public.restaurant_riders (restaurant_id, is_active, created_at);

alter table public.restaurant_staff
  drop constraint if exists restaurant_staff_role_check;

alter table public.restaurant_staff
  add constraint restaurant_staff_role_check
  check (role in ('cashier','kitchen','dispatcher','rider'));

-- Existing riders become employee records so every employee is represented in
-- restaurant_staff. Their existing Auth and delivery records are preserved.
insert into public.restaurant_staff (
  restaurant_id,
  auth_user_id,
  name,
  preferred_name,
  mobile_number,
  email,
  role,
  is_active
)
select
  rr.restaurant_id,
  rr.auth_user_id,
  rr.name,
  rr.name,
  coalesce(rr.mobile_number, ''),
  coalesce(rr.email, ''),
  'rider',
  coalesce(rr.is_active, true)
from public.restaurant_riders rr
where not exists (
  select 1
  from public.restaurant_staff rs
  where rs.restaurant_id = rr.restaurant_id
    and (
      (rr.auth_user_id is not null and rs.auth_user_id = rr.auth_user_id)
      or (rr.auth_user_id is null and lower(rs.email) = lower(coalesce(rr.email, '')))
    )
);

-- Keep Owner employee management aligned with the unified employee model.
drop policy if exists "Restaurant owners can update riders" on public.restaurant_riders;
create policy "Restaurant owners can update riders"
on public.restaurant_riders
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = restaurant_riders.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.restaurants r
    where r.id = restaurant_riders.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);
