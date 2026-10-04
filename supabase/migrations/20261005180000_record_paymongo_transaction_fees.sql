-- Record exact PayMongo processing fees returned by checkout_session.payment.paid.
alter table public.orders
  add column if not exists paymongo_payment_id text,
  add column if not exists paymongo_checkout_session_id text,
  add column if not exists paymongo_payment_method text,
  add column if not exists paymongo_fee numeric(12,2),
  add column if not exists paymongo_net_amount numeric(12,2);

create unique index if not exists orders_paymongo_payment_id_key
  on public.orders (paymongo_payment_id)
  where paymongo_payment_id is not null;

drop function if exists public.get_restaurant_sales(uuid);

create or replace function public.get_restaurant_sales(p_restaurant_id uuid)
returns table (
  order_id uuid, order_number text, customer_name text, notes text,
  order_type text, payment_method text, payment_status text, pickup_method text,
  status text, total numeric, shipping_fee numeric,
  paymongo_payment_id text, paymongo_checkout_session_id text,
  paymongo_payment_method text, paymongo_fee numeric, paymongo_net_amount numeric,
  tax_vat_registered boolean, tax_prices_vat_inclusive boolean, tax_vat_rate numeric,
  tax_gross_sales numeric, tax_vatable_sales numeric, tax_vat_amount numeric,
  tax_vat_exempt_sales numeric, tax_net_sales numeric, discount_amount numeric,
  loyalty_discount_amount numeric, discount_beneficiary_count integer,
  discount_group_size integer, discount_beneficiaries jsonb,
  created_at timestamptz, items jsonb
)
language sql security definer set search_path = public
as $$
  select
    o.id, o.order_number, o.customer_name, o.notes, o.order_type,
    o.payment_method, o.payment_status, o.pickup_method, o.status, o.total,
    o.delivery_fee, o.paymongo_payment_id, o.paymongo_checkout_session_id,
    o.paymongo_payment_method, o.paymongo_fee, o.paymongo_net_amount,
    o.tax_vat_registered, o.tax_prices_vat_inclusive, o.tax_vat_rate,
    o.tax_gross_sales, o.tax_vatable_sales, o.tax_vat_amount,
    o.tax_vat_exempt_sales, o.tax_net_sales, o.discount_amount,
    coalesce((
      select sum(abs(lt.eligible_amount))
      from public.loyalty_transactions lt
      where lt.order_id = o.id and lt.transaction_type = 'redeem'
    ), 0),
    o.discount_beneficiary_count, o.discount_group_size,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'discountType', b.discount_type, 'idType', b.discount_id_type,
        'idNumber', b.discount_id_number, 'eligibleAmount', b.eligible_amount,
        'discountAmount', b.discount_amount
      ) order by b.created_at, b.id)
      from public.order_discount_beneficiaries b
      where b.order_id = o.id
    ), '[]'::jsonb),
    o.created_at,
    coalesce(jsonb_agg(jsonb_build_object(
      'id', oi.id, 'productName', oi.product_name, 'quantity', oi.quantity,
      'unitPrice', oi.unit_price, 'lineTotal', oi.line_total
    ) order by oi.created_at, oi.id) filter (where oi.id is not null), '[]'::jsonb)
  from public.orders o
  left join public.order_items oi on oi.order_id = o.id
  where o.restaurant_id = p_restaurant_id
    and exists (
      select 1 from public.restaurants r
      where r.id = o.restaurant_id and r.is_active = true and r.owner_id = auth.uid()
    )
  group by
    o.id, o.order_number, o.customer_name, o.notes, o.order_type,
    o.payment_method, o.payment_status, o.pickup_method, o.status, o.total,
    o.delivery_fee, o.paymongo_payment_id, o.paymongo_checkout_session_id,
    o.paymongo_payment_method, o.paymongo_fee, o.paymongo_net_amount,
    o.tax_vat_registered, o.tax_prices_vat_inclusive, o.tax_vat_rate,
    o.tax_gross_sales, o.tax_vatable_sales, o.tax_vat_amount,
    o.tax_vat_exempt_sales, o.tax_net_sales, o.discount_amount,
    o.discount_beneficiary_count, o.discount_group_size, o.created_at
  order by o.created_at desc;
$$;

revoke all on function public.get_restaurant_sales(uuid) from public;
grant execute on function public.get_restaurant_sales(uuid) to authenticated;

drop function if exists public.finalize_online_payment(text);

