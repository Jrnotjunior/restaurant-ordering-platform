-- Treat riders as employees with an explicit active/inactive status.
alter table public.restaurant_riders
  add column if not exists is_active boolean not null default true;

create index if not exists restaurant_riders_active_idx
  on public.restaurant_riders (restaurant_id, is_active, created_at);
