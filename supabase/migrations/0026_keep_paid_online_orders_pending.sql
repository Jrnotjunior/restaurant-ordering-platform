-- Keep confirmed online payments in New Orders until restaurant staff prints the receipt.
-- The restaurant dashboard is responsible for moving the order to the kitchen.

create or replace function public.finalize_online_payment(
  p_reference_number text
)
returns table (
  order_id uuid,
  order_number text,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.pending_online_payments%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
begin
  select *
    into v_payment
  from public.pending_online_payments
  where reference_number = trim(p_reference_number)
  for update;

  if not found then
    raise exception 'Pending online payment not found';
  end if;

  if v_payment.status = 'paid' and v_payment.order_id is not null then
    select o.id, o.order_number, o.total
      into v_order_id, v_order_number, total
    from public.orders o
    where o.id = v_payment.order_id;

    return query select v_order_id, v_order_number, total;
    return;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'Online payment is not pending';
  end if;

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    restaurant_id,
    order_number,
    customer_name,
    mobile_number,
    order_type,
    table_number,
    delivery_address,
    notes,
    payment_method,
    payment_status,
    status,
    subtotal,
    delivery_fee,
    total
  ) values (
    v_payment.restaurant_id,
    v_order_number,
    v_payment.customer_name,
    v_payment.mobile_number,
    v_payment.order_type,
    null,
    v_payment.delivery_address,
    v_payment.notes,
    'gcash',
    'paid',
    'pending',
    v_payment.subtotal,
    v_payment.delivery_fee,
    v_payment.total
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_payment.items)
  loop
    insert into public.order_items (
      order_id,
      product_id,
      product_name,
      unit_price,
      quantity,
      line_total
    ) values (
      v_order_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::integer,
      (v_item->>'line_total')::numeric
    );
  end loop;

  update public.pending_online_payments
  set status = 'paid',
      order_id = v_order_id,
      updated_at = now()
  where id = v_payment.id;

  return query select v_order_id, v_order_number, v_payment.total;
end;
$$;

revoke execute on function public.finalize_online_payment(text) from public, anon, authenticated;
grant execute on function public.finalize_online_payment(text) to service_role;
