-- Group POS Senior Citizen / PWD discounts.
-- Supports multiple eligible beneficiaries in one group transaction.
-- Each beneficiary receives 20% of their equal share of the POS subtotal.

alter table public.orders
  add column if not exists discount_type text,
  add column if not exists discount_id_number text,
  add column if not exists discount_amount numeric(12,2) not null default 0,
  add column if not exists discount_group_size integer not null default 1,
  add column if not exists discount_beneficiary_count integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_type_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_discount_type_check check (discount_type is null or discount_type in ('senior','pwd'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_amount_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_discount_amount_check check (discount_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_group_size_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_discount_group_size_check check (discount_group_size >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_discount_beneficiary_count_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_discount_beneficiary_count_check check (discount_beneficiary_count >= 0);
  end if;
end $$;

create table if not exists public.order_discount_beneficiaries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  discount_type text not null check (discount_type in ('senior','pwd')),
  discount_id_type text not null,
  discount_id_number text not null,
  eligible_amount numeric(12,2) not null,
  discount_amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint order_discount_beneficiary_amounts_check check (eligible_amount >= 0 and discount_amount >= 0)
);

create index if not exists order_discount_beneficiaries_order_idx on public.order_discount_beneficiaries(order_id);
create unique index if not exists order_discount_beneficiaries_order_id_number_idx on public.order_discount_beneficiaries(order_id, discount_id_number);

alter table public.order_discount_beneficiaries enable row level security;

drop policy if exists "Restaurant owners can read order discount beneficiaries" on public.order_discount_beneficiaries;
create policy "Restaurant owners can read order discount beneficiaries"
on public.order_discount_beneficiaries
for select
to authenticated
using (
  exists (
    select 1 from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.id = order_discount_beneficiaries.order_id
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1 from public.restaurant_staff s
          where s.restaurant_id = r.id
            and s.auth_user_id = auth.uid()
            and s.role in ('cashier','kitchen','dispatcher')
            and s.is_active = true
        )
      )
  )
);

create or replace function public.apply_pos_group_discounts(
  p_order_id uuid,
  p_group_size integer,
  p_beneficiaries jsonb
)
returns table (order_id uuid, group_size integer, beneficiary_count integer, discount_amount numeric, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_beneficiary jsonb;
  v_type text;
  v_id_type text;
  v_id_number text;
  v_eligible_amount numeric(12,2);
  v_discount numeric(12,2);
  v_total_discount numeric(12,2) := 0;
  v_total numeric(12,2);
  v_count integer;
begin
  if p_group_size is null or p_group_size < 1 then raise exception 'Group size must be at least 1'; end if;
  if jsonb_typeof(p_beneficiaries) <> 'array' then raise exception 'Discount beneficiaries must be an array'; end if;
  v_count := jsonb_array_length(p_beneficiaries);
  if v_count < 1 then raise exception 'At least one Senior Citizen or PWD beneficiary is required'; end if;
  if v_count > p_group_size then raise exception 'Discount beneficiaries cannot exceed the group size'; end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  if not exists (
    select 1 from public.restaurants r
    where r.id = v_order.restaurant_id
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1 from public.restaurant_staff s
          where s.restaurant_id = r.id and s.auth_user_id = auth.uid()
            and s.role = 'cashier' and s.is_active = true
        )
      )
  ) then raise exception 'You are not authorized to apply a POS discount to this order'; end if;

  if coalesce(v_order.discount_beneficiary_count, 0) > 0 or coalesce(v_order.discount_amount, 0) > 0 or v_order.discount_type is not null then
    raise exception 'A discount has already been applied to this order';
  end if;

  v_eligible_amount := round(v_order.subtotal / p_group_size, 2);

  for v_beneficiary in select value from jsonb_array_elements(p_beneficiaries) loop
    v_type := lower(trim(coalesce(v_beneficiary->>'discount_type', '')));
    v_id_type := trim(coalesce(v_beneficiary->>'discount_id_type', ''));
    v_id_number := trim(coalesce(v_beneficiary->>'discount_id_number', ''));

    if v_type not in ('senior','pwd') then raise exception 'Invalid discount type'; end if;
    if length(v_id_type) = 0 then raise exception 'ID type is required for every discount beneficiary'; end if;
    if length(v_id_number) = 0 then raise exception 'ID number is required for every discount beneficiary'; end if;

    if exists (select 1 from public.order_discount_beneficiaries b where b.order_id = p_order_id and b.discount_id_number = v_id_number) then
      raise exception 'The same ID number cannot be used twice on one order';
    end if;

    v_discount := round(v_eligible_amount * 0.20, 2);
    v_total_discount := v_total_discount + v_discount;

    insert into public.order_discount_beneficiaries (
      order_id, discount_type, discount_id_type, discount_id_number, eligible_amount, discount_amount
    ) values (
      p_order_id, v_type, v_id_type, v_id_number, v_eligible_amount, v_discount
    );
  end loop;

  v_total := greatest(round(v_order.subtotal + v_order.delivery_fee - v_total_discount, 2), 0);

  update public.orders
  set
    discount_type = case when v_count = 1 then lower(trim(p_beneficiaries->0->>'discount_type')) else null end,
    discount_id_number = case when v_count = 1 then trim(p_beneficiaries->0->>'discount_id_number') else null end,
    discount_amount = v_total_discount,
    discount_group_size = p_group_size,
    discount_beneficiary_count = v_count,
    total = v_total,
    updated_at = now()
  where id = p_order_id;

  return query select p_order_id, p_group_size, v_count, v_total_discount, v_total;
end;
$$;

grant execute on function public.apply_pos_group_discounts(uuid, integer, jsonb) to authenticated;
