-- Extend restaurant order retrieval for tax/discount receipt data and staff access.

drop function if exists public.get_restaurant_orders(uuid);

create or replace function public.get_restaurant_orders(
  p_restaurant_id uuid
)
returns table (
  order_id uuid,
  order_number text,
  customer_name text,
  order_type text,
  payment_method text,
  payment_status text,
  pickup_method text,
  status text,
  total numeric,
  shipping_fee numeric,
  tax_vat_registered boolean,
  tax_prices_vat_inclusive boolean,
  tax_vat_rate numeric,
  tax_gross_sales numeric,
  tax_vatable_sales numeric,
  tax_vat_amount numeric,
  tax_vat_exempt_sales numeric,
  tax_net_sales numeric,
  discount_amount numeric,
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
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.pickup_method,
    o.status,
    o.total,
    o.delivery_fee as shipping_fee,
    o.tax_vat_registered,
    o.tax_prices_vat_inclusive,
    o.tax_vat_rate,
    o.tax_gross_sales,
    o.tax_vatable_sales,
    o.tax_vat_amount,
    o.tax_vat_exempt_sales,
    o.tax_net_sales,
    o.discount_amount,
    o.discount_beneficiary_count,
    o.discount_group_size,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'discountType', b.discount_type,
            'idType', b.discount_id_type,
            'idNumber', b.discount_id_number,
            'eligibleAmount', b.eligible_amount,
            'discountAmount', b.discount_amount
          )
          order by b.created_at, b.id
        )
        from public.order_discount_beneficiaries b
        where b.order_id = o.id
      ),
      '[]'::jsonb
    ) as discount_beneficiaries,
    o.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'productName', oi.product_name,
          'quantity', oi.quantity,
          'unitPrice', oi.unit_price,
          'lineTotal', oi.line_total
        )
        order by oi.created_at, oi.id
      ) filter (where oi.id is not null),
      '[]'::jsonb
    ) as items
  from public.orders o
  left join public.order_items oi
    on oi.order_id = o.id
  where o.restaurant_id = p_restaurant_id
    and exists (
      select 1
      from public.restaurants r
      where r.id = o.restaurant_id
        and r.is_active = true
        and (
          r.owner_id = auth.uid()
          or exists (
            select 1
            from public.restaurant_staff s
            where s.restaurant_id = r.id
              and s.auth_user_id = auth.uid()
              and s.role in ('cashier','kitchen','dispatcher')
              and s.is_active = true
          )
        )
    )
  group by
    o.id,
    o.order_number,
    o.customer_name,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.pickup_method,
    o.status,
    o.total,
    o.delivery_fee,
    o.tax_vat_registered,
    o.tax_prices_vat_inclusive,
    o.tax_vat_rate,
    o.tax_gross_sales,
    o.tax_vatable_sales,
    o.tax_vat_amount,
    o.tax_vat_exempt_sales,
    o.tax_net_sales,
    o.discount_amount,
    o.discount_beneficiary_count,
    o.discount_group_size,
    o.created_at
  order by o.created_at desc;
$$;

revoke all on function public.get_restaurant_orders(uuid) from public;
grant execute on function public.get_restaurant_orders(uuid) to authenticated;