create or replace function public.finalize_online_payment(
  p_reference_number text,
  p_paymongo_payment_id text default null,
  p_paymongo_checkout_session_id text default null,
  p_paymongo_payment_method text default null,
  p_paymongo_fee numeric default null,
  p_paymongo_net_amount numeric default null
)
returns table (order_id uuid, order_number text, total numeric)
language plpgsql security definer set search_path = public
as $$
declare
  v_payment public.pending_online_payments%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_account public.customer_loyalty_accounts%rowtype;
begin
  select * into v_payment
  from public.pending_online_payments
  where reference_number = trim(p_reference_number)
  for update;

  if not found then raise exception 'Pending online payment not found'; end if;

  if v_payment.status = 'paid' and v_payment.order_id is not null then
    update public.orders
    set paymongo_payment_id = coalesce(paymongo_payment_id, nullif(trim(p_paymongo_payment_id), '')),
        paymongo_checkout_session_id = coalesce(paymongo_checkout_session_id, nullif(trim(p_paymongo_checkout_session_id), '')),
        paymongo_payment_method = coalesce(paymongo_payment_method, nullif(trim(p_paymongo_payment_method), '')),
        paymongo_fee = coalesce(paymongo_fee, p_paymongo_fee),
        paymongo_net_amount = coalesce(paymongo_net_amount, p_paymongo_net_amount),
        updated_at = now()
    where id = v_payment.order_id;

    select o.id, o.order_number, o.total into v_order_id, v_order_number, total
    from public.orders o where o.id = v_payment.order_id;
    return query select v_order_id, v_order_number, total;
    return;
  end if;

  if v_payment.status <> 'pending' then raise exception 'Online payment is not pending'; end if;

  if v_payment.loyalty_points_redeemed > 0 then
    select * into v_account from public.customer_loyalty_accounts
    where customer_id = v_payment.customer_id for update;
    if not found or v_account.points_balance < v_payment.loyalty_points_redeemed then
      raise exception 'Customer does not have enough loyalty points';
    end if;
  end if;

  v_order_number := public.next_restaurant_order_number(v_payment.restaurant_id);

  insert into public.orders (
    restaurant_id, order_number, customer_name, mobile_number, order_type,
    delivery_address, notes, payment_method, payment_status, status,
    subtotal, delivery_fee, discount_amount, total, customer_id,
    paymongo_payment_id, paymongo_checkout_session_id,
    paymongo_payment_method, paymongo_fee, paymongo_net_amount
  ) values (
    v_payment.restaurant_id, v_order_number, v_payment.customer_name,
    v_payment.mobile_number, v_payment.order_type, v_payment.delivery_address,
    v_payment.notes, 'gcash', 'paid', 'pending',
    v_payment.subtotal, v_payment.delivery_fee, v_payment.loyalty_discount_amount,
    v_payment.total, v_payment.customer_id,
    nullif(trim(p_paymongo_payment_id), ''),
    nullif(trim(p_paymongo_checkout_session_id), ''),
    nullif(trim(p_paymongo_payment_method), ''),
    p_paymongo_fee, p_paymongo_net_amount
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_payment.items)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, unit_price, quantity, line_total
    ) values (
      v_order_id, nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name', (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::integer, (v_item->>'line_total')::numeric
    );
  end loop;

  if v_payment.loyalty_points_redeemed > 0 then
    update public.customer_loyalty_accounts
    set points_balance = points_balance - v_payment.loyalty_points_redeemed, updated_at = now()
    where customer_id = v_payment.customer_id;

    insert into public.loyalty_transactions (
      restaurant_id, customer_id, order_id, transaction_type, points,
      eligible_amount, rule_amount_threshold, rule_points_awarded, description
    ) values (
      v_payment.restaurant_id, v_payment.customer_id, v_order_id, 'redeem',
      -v_payment.loyalty_points_redeemed, v_payment.loyalty_discount_amount,
      v_payment.loyalty_points_redeemed, v_payment.loyalty_discount_amount::integer,
      'Redeemed loyalty reward on order ' || v_order_number
    );
  end if;

  update public.pending_online_payments
  set status = 'paid', order_id = v_order_id, updated_at = now()
  where id = v_payment.id;

  return query select v_order_id, v_order_number, v_payment.total;
end;
$$;

revoke execute on function public.finalize_online_payment(text, text, text, text, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.finalize_online_payment(text, text, text, text, numeric, numeric)
  to service_role;
