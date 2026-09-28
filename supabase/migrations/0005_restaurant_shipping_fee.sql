-- Restaurant-owned delivery fee setting.
-- Run this migration in Supabase before using the dashboard editor.

alter table public.restaurants
  add column if not exists shipping_fee numeric(10,2) not null default 0,
  add column if not exists owner_id uuid references auth.users(id);

alter table public.restaurants
  drop constraint if exists restaurants_shipping_fee_nonnegative;

alter table public.restaurants
  add constraint restaurants_shipping_fee_nonnegative
  check (shipping_fee >= 0);

create index if not exists restaurants_owner_id_idx
  on public.restaurants (owner_id);

-- Restaurant owners may update only their own restaurant settings.
drop policy if exists "Restaurant owners can update their restaurant" on public.restaurants;

create policy "Restaurant owners can update their restaurant"
on public.restaurants
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- Public storefronts already have SELECT access through the existing active-restaurant policy,
-- so customers can read the shipping fee when checkout is connected to this setting.
