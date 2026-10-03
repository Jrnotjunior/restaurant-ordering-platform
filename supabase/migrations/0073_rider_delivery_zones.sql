-- Rider delivery scopes.
-- Each rider can be assigned one or more restaurant delivery zones.
-- Only the restaurant owner can manage these assignments.

create table if not exists public.rider_delivery_zones (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  rider_id uuid not null references public.restaurant_staff(id) on delete cascade,
  delivery_zone_id uuid not null references public.restaurant_delivery_zones(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint rider_delivery_zones_unique unique (rider_id, delivery_zone_id)
);

create index if not exists rider_delivery_zones_rider_idx
  on public.rider_delivery_zones (restaurant_id, rider_id);

create index if not exists rider_delivery_zones_zone_idx
  on public.rider_delivery_zones (restaurant_id, delivery_zone_id);

alter table public.rider_delivery_zones enable row level security;

drop policy if exists "Restaurant owners can read rider delivery zones"
on public.rider_delivery_zones;
create policy "Restaurant owners can read rider delivery zones"
on public.rider_delivery_zones
for select
to authenticated
using (public.is_restaurant_owner(restaurant_id));

drop policy if exists "Restaurant owners can insert rider delivery zones"
on public.rider_delivery_zones;
create policy "Restaurant owners can insert rider delivery zones"
on public.rider_delivery_zones
for insert
to authenticated
with check (
  public.is_restaurant_owner(restaurant_id)
  and exists (
    select 1
    from public.restaurant_staff s
    where s.id = rider_delivery_zones.rider_id
      and s.restaurant_id = rider_delivery_zones.restaurant_id
      and s.role = 'rider'
  )
  and exists (
    select 1
    from public.restaurant_delivery_zones z
    where z.id = rider_delivery_zones.delivery_zone_id
      and z.restaurant_id = rider_delivery_zones.restaurant_id
      and z.is_supported = true
  )
);

drop policy if exists "Restaurant owners can delete rider delivery zones"
on public.rider_delivery_zones;
create policy "Restaurant owners can delete rider delivery zones"
on public.rider_delivery_zones
for delete
to authenticated
using (public.is_restaurant_owner(restaurant_id));
