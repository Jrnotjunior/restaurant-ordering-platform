-- Owner-only expense tracking for business reports.
create table if not exists public.restaurant_business_expenses (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  expense_date date not null default current_date,
  category text not null check (category in ('ingredients','payroll','rent','utilities','packaging','delivery','marketing','maintenance','supplies','other')),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_business_expenses_description_check check (length(trim(description)) between 1 and 240)
);

create index if not exists restaurant_business_expenses_restaurant_date_idx
  on public.restaurant_business_expenses (restaurant_id, expense_date desc, created_at desc);

alter table public.restaurant_business_expenses enable row level security;

grant select, insert, update, delete on public.restaurant_business_expenses to authenticated;
grant execute on function public.is_restaurant_owner(uuid) to authenticated;

drop policy if exists "Restaurant owners manage their business expenses" on public.restaurant_business_expenses;
create policy "Restaurant owners manage their business expenses"
on public.restaurant_business_expenses
for all
to authenticated
using (public.is_restaurant_owner(restaurant_id))
with check (public.is_restaurant_owner(restaurant_id));
