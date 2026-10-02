-- Complete the rider/employee unification.
-- Existing rider ids are migrated to the corresponding restaurant_staff ids before
-- the legacy restaurant_riders table is removed.
--
-- This migration is intentionally data-preserving: orders remain intact, and
-- only the identifier stored in rider assignment columns changes.

-- Map existing delivery assignments to the unified staff records.
update public.delivery_assignments da
set rider_id = (
  select rs.id
  from public.restaurant_riders rr
  join public.restaurant_staff rs
    on rs.restaurant_id = rr.restaurant_id
   and rs.role = 'rider'
   and (
     (rr.auth_user_id is not null and rs.auth_user_id = rr.auth_user_id)
     or (
       rr.auth_user_id is null
       and lower(coalesce(rs.email, '')) = lower(coalesce(rr.email, ''))
       and rs.name = rr.name
       and rs.mobile_number = coalesce(rr.mobile_number, '')
     )
   )
  where rr.id = da.rider_id
  order by rs.created_at
  limit 1
)
where exists (
  select 1
  from public.restaurant_riders rr
  where rr.id = da.rider_id
);

-- Map the rider id stored on orders using the same staff identity.
update public.orders o
set rider_id = (
  select rs.id
  from public.restaurant_riders rr
  join public.restaurant_staff rs
    on rs.restaurant_id = rr.restaurant_id
   and rs.role = 'rider'
   and (
     (rr.auth_user_id is not null and rs.auth_user_id = rr.auth_user_id)
     or (
       rr.auth_user_id is null
       and lower(coalesce(rs.email, '')) = lower(coalesce(rr.email, ''))
       and rs.name = rr.name
       and rs.mobile_number = coalesce(rr.mobile_number, '')
     )
   )
  where rr.id = o.rider_id
  order by rs.created_at
  limit 1
)
where exists (
  select 1
  from public.restaurant_riders rr
  where rr.id = o.rider_id
);

-- Never drop the legacy table while an assignment still contains an old rider id.
do $$
begin
  if exists (
    select 1
    from public.delivery_assignments da
    join public.restaurant_riders rr on rr.id = da.rider_id
  ) then
    raise exception 'Rider migration failed: delivery_assignments still reference restaurant_riders.';
  end if;

  if exists (
    select 1
    from public.orders o
    join public.restaurant_riders rr on rr.id = o.rider_id
  ) then
    raise exception 'Rider migration failed: orders still reference restaurant_riders.';
  end if;
end $$;

-- Replace the delivery assignment foreign key so delivery assignments now point
-- to employee accounts whose role is rider.
alter table public.delivery_assignments
  drop constraint if exists delivery_assignments_rider_id_fkey;

alter table public.delivery_assignments
  add constraint delivery_assignments_rider_id_fkey
  foreign key (rider_id)
  references public.restaurant_staff(id)
  on delete restrict;

-- Orders keep their rider history through the unified employee id. Deleting a
-- rider account clears the assignment from the order without deleting the order.
alter table public.orders
  drop constraint if exists orders_rider_id_fkey;

alter table public.orders
  add constraint orders_rider_id_fkey
  foreign key (rider_id)
  references public.restaurant_staff(id)
  on delete set null;

create index if not exists restaurant_staff_rider_idx
  on public.restaurant_staff (restaurant_id, role, is_active, name);

create index if not exists delivery_assignments_rider_idx
  on public.delivery_assignments (rider_id, status, assigned_at desc);

create index if not exists orders_rider_delivery_idx
  on public.orders (rider_id, delivery_status, created_at desc);

-- Replace policies that previously depended on restaurant_riders.
drop policy if exists "Riders can read their orders" on public.orders;
create policy "Riders can read their orders"
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    where s.id = orders.rider_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
  )
);

drop policy if exists "Riders can update their orders" on public.orders;
create policy "Riders can update their orders"
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    where s.id = orders.rider_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.restaurant_staff s
    where s.id = orders.rider_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
  )
);

drop policy if exists "Riders can read their assignments" on public.delivery_assignments;
create policy "Riders can read their assignments"
on public.delivery_assignments
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    where s.id = delivery_assignments.rider_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
  )
);

drop policy if exists "Riders can update their assignments" on public.delivery_assignments;
create policy "Riders can update their assignments"
on public.delivery_assignments
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    where s.id = delivery_assignments.rider_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.restaurant_staff s
    where s.id = delivery_assignments.rider_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
  )
);

drop policy if exists "Riders can read their order items" on public.order_items;
create policy "Riders can read their order items"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.restaurant_staff s on s.id = o.rider_id
    where o.id = order_items.order_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
  )
);

-- Dispatchers need to see active rider employees so they can assign deliveries.
drop policy if exists "Dispatchers can read rider staff" on public.restaurant_staff;
create policy "Dispatchers can read rider staff"
on public.restaurant_staff
for select
to authenticated
using (
  role = 'rider'
  and exists (
    select 1
    from public.restaurant_staff dispatcher
    join public.restaurants r on r.id = dispatcher.restaurant_id
    where dispatcher.restaurant_id = restaurant_staff.restaurant_id
      and dispatcher.auth_user_id = auth.uid()
      and dispatcher.role = 'dispatcher'
      and dispatcher.is_active = true
      and r.is_active = true
  )
);

-- The old rider table is no longer part of the application. Remove its realtime
-- publication entry before dropping it, then remove the table itself.
do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'restaurant_riders'
  ) then
    alter publication supabase_realtime drop table public.restaurant_riders;
  end if;
end $$;

drop policy if exists "Restaurant owners can read riders" on public.restaurant_riders;
drop policy if exists "Restaurant owners can update riders" on public.restaurant_riders;
drop policy if exists "Dispatchers can read riders" on public.restaurant_riders;
drop policy if exists "Riders can read their profile" on public.restaurant_riders;

drop table if exists public.restaurant_riders;
