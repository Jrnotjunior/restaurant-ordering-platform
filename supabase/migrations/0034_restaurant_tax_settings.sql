-- Restaurant tax settings and immutable POS tax/discount snapshots.
-- Tax settings are configured per restaurant. POS financials are calculated server-side
-- and stored on the order so later settings changes do not rewrite historical receipts.

alter table public.restaurants
  add column if not exists tax_vat_registered boolean not null default false,
  add column if not exists tax_prices_vat_inclusive boolean not null default false,
  add column if not exists tax_vat_rate numeric(5,2) not null default 12.00;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'restaurants_tax_vat_rate_check' and conrelid = 'public.restaurants'::regclass) then
    alter table public.restaurants
      add constraint restaurants_tax_vat_rate_check check (tax_vat_rate >= 0 and tax_vat_rate <= 100);
  end if;
end $$;

alter table public.orders
  add column if not exists tax_vat_registered boolean not null default false,
  add column if not exists tax_prices_vat_inclusive boolean not null default false,
  add column if not exists tax_vat_rate numeric(5,2) not null default 0,
  add column if not exists tax_gross_sales numeric(12,2) not null default 0,
  add column if not exists tax_vatable_sales numeric(12,2) not null default 0,
  add column if not exists tax_vat_amount numeric(12,2) not null default 0,
  add column if not exists tax_vat_exempt_sales numeric(12,2) not null default 0,
  add column if not exists tax_net_sales numeric(12,2) not null default 0;

drop function if exists public.get_restaurant_tax_settings(uuid);

