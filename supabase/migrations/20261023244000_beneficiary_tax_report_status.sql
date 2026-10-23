-- Include complete SC/PWD beneficiary details in owner sales reports and readiness status.
create or replace function public.get_restaurant_sales(p_restaurant_id uuid)
returns table (
  order_id uuid,
  order_number text,
  customer_name text,
  notes text,
  order_type text,
  payment_method text,
  payment_status text,
  pickup_method text,
  status text,
  total numeric,
  shipping_fee numeric,
  paymongo_payment_id text,
  paymongo_checkout_session_id text,
  paymongo_payment_method text,
  paymongo_fee numeric,
  paymongo_net_amount numeric,
  tax_vat_registered boolean,
  tax_prices_vat_inclusive boolean,
  tax_vat_rate numeric,
  tax_gross_sales numeric,
  tax_vatable_sales numeric,
  tax_vat_amount numeric,
  tax_vat_exempt_sales numeric,
  tax_net_sales numeric,
  discount_amount numeric,
  loyalty_discount_amount numeric,
  discount_beneficiary_count integer,
  discount_group_size integer,
  discount_beneficiaries jsonb,
  created_at timestamptz,
  items jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    o.id as order_id,
    o.order_number,
    o.customer_name,
    o.notes,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.pickup_method,
    o.status,
    o.total,
    o.delivery_fee as shipping_fee,
    o.paymongo_payment_id,
    o.paymongo_checkout_session_id,
    o.paymongo_payment_method,
    o.paymongo_fee,
    o.paymongo_net_amount,
    o.tax_vat_registered,
    o.tax_prices_vat_inclusive,
    o.tax_vat_rate,
    o.tax_gross_sales,
    o.tax_vatable_sales,
    o.tax_vat_amount,
    o.tax_vat_exempt_sales,
    o.tax_net_sales,
    o.discount_amount,
    coalesce((
      select sum(abs(lt.eligible_amount))
      from public.loyalty_transactions lt
      where lt.order_id = o.id
        and lt.transaction_type = 'redeem'
    ), 0) as loyalty_discount_amount,
    o.discount_beneficiary_count,
    o.discount_group_size,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'discountType', b.discount_type,
          'idType', b.discount_id_type,
          'idNumber', b.discount_id_number,
          'beneficiaryName', b.beneficiary_name,
          'beneficiaryTin', b.beneficiary_tin,
          'beneficiaryAddress', b.beneficiary_address,
          'eligibleAmount', b.eligible_amount,
          'discountAmount', b.discount_amount
        )
        order by b.created_at, b.id
      )
      from public.order_discount_beneficiaries b
      where b.order_id = o.id
    ), '[]'::jsonb) as discount_beneficiaries,
    o.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'productName', oi.product_name,
          'quantity', oi.quantity,
          'unitPrice', oi.unit_price,
          'lineTotal', oi.line_total,
          'taxCategory', oi.tax_category_snapshot
        )
        order by oi.created_at, oi.id
      ) filter (where oi.id is not null),
      '[]'::jsonb
    ) as items
  from public.orders o
  left join public.order_items oi on oi.order_id = o.id
  where o.restaurant_id = p_restaurant_id
    and exists (
      select 1
      from public.restaurants r
      where r.id = o.restaurant_id
        and r.is_active = true
        and r.owner_id = auth.uid()
    )
  group by
    o.id, o.order_number, o.customer_name, o.notes, o.order_type,
    o.payment_method, o.payment_status, o.pickup_method, o.status,
    o.total, o.delivery_fee, o.paymongo_payment_id,
    o.paymongo_checkout_session_id, o.paymongo_payment_method,
    o.paymongo_fee, o.paymongo_net_amount,
    o.tax_vat_registered, o.tax_prices_vat_inclusive, o.tax_vat_rate,
    o.tax_gross_sales, o.tax_vatable_sales, o.tax_vat_amount,
    o.tax_vat_exempt_sales, o.tax_net_sales, o.discount_amount,
    o.discount_beneficiary_count, o.discount_group_size, o.created_at
  order by o.created_at desc;
$$;
revoke all on function public.get_restaurant_sales(uuid) from public, anon;
grant execute on function public.get_restaurant_sales(uuid) to authenticated;

drop function if exists public.get_restaurant_tax_snapshot_statuses(uuid);
create function public.get_restaurant_tax_snapshot_statuses(p_restaurant_id uuid)
returns table(
  order_id uuid,
  tax_snapshot_status text,
  tax_snapshot_version smallint,
  tax_zero_rated_sales numeric,
  items_tax_classified boolean,
  discount_beneficiaries_complete boolean
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not (
    public.is_system_admin()
    or exists (
      select 1 from public.restaurants r
      where r.id = p_restaurant_id and r.owner_id = auth.uid()
    )
  ) then
    raise exception 'You are not authorized to view this restaurant tax status.';
  end if;

  return query
  select
    o.id,
    o.tax_snapshot_status,
    o.tax_snapshot_version,
    o.tax_zero_rated_sales,
    (
      exists (select 1 from public.order_items oi where oi.order_id = o.id)
      and not exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id
          and oi.tax_category_snapshot is null
      )
    ) as items_tax_classified,
    (
      o.discount_beneficiary_count = 0
      or (
        exists (select 1 from public.order_discount_beneficiaries b where b.order_id = o.id)
        and not exists (
          select 1 from public.order_discount_beneficiaries b
          where b.order_id = o.id
            and (
              nullif(trim(b.beneficiary_name), '') is null
              or nullif(trim(b.beneficiary_address), '') is null
            )
        )
      )
    ) as discount_beneficiaries_complete
  from public.orders o
  where o.restaurant_id = p_restaurant_id;
end;
$$;
revoke all on function public.get_restaurant_tax_snapshot_statuses(uuid) from public, anon;
grant execute on function public.get_restaurant_tax_snapshot_statuses(uuid) to authenticated;
