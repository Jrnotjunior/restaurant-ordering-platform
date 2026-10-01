-- Customer tracking status and rider details.
-- Extends get_order_status with delivery state and assigned rider contact information.

create or replace function public.get_order_status(p_order_number text)
returns table (
  order_id uuid,
  order_number text,
  order_type text,
  payment_method text,
  status text,
  payment_status text,
  total numeric,
  delivery_status text,
  rider_name text,
  rider_phone text,
  delivery_failure_reason text
)
language sql
security definer
set search_path = public
as $function$
  select
    o.id,
    o.order_number,
    o.order_type,
    o.payment_method,
    o.status,
    o.payment_status,
    o.total,
    o.delivery_status,
    rr.name,
    rr.mobile_number,
    o.delivery_failure_reason
  from public.orders o
  left join public.restaurant_riders rr
    on rr.id = o.rider_id
  where o.order_number = p_order_number
  limit 1;
$function$;

revoke all on function public.get_order_status(text) from public;
grant execute on function public.get_order_status(text) to anon, authenticated;
