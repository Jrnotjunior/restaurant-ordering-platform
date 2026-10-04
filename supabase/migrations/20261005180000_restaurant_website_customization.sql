create table if not exists public.restaurant_website_customizations (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  theme jsonb not null default '{
    "fontHeading":"Manrope",
    "fontBody":"Inter",
    "fontUi":"Inter",
    "borderRadius":"medium",
    "buttonStyle":"filled",
    "colors":{
      "primary":"#111827",
      "primaryHover":"#1f2937",
      "primaryText":"#ffffff",
      "secondary":"#f3f4f6",
      "secondaryText":"#111827",
      "background":"#ffffff",
      "surface":"#ffffff",
      "text":"#111827",
      "muted":"#6b7280",
      "border":"#e5e7eb",
      "success":"#15803d",
      "warning":"#b45309",
      "error":"#b91c1c"
    }
  }'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.restaurant_website_customizations enable row level security;

drop policy if exists "website customization public read" on public.restaurant_website_customizations;
create policy "website customization public read" on public.restaurant_website_customizations
  for select using (true);

drop policy if exists "website customization owner insert" on public.restaurant_website_customizations;
create policy "website customization owner insert" on public.restaurant_website_customizations
  for insert with check (
    exists (select 1 from public.restaurants r
      where r.id = restaurant_id and r.owner_id = auth.uid() and r.is_active = true)
  );

drop policy if exists "website customization owner update" on public.restaurant_website_customizations;
create policy "website customization owner update" on public.restaurant_website_customizations
  for update
  using (exists (select 1 from public.restaurants r
    where r.id = restaurant_id and r.owner_id = auth.uid() and r.is_active = true))
  with check (exists (select 1 from public.restaurants r
    where r.id = restaurant_id and r.owner_id = auth.uid() and r.is_active = true));

drop policy if exists "website customization owner delete" on public.restaurant_website_customizations;
create policy "website customization owner delete" on public.restaurant_website_customizations
  for delete using (exists (select 1 from public.restaurants r
    where r.id = restaurant_id and r.owner_id = auth.uid() and r.is_active = true));

create or replace function public.set_restaurant_website_customization_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists restaurant_website_customizations_updated_at on public.restaurant_website_customizations;
create trigger restaurant_website_customizations_updated_at
before update on public.restaurant_website_customizations
for each row execute function public.set_restaurant_website_customization_updated_at();

grant select on public.restaurant_website_customizations to anon, authenticated;
grant insert, update, delete on public.restaurant_website_customizations to authenticated;

