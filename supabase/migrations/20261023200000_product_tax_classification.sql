-- Product tax classification and per-sale line snapshot groundwork.
-- Existing products are deliberately left unclassified: tax treatment must not be guessed.

alter table public.products
  add column if not exists tax_category text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_tax_category_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_tax_category_check
      check (tax_category is null or tax_category in ('standard_rate','vat_exempt','zero_rated'));
  end if;
end $$;

alter table public.order_items
  add column if not exists tax_category_snapshot text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_items_tax_category_snapshot_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_tax_category_snapshot_check
      check (tax_category_snapshot is null or tax_category_snapshot in ('standard_rate','vat_exempt','zero_rated'));
  end if;
end $$;

alter table public.orders
  add column if not exists tax_zero_rated_sales numeric(12,2);

comment on column public.products.tax_category is
  'Tax classification assigned from reviewed product/business tax treatment. NULL means unclassified; it is not assumed standard-rated.';
comment on column public.order_items.tax_category_snapshot is
  'Copy of the product tax category at order-line creation. Historical rows remain NULL when the original classification is unknown; product changes do not rewrite prior orders.';
comment on column public.orders.tax_zero_rated_sales is
  'Zero-rated sales amount recorded only when a reviewed server-side calculation determines it. NULL means unknown/not calculated; do not treat it as zero.';

create or replace function public.set_restaurant_product_tax_category(
  p_product_id uuid,
  p_tax_category text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_restaurant_id uuid;
  v_old_tax_category text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_tax_category is not null and p_tax_category not in ('standard_rate','vat_exempt','zero_rated') then
    raise exception 'Tax category must be standard_rate, vat_exempt, zero_rated, or NULL for unclassified.';
  end if;

  select p.restaurant_id, p.tax_category
    into v_restaurant_id, v_old_tax_category
    from public.products p
    join public.restaurants r on r.id = p.restaurant_id
    where p.id = p_product_id
      and r.owner_id = auth.uid()
      and r.is_active = true
    for update of p;

  if not found then
    raise exception 'Product not found or you are not authorized to update it.' using errcode = '42501';
  end if;

  update public.products
     set tax_category = p_tax_category,
         updated_at = now()
   where id = p_product_id
     and restaurant_id = v_restaurant_id;

  return p_tax_category;
end;
$$;

revoke all on function public.set_restaurant_product_tax_category(uuid, text) from public, anon;
grant execute on function public.set_restaurant_product_tax_category(uuid, text) to authenticated;

create or replace function public.snapshot_order_item_tax_category()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_category text;
begin
  if new.product_id is null or new.tax_category_snapshot is not null then
    return new;
  end if;

  select p.tax_category
    into v_product_category
    from public.products p
    join public.orders o
      on o.id = new.order_id
     and o.restaurant_id = p.restaurant_id
    where p.id = new.product_id;

  if not found then
    raise exception 'The order line product does not belong to the same restaurant as the order.';
  end if;

  new.tax_category_snapshot := v_product_category;
  return new;
end;
$$;

revoke all on function public.snapshot_order_item_tax_category() from public, anon, authenticated, service_role;

drop trigger if exists snapshot_order_item_tax_category on public.order_items;
create trigger snapshot_order_item_tax_category
before insert on public.order_items
for each row execute function public.snapshot_order_item_tax_category();

create or replace function public.journal_product_tax_category_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
begin
  if old.tax_category is not distinct from new.tax_category then
    return new;
  end if;

  v_actor_role := case
    when auth.uid() is null then coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'system')
    when public.is_system_admin() then 'system_admin'
    when exists (
      select 1 from public.restaurants r
      where r.id = new.restaurant_id and r.owner_id = auth.uid()
    ) then 'owner'
    else 'authenticated_user'
  end;

  insert into public.pos_sales_journal (
    restaurant_id, order_id, order_number, event_type, operation,
    actor_user_id, actor_role, old_values, new_values
  ) values (
    new.restaurant_id, null, null, 'PRODUCT_TAX_CATEGORY_CHANGED', 'UPDATE',
    auth.uid(), v_actor_role,
    jsonb_build_object('product_id', old.id, 'tax_category', old.tax_category),
    jsonb_build_object('product_id', new.id, 'tax_category', new.tax_category)
  );

  return new;
end;
$$;

revoke all on function public.journal_product_tax_category_change() from public, anon, authenticated, service_role;

drop trigger if exists journal_product_tax_category_change on public.products;
create trigger journal_product_tax_category_change
after update of tax_category on public.products
for each row execute function public.journal_product_tax_category_change();
