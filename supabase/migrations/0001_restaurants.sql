-- Restaurant tenant foundation
-- Apply this migration to the Supabase project before connecting the frontend.

create extension if not exists pgcrypto;

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  tagline text not null default '',
  logo_url text,
  location_text text,
  contact_number text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurants_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists restaurants_active_idx
  on public.restaurants (is_active);

alter table public.restaurants enable row level security;

-- Public storefronts may read active restaurant profiles.
create policy "Public can view active restaurants"
on public.restaurants
for select
to anon, authenticated
using (is_active = true);

-- Keep updated_at consistent when a restaurant record changes.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists restaurants_set_updated_at on public.restaurants;

create trigger restaurants_set_updated_at
before update on public.restaurants
for each row
execute function public.set_updated_at();
