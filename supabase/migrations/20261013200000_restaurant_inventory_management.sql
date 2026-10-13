create table if not exists public.restaurant_inventory_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text not null default 'Other' check (char_length(trim(category)) between 1 and 60),
  unit text not null check (char_length(trim(unit)) between 1 and 24),
  quantity_on_hand numeric(12,3) not null default 0 check (quantity_on_hand >= 0),
  low_stock_threshold numeric(12,3) not null default 0 check (low_stock_threshold >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists restaurant_inventory_items_restaurant_name_idx
  on public.restaurant_inventory_items (restaurant_id, name);
create table if not exists public.restaurant_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  item_id uuid references public.restaurant_inventory_items(id) on delete set null,
  item_name text not null,
  unit text not null,
  quantity_change numeric(12,3) not null check (quantity_change <> 0),
  reason text not null check (char_length(trim(reason)) between 1 and 240),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists restaurant_inventory_movements_restaurant_created_idx
  on public.restaurant_inventory_movements (restaurant_id, created_at desc);
alter table public.restaurant_inventory_items enable row level security;
alter table public.restaurant_inventory_movements enable row level security;
grant select, insert, update, delete on public.restaurant_inventory_items to authenticated;
grant select, insert, update, delete on public.restaurant_inventory_movements to authenticated;
grant execute on function public.is_restaurant_owner(uuid) to authenticated;
drop policy if exists "Restaurant owners manage inventory items" on public.restaurant_inventory_items;
create policy "Restaurant owners manage inventory items"
  on public.restaurant_inventory_items for all to authenticated
  using (public.is_restaurant_owner(restaurant_id))
  with check (public.is_restaurant_owner(restaurant_id));
drop policy if exists "Restaurant owners manage inventory movements" on public.restaurant_inventory_movements;
create policy "Restaurant owners manage inventory movements"
  on public.restaurant_inventory_movements for all to authenticated
  using (public.is_restaurant_owner(restaurant_id))
  with check (public.is_restaurant_owner(restaurant_id));
create or replace function public.restaurant_adjust_inventory_stock(
  p_item_id uuid,
  p_quantity_change numeric,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.restaurant_inventory_items%rowtype;
begin
  select * into v_item
  from public.restaurant_inventory_items
  where id = p_item_id
  for update;
  if not found then raise exception 'Inventory item not found.'; end if;
  if not public.is_restaurant_owner(v_item.restaurant_id) then raise exception 'Not authorized to adjust this inventory.'; end if;
  if p_quantity_change is null or p_quantity_change = 0 then raise exception 'Stock adjustment must be non-zero.'; end if;
  if char_length(trim(coalesce(p_reason, ''))) = 0 or char_length(trim(p_reason)) > 240 then raise exception 'A reason of 1 to 240 characters is required.'; end if;
  if v_item.quantity_on_hand + p_quantity_change < 0 then raise exception 'Stock cannot be negative.'; end if;
  update public.restaurant_inventory_items
  set quantity_on_hand = quantity_on_hand + p_quantity_change, updated_at = now()
  where id = p_item_id;
  insert into public.restaurant_inventory_movements (
    restaurant_id, item_id, item_name, unit, quantity_change, reason, created_by
  ) values (
    v_item.restaurant_id, v_item.id, v_item.name, v_item.unit, p_quantity_change, trim(p_reason), auth.uid()
  );
end;
$$;
revoke all on function public.restaurant_adjust_inventory_stock(uuid, numeric, text) from public;
grant execute on function public.restaurant_adjust_inventory_stock(uuid, numeric, text) to authenticated;
