-- Restaurant order retrieval
-- Returns restaurant orders together with their persisted order items.
-- The restaurant owner is authorized through the authenticated Supabase user.

drop function if exists public.get_restaurant_orders(uuid);

create or replace function public.get_restaurant_orders(
  p_restaurant_id uuid
)
returns table (
  order_id uuid,
  order_number text,
  order_type text,
  payment_method text,
  payment_status text,
  status text,
  total numeric,
  shipping_fee numeric,
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
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.status,
    o.total,
    o.delivery_fee as shipping_fee,
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
        and r.owner_id = auth.uid()
        and r.is_active = true
    )
  group by
    o.id,
    o.order_number,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.status,
    o.total,
    o.delivery_fee,
    o.created_at
  order by o.created_at desc;
$$;

revoke all on function public.get_restaurant_orders(uuid) from public;
grant execute on function public.get_restaurant_orders(uuid) to authenticated;
