-- Prevent customer loyalty and order-history RPCs from serving a tenant
-- when the authenticated identity has duplicate customer profiles across tenants.
-- The single-tenant predicate is enforced in the database; request headers are
-- not used as authorization.
create or replace function public.get_my_loyalty_points(
  p_restaurant_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_points bigint;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id is null
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer account does not belong to this restaurant';
  end if;

  select coalesce(cla.points_balance, 0)
    into v_points
  from public.customer_profiles cp
  left join public.customer_loyalty_accounts cla
    on cla.customer_id = cp.id
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid();

  return coalesce(v_points, 0);
end;
$$;

revoke all on function public.get_my_loyalty_points(uuid) from public, anon;
grant execute on function public.get_my_loyalty_points(uuid) to authenticated;


create or replace function public.get_my_order_history(
  p_restaurant_id uuid
)
returns table (
  order_id uuid,
  order_number text,
  order_type text,
  payment_method text,
  payment_status text,
  status text,
  delivery_status text,
  total numeric,
  created_at timestamptz,
  items jsonb
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id is null
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer account does not belong to this restaurant';
  end if;

  return query
  select
    o.id,
    o.order_number,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.status,
    o.delivery_status,
    o.total,
    o.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'productName', oi.product_name,
          'quantity', oi.quantity,
          'unitPrice', oi.unit_price,
          'lineTotal', oi.line_total
        )
        order by oi.created_at, oi.id
      ) filter (where oi.id is not null),
      '[]'::jsonb
    )
  from public.orders o
  left join public.order_items oi on oi.order_id = o.id
  where o.restaurant_id = p_restaurant_id
    and o.customer_id in (
      select cp.id
      from public.customer_profiles cp
      where cp.restaurant_id = p_restaurant_id
        and cp.auth_user_id = auth.uid()
    )
  group by
    o.id,
    o.order_number,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.status,
    o.delivery_status,
    o.total,
    o.created_at
  order by o.created_at desc;
end;
$$;

revoke all on function public.get_my_order_history(uuid) from public, anon;
grant execute on function public.get_my_order_history(uuid) to authenticated;
