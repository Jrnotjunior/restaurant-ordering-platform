-- Customer-safe item and billing details for the existing order tracking view.
-- Keep the order-number lookup behavior unchanged while returning only display-safe fields.

drop function if exists public.get_order_status(text);

create function public.get_order_status(p_order_number text)
returns table (
  order_id uuid,
  order_number text,
  restaurant_id uuid,
  restaurant_name text,
  store_address text,
  operating_hours jsonb,
  order_type text,
  pickup_method text,
  payment_method text,
  status text,
  payment_status text,
  total numeric,
  delivery_status text,
  rider_name text,
  rider_phone text,
  delivery_failure_reason text,
  subtotal numeric,
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
  loyalty_discount_amount numeric,
  items jsonb
)
language sql
security definer
set search_path = public
as $function$
  select
    o.id,
    o.order_number,
    o.restaurant_id,
    r.name,
    coalesce(nullif(trim(r.store_address), ''), nullif(trim(r.location_text), '')),
    r.operating_hours,
    o.order_type,
    o.pickup_method,
    o.payment_method,
    o.status,
    o.payment_status,
    o.total,
    o.delivery_status,
    rr.name,
    rr.mobile_number,
    o.delivery_failure_reason,
    o.subtotal,
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
    coalesce((
      select sum(abs(lt.eligible_amount))
      from public.loyalty_transactions lt
      where lt.order_id = o.id and lt.transaction_type = 'redeem'
    ), 0),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', oi.id,
        'productName', oi.product_name,
        'quantity', oi.quantity,
        'unitPrice', oi.unit_price,
        'lineTotal', oi.line_total
      ) order by oi.created_at, oi.id)
      from public.order_items oi
      where oi.order_id = o.id
    ), '[]'::jsonb)
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  left join public.restaurant_riders rr on rr.id = o.rider_id
  where o.order_number = p_order_number
  limit 1;
$function$;

revoke all on function public.get_order_status(text) from public;
grant execute on function public.get_order_status(text) to anon, authenticated;
