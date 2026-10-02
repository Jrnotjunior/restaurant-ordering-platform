-- POS statutory discount support for Senior Citizens and PWD customers.
-- One discount may be applied to a POS order. Senior Citizen and PWD
-- discounts are mutually exclusive and require the customer's ID number.

alter table public.orders
  add column if not exists discount_type text,
  add column if not exists discount_id_number text,
  add column if not exists discount_amount numeric(12,2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_discount_type_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_discount_type_check
      check (discount_type is null or discount_type in ('senior','pwd'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_discount_amount_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_discount_amount_check
      check (discount_amount >= 0);
  end if;
end $$;

create or replace function public.apply_pos_discount(
  p_order_id uuid,
  p_discount_type text,
  p_discount_id_number text
)
returns table (
  order_id uuid,
  discount_type text,
  discount_id_number text,
  discount_amount numeric,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_discount numeric(12,2);
  v_total numeric(12,2);
begin
  if p_discount_type not in ('senior', 'pwd') then
    raise exception 'Invalid discount type';
  end if;

  if length(trim(coalesce(p_discount_id_number, ''))) = 0 then
    raise exception 'Senior Citizen or PWD ID number is required';
  end if;

  select *
    into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = v_order.restaurant_id
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1
          from public.restaurant_staff s
          where s.restaurant_id = r.id
            and s.auth_user_id = auth.uid()
            and s.role = 'cashier'
            and s.is_active = true
        )
      )
  ) then
    raise exception 'You are not authorized to apply a POS discount to this order';
  end if;

  if coalesce(v_order.discount_amount, 0) > 0 or v_order.discount_type is not null then
    raise exception 'A discount has already been applied to this order';
  end if;

  -- POS menu prices currently do not carry a separate VAT field, so the
  -- statutory 20% discount is calculated against the POS subtotal.
  v_discount := round(v_order.subtotal * 0.20, 2);
  v_total := greatest(round(v_order.subtotal + v_order.delivery_fee - v_discount, 2), 0);

  update public.orders
  set
    discount_type = p_discount_type,
    discount_id_number = trim(p_discount_id_number),
    discount_amount = v_discount,
    total = v_total,
    updated_at = now()
  where id = p_order_id;

  return query
  select
    p_order_id,
    p_discount_type,
    trim(p_discount_id_number),
    v_discount,
    v_total;
end;
$$;

grant execute on function public.apply_pos_discount(uuid, text, text) to authenticated;