create or replace function public.get_restaurant_tax_settings(p_restaurant_id uuid)
returns table (
  restaurant_id uuid,
  vat_registered boolean,
  prices_vat_inclusive boolean,
  vat_rate numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
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
    raise exception 'You are not authorized to view restaurant tax settings';
  end if;

  return query
  select
    r.id,
    r.tax_vat_registered,
    r.tax_prices_vat_inclusive,
    r.tax_vat_rate
  from public.restaurants r
  where r.id = p_restaurant_id;
end;
$$;

grant execute on function public.get_restaurant_tax_settings(uuid) to authenticated;

create or replace function public.apply_pos_group_discounts(
  p_order_id uuid,
  p_group_size integer,
  p_beneficiaries jsonb
)
returns table (
  order_id uuid,
  group_size integer,
  beneficiary_count integer,
  discount_amount numeric,
  gross_sales numeric,
  vatable_sales numeric,
  vat_amount numeric,
  vat_exempt_sales numeric,
  net_sales numeric,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_beneficiary jsonb;
  v_type text;
  v_id_type text;
  v_id_number text;
  v_base_net numeric(12,2);
  v_eligible_net_share numeric(12,2);
  v_discount numeric(12,2);
  v_total_discount numeric(12,2) := 0;
  v_vatable_sales numeric(12,2);
  v_vat_amount numeric(12,2);
  v_vat_exempt_sales numeric(12,2);
  v_net_sales numeric(12,2);
  v_total numeric(12,2);
  v_count integer;
begin
  if p_group_size is null or p_group_size < 1 then
    raise exception 'Group size must be at least 1';
  end if;

  if jsonb_typeof(p_beneficiaries) <> 'array' then
    raise exception 'Discount beneficiaries must be an array';
  end if;

  v_count := jsonb_array_length(p_beneficiaries);

  if v_count > p_group_size then
    raise exception 'Discount beneficiaries cannot exceed the group size';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  select * into v_restaurant
  from public.restaurants r
  where r.id = v_order.restaurant_id;

  if not found then
    raise exception 'Restaurant not found';
  end if;

  if not (
    v_restaurant.owner_id = auth.uid()
    or exists (
      select 1
      from public.restaurant_staff s
      where s.restaurant_id = v_order.restaurant_id
        and s.auth_user_id = auth.uid()
        and s.role = 'cashier'
        and s.is_active = true
    )
  ) then
    raise exception 'You are not authorized to finalize POS financials for this order';
  end if;

  if coalesce(v_order.discount_beneficiary_count, 0) > 0
     or coalesce(v_order.discount_amount, 0) > 0
     or v_order.discount_type is not null
     or coalesce(v_order.tax_net_sales, 0) > 0 then
    raise exception 'POS financials have already been finalized for this order';
  end if;

  if v_count > 0 then
    for v_beneficiary in select value from jsonb_array_elements(p_beneficiaries) loop
      v_type := lower(trim(coalesce(v_beneficiary->>'discount_type', '')));
      v_id_type := trim(coalesce(v_beneficiary->>'discount_id_type', ''));
      v_id_number := trim(coalesce(v_beneficiary->>'discount_id_number', ''));

      if v_type not in ('senior', 'pwd') then
        raise exception 'Invalid discount type';
      end if;

      if length(v_id_type) = 0 then
        raise exception 'ID type is required for every discount beneficiary';
      end if;

      if length(v_id_number) = 0 then
        raise exception 'ID number is required for every discount beneficiary';
      end if;

      if exists (
        select 1
        from public.order_discount_beneficiaries b
        where b.order_id = p_order_id
          and b.discount_id_number = v_id_number
      ) then
        raise exception 'The same ID number cannot be used twice on one order';
      end if;
    end loop;
  end if;

  -- Normalize the restaurant's configured prices into VAT-exclusive sales.
  v_base_net :=
    case
      when v_restaurant.tax_vat_registered and v_restaurant.tax_prices_vat_inclusive
        then round(v_order.subtotal / (1 + (v_restaurant.tax_vat_rate / 100)), 2)
      else round(v_order.subtotal, 2)
    end;

  v_eligible_net_share :=
    case
      when v_count > 0 then round(v_base_net / p_group_size, 2)
      else 0
    end;

  if v_count > 0 then
    for v_beneficiary in select value from jsonb_array_elements(p_beneficiaries) loop
      v_discount := round(v_eligible_net_share * 0.20, 2);
      v_total_discount := v_total_discount + v_discount;

      insert into public.order_discount_beneficiaries (
        order_id,
        discount_type,
        discount_id_type,
        discount_id_number,
        eligible_amount,
        discount_amount
      ) values (
        p_order_id,
        lower(trim(v_beneficiary->>'discount_type')),
        trim(v_beneficiary->>'discount_id_type'),
        trim(v_beneficiary->>'discount_id_number'),
        v_eligible_net_share,
        v_discount
      );
    end loop;
  end if;

  v_vatable_sales := greatest(
    round(v_base_net - (v_eligible_net_share * v_count), 2),
    0
  );

  v_vat_amount :=
    case
      when v_restaurant.tax_vat_registered
        then round(v_vatable_sales * (v_restaurant.tax_vat_rate / 100), 2)
      else 0
    end;

  v_vat_exempt_sales :=
    case
      when v_count > 0
        then greatest(round((v_eligible_net_share * v_count) - v_total_discount, 2), 0)
      else 0
    end;

  v_net_sales := round(v_vatable_sales + v_vat_exempt_sales, 2);
  v_total := greatest(round(v_net_sales + v_vat_amount + v_order.delivery_fee, 2), 0);

  update public.orders
  set
    tax_vat_registered = v_restaurant.tax_vat_registered,
    tax_prices_vat_inclusive = v_restaurant.tax_prices_vat_inclusive,
    tax_vat_rate = case when v_restaurant.tax_vat_registered then v_restaurant.tax_vat_rate else 0 end,
    tax_gross_sales = round(v_order.subtotal, 2),
    tax_vatable_sales = v_vatable_sales,
    tax_vat_amount = v_vat_amount,
    tax_vat_exempt_sales = v_vat_exempt_sales,
    tax_net_sales = v_net_sales,
    discount_type = case when v_count = 1 then lower(trim(p_beneficiaries->0->>'discount_type')) else null end,
    discount_id_number = case when v_count = 1 then trim(p_beneficiaries->0->>'discount_id_number') else null end,
    discount_amount = v_total_discount,
    discount_group_size = p_group_size,
    discount_beneficiary_count = v_count,
    total = v_total,
    updated_at = now()
  where id = p_order_id;

  return query
  select
    p_order_id,
    p_group_size,
    v_count,
    v_total_discount,
    round(v_order.subtotal, 2),
    v_vatable_sales,
    v_vat_amount,
    v_vat_exempt_sales,
    v_net_sales,
    v_total;
end;
$$;

grant execute on function public.apply_pos_group_discounts(uuid, integer, jsonb) to authenticated;
