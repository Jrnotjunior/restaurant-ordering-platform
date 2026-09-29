-- Restaurant Ordering Platform
-- In-house rider foundation
-- Run this in Supabase SQL Editor after the orders.rider_id and orders.delivery_status migration.

create table if not exists public.restaurant_riders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  mobile_number text not null,
  email text not null,
  status text not null default 'Available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_riders_status_check
    check (status in ('Available', 'Delivering', 'Offline'))
);

create table if not exists public.rider_delivery_scopes (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.restaurant_riders(id) on delete cascade,
  scope_name text not null,
  created_at timestamptz not null default now(),
  constraint rider_delivery_scopes_name_not_empty
    check (length(trim(scope_name)) > 0),
  constraint rider_delivery_scopes_unique_scope
    unique (rider_id, scope_name)
);

create index if not exists idx_restaurant_riders_restaurant_id
  on public.restaurant_riders (restaurant_id);

create index if not exists idx_restaurant_riders_auth_user_id
  on public.restaurant_riders (auth_user_id);

create index if not exists idx_restaurant_riders_status
  on public.restaurant_riders (status);

create index if not exists idx_rider_delivery_scopes_rider_id
  on public.rider_delivery_scopes (rider_id);

-- Connect orders to the rider table now that the referenced table exists.
alter table public.orders
  drop constraint if exists orders_rider_id_fkey;

alter table public.orders
  add constraint orders_rider_id_fkey
  foreign key (rider_id)
  references public.restaurant_riders(id)
  on delete set null;

-- Keep the existing order table as the source of truth for delivery assignment.
-- Do not use orders.status for rider progress; delivery_status is separate.

alter table public.restaurant_riders enable row level security;
alter table public.rider_delivery_scopes enable row level security;

-- Restaurant owners can manage riders belonging to their own restaurant.
create policy "restaurant owners can view their riders"
on public.restaurant_riders
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = restaurant_riders.restaurant_id
      and r.owner_id = auth.uid()
  )
  or auth_user_id = auth.uid()
);

create policy "restaurant owners can create their riders"
on public.restaurant_riders
for insert
to authenticated
with check (
  exists (
    select 1
    from public.restaurants r
    where r.id = restaurant_riders.restaurant_id
      and r.owner_id = auth.uid()
  )
);

create policy "restaurant owners can update their riders"
on public.restaurant_riders
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = restaurant_riders.restaurant_id
      and r.owner_id = auth.uid()
  )
  or auth_user_id = auth.uid()
)
with check (
  exists (
    select 1
    from public.restaurants r
    where r.id = restaurant_riders.restaurant_id
      and r.owner_id = auth.uid()
  )
  or auth_user_id = auth.uid()
);

create policy "restaurant owners can delete their riders"
on public.restaurant_riders
for delete
to authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = restaurant_riders.restaurant_id
      and r.owner_id = auth.uid()
  )
);

create policy "restaurant owners can view rider scopes"
on public.rider_delivery_scopes
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_riders rr
    join public.restaurants r on r.id = rr.restaurant_id
    where rr.id = rider_delivery_scopes.rider_id
      and (r.owner_id = auth.uid() or rr.auth_user_id = auth.uid())
  )
);

create policy "restaurant owners can create rider scopes"
on public.rider_delivery_scopes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.restaurant_riders rr
    join public.restaurants r on r.id = rr.restaurant_id
    where rr.id = rider_delivery_scopes.rider_id
      and r.owner_id = auth.uid()
  )
);

create policy "restaurant owners can update rider scopes"
on public.rider_delivery_scopes
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurant_riders rr
    join public.restaurants r on r.id = rr.restaurant_id
    where rr.id = rider_delivery_scopes.rider_id
      and r.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.restaurant_riders rr
    join public.restaurants r on r.id = rr.restaurant_id
    where rr.id = rider_delivery_scopes.rider_id
      and r.owner_id = auth.uid()
  )
);

create policy "restaurant owners can delete rider scopes"
on public.rider_delivery_scopes
for delete
to authenticated
using (
  exists (
    select 1
    from public.restaurant_riders rr
    join public.restaurants r on r.id = rr.restaurant_id
    where rr.id = rider_delivery_scopes.rider_id
      and r.owner_id = auth.uid()
  )
);
