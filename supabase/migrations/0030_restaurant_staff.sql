-- Restaurant employee accounts
-- Kitchen and Dispatcher are shared accounts: one active account of each role per restaurant.
-- Cashier accounts may be created multiple times. Riders remain managed by restaurant_riders.

create table if not exists public.restaurant_staff (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  mobile_number text not null default '',
  email text not null,
  role text not null check (role in ('cashier','kitchen','dispatcher')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restaurant_staff_restaurant_idx
  on public.restaurant_staff (restaurant_id);

create index if not exists restaurant_staff_role_idx
  on public.restaurant_staff (restaurant_id, role);

create unique index if not exists restaurant_staff_shared_role_idx
  on public.restaurant_staff (restaurant_id, role)
  where role in ('kitchen','dispatcher') and is_active = true;

alter table public.restaurant_staff enable row level security;

drop policy if exists "Restaurant owners can read staff" on public.restaurant_staff;
create policy "Restaurant owners can read staff"
on public.restaurant_staff
for select
to authenticated
using (
  exists (
    select 1 from public.restaurants r
    where r.id = restaurant_staff.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop policy if exists "Restaurant owners can update staff" on public.restaurant_staff;
create policy "Restaurant owners can update staff"
on public.restaurant_staff
for update
to authenticated
using (
  exists (
    select 1 from public.restaurants r
    where r.id = restaurant_staff.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
)
with check (
  exists (
    select 1 from public.restaurants r
    where r.id = restaurant_staff.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop trigger if exists restaurant_staff_set_updated_at on public.restaurant_staff;
create trigger restaurant_staff_set_updated_at
before update on public.restaurant_staff
for each row
execute function public.set_updated_at();
