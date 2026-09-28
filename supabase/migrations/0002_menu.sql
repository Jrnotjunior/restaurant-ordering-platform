-- Restaurant menu foundation

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  slug text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint categories_name_not_empty check (length(trim(name)) > 0),
  constraint categories_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint categories_restaurant_slug_unique unique (restaurant_id, slug),
  constraint categories_id_restaurant_unique unique (id, restaurant_id)
);

create index if not exists categories_restaurant_idx
  on public.categories (restaurant_id, sort_order, name);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  category_id uuid not null,
  name text not null,
  slug text not null,
  description text not null default '',
  price numeric(12,2) not null,
  image_url text,
  sort_order integer not null default 0,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint products_name_not_empty check (length(trim(name)) > 0),
  constraint products_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint products_price_non_negative check (price >= 0),
  constraint products_restaurant_slug_unique unique (restaurant_id, slug),
  constraint products_category_restaurant_fk
    foreign key (category_id, restaurant_id)
    references public.categories (id, restaurant_id)
    on delete restrict
);

create index if not exists products_restaurant_idx
  on public.products (restaurant_id, sort_order, name);

create index if not exists products_category_idx
  on public.products (category_id, sort_order, name);

alter table public.categories enable row level security;
alter table public.products enable row level security;

create policy "Public can view active categories"
on public.categories
for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.restaurants r
    where r.id = categories.restaurant_id
      and r.is_active = true
  )
);

create policy "Public can view available products"
on public.products
for select
to anon, authenticated
using (
  is_available = true
  and exists (
    select 1
    from public.restaurants r
    where r.id = products.restaurant_id
      and r.is_active = true
  )
);

create trigger categories_set_updated_at
before update on public.categories
for each row
execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row
execute function public.set_updated_at();
