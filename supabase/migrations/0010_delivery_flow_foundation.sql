-- Delivery flow foundation
-- Keeps rider assignments and delivery state in the database so customer,
-- restaurant dispatch, and rider views share one source of truth.

create table if not exists public.restaurant_riders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id uuid,
  name text not null,
  mobile_number text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_riders_name_not_empty check (length(trim(name)) > 0),
  constraint restaurant_riders_mobile_not_empty check (length(trim(mobile_number)) > 0)
);

alter table public.restaurant_riders
  add column if not exists auth_user_id uuid;
alter table public.restaurant_riders
  add column if not exists name text;
alter table public.restaurant_riders
  add column if not exists mobile_number text;
alter table public.restaurant_riders
  add column if not exists email text;
alter table public.restaurant_riders
  add column if not exists created_at timestamptz not null default now();
alter table public.restaurant_riders
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists restaurant_riders_auth_user_uidx
  on public.restaurant_riders (auth_user_id)
  where auth_user_id is not null;

create index if not exists restaurant_riders_restaurant_idx
  on public.restaurant_riders (restaurant_id, created_at);

create table if not exists public.rider_delivery_scopes (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.restaurant_riders(id) on delete cascade,
  scope_name text not null,
  created_at timestamptz not null default now(),
  constraint rider_delivery_scopes_name_not_empty check (length(trim(scope_name)) > 0),
  constraint rider_delivery_scopes_unique unique (rider_id, scope_name)
);

create index if not exists rider_delivery_scopes_rider_idx
  on public.rider_delivery_scopes (rider_id, scope_name);

create table if not exists public.delivery_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  rider_id uuid not null references public.restaurant_riders(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  status text not null default 'assigned',
  assigned_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_assignments_status_check
    check (status in ('assigned', 'delivering', 'delivered', 'cancelled'))
);

alter table public.delivery_assignments
  add column if not exists assigned_at timestamptz not null default now();
alter table public.delivery_assignments
  add column if not exists delivered_at timestamptz;
alter table public.delivery_assignments
  add column if not exists created_at timestamptz not null default now();
alter table public.delivery_assignments
  add column if not exists updated_at timestamptz not null default now();

create index if not exists delivery_assignments_order_idx
  on public.delivery_assignments (order_id, assigned_at desc);

create index if not exists delivery_assignments_rider_idx
  on public.delivery_assignments (rider_id, status, assigned_at desc);

create index if not exists delivery_assignments_restaurant_idx
  on public.delivery_assignments (restaurant_id, status, assigned_at desc);

create unique index if not exists delivery_assignments_active_order_uidx
  on public.delivery_assignments (order_id)
  where status in ('assigned', 'delivering');

-- Delivery state belongs to the order. The rider table does not need an
-- availability/status column; availability is derived from active assignments.
alter table public.orders
  add column if not exists rider_id uuid;
alter table public.orders
  add column if not exists delivery_status text not null default 'unassigned';
alter table public.orders
  add column if not exists rider_assigned_at timestamptz;

create index if not exists orders_rider_delivery_idx
  on public.orders (rider_id, delivery_status, created_at desc);

create index if not exists orders_delivery_dispatch_idx
  on public.orders (restaurant_id, order_type, status, delivery_status, created_at asc);

-- Keep delivery status values constrained even when older databases did not
-- have the constraint yet.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_delivery_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_delivery_status_check
      check (delivery_status in ('unassigned', 'assigned', 'delivering', 'delivered'));
  end if;
end $$;

drop trigger if exists restaurant_riders_set_updated_at on public.restaurant_riders;
create trigger restaurant_riders_set_updated_at
before update on public.restaurant_riders
for each row
execute function public.set_updated_at();

drop trigger if exists delivery_assignments_set_updated_at on public.delivery_assignments;
create trigger delivery_assignments_set_updated_at
before update on public.delivery_assignments
for each row
execute function public.set_updated_at();

alter table public.restaurant_riders enable row level security;
alter table public.rider_delivery_scopes enable row level security;
alter table public.delivery_assignments enable row level security;

-- Realtime publication is configured for the tables used by the delivery flow.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['orders', 'restaurant_riders', 'rider_delivery_scopes', 'delivery_assignments']
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
