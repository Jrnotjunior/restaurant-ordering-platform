-- Self-order loyalty redemption before PayMongo checkout.
alter table public.pending_online_payments
  add column if not exists loyalty_discount_amount numeric(12,2) not null default 0,
  add column if not exists loyalty_points_redeemed integer not null default 0;

create or replace function public.redeem_loyalty_reward_for_pending_payment(
  p_payment_id uuid
)
returns table (
  payment_id uuid,
  customer_id uuid,
  points_redeemed integer,
  discount_amount numeric(12,2),
  total numeric(12,2)
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.pending_online_payments%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_customer public.customer_profiles%rowtype;
  v_account public.customer_loyalty_accounts%rowtype;
  v_discount numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select * into v_payment
  from public.pending_online_payments
  where id = p_payment_id
  for update;

  if not found then raise exception 'Pending online payment not found'; end if;
  if v_payment.status <> 'pending' then raise exception 'Online payment is no longer pending'; end if;

  select * into v_restaurant
  from public.restaurants
  where id = v_payment.restaurant_id and is_active = true;

  if not found or not v_restaurant.loyalty_redemption_enabled then
    raise exception 'Loyalty redemption is disabled';
  end if;

  select * into v_customer
  from public.customer_profiles
  where restaurant_id = v_payment.restaurant_id
    and auth_user_id = auth.uid()
  limit 1;

  if not found then raise exception 'Customer account not found for this restaurant'; end if;

  if v_payment.loyalty_points_redeemed > 0 then
    if v_payment.customer_id is distinct from v_customer.id then
      raise exception 'A different customer is already attached to this payment';
    end if;
    return query select v_payment.id, v_payment.customer_id,
      v_payment.loyalty_points_redeemed, v_payment.loyalty_discount_amount, v_payment.total;
    return;
  end if;

  select * into v_account
  from public.customer_loyalty_accounts
  where customer_id = v_customer.id
  for update;

  if not found then raise exception 'Customer loyalty account not found'; end if;
  if v_account.points_balance < v_restaurant.loyalty_redemption_points then
    raise exception 'Customer does not have enough loyalty points';
  end if;

  v_discount := least(
    round(v_restaurant.loyalty_redemption_amount, 2),
    greatest(round(v_payment.subtotal, 2), 0)
  );

  if v_discount <= 0 then raise exception 'This order has no amount available for redemption'; end if;

  update public.pending_online_payments
  set customer_id = v_customer.id,
      loyalty_points_redeemed = v_restaurant.loyalty_redemption_points,
      loyalty_discount_amount = v_discount,
      total = greatest(round(total - v_discount, 2), 0),
      updated_at = now()
  where id = v_payment.id;

  return query select v_payment.id, v_customer.id,
    v_restaurant.loyalty_redemption_points, v_discount,
    greatest(round(v_payment.total - v_discount, 2), 0);
end;
$$;

revoke all on function public.redeem_loyalty_reward_for_pending_payment(uuid) from public;
grant execute on function public.redeem_loyalty_reward_for_pending_payment(uuid) to authenticated;

-- Carry the pending customer/discount into the final paid order and record the redemption.
create or replace function public.finalize_online_payment(
  p_reference_number text
)
returns table (order_id uuid, order_number text, total numeric)
language plpgsql
security definer
set search_path = public
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
    select o.id, o.order_number, o.total
      into v_order_id, v_order_number, total
    from public.orders o where o.id = v_payment.order_id;
    return query select v_order_id, v_order_number, total;
    return;
  end if;

  if v_payment.status <> 'pending' then raise exception 'Online payment is not pending'; end if;

  if v_payment.loyalty_points_redeemed > 0 then
    select * into v_account
    from public.customer_loyalty_accounts
    where customer_id = v_payment.customer_id
    for update;

    if not found or v_account.points_balance < v_payment.loyalty_points_redeemed then
      raise exception 'Customer does not have enough loyalty points';
    end if;
  end if;

  v_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.orders (
    restaurant_id, order_number, customer_name, mobile_number, order_type,
    table_number, delivery_address, notes, payment_method, payment_status,
    status, subtotal, delivery_fee, discount_amount, total, customer_id
  ) values (
    v_payment.restaurant_id, v_order_number, v_payment.customer_name,
    v_payment.mobile_number, v_payment.order_type, null,
    v_payment.delivery_address, v_payment.notes, 'gcash', 'paid', 'pending',
    v_payment.subtotal, v_payment.delivery_fee, v_payment.loyalty_discount_amount,
    v_payment.total, v_payment.customer_id
  )
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(v_payment.items)
  loop
    insert into public.order_items (
      order_id, product_id, product_name, unit_price, quantity, line_total
    ) values (
      v_order_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::integer,
      (v_item->>'line_total')::numeric
    );
  end loop;

  if v_payment.loyalty_points_redeemed > 0 then
    update public.customer_loyalty_accounts
    set points_balance = points_balance - v_payment.loyalty_points_redeemed,
        updated_at = now()
    where customer_id = v_payment.customer_id;

    insert into public.loyalty_transactions (
      restaurant_id, customer_id, order_id, transaction_type, points,
      eligible_amount, rule_amount_threshold, rule_points_awarded, description
    ) values (
      v_payment.restaurant_id, v_payment.customer_id, v_order_id, 'redeem',
      -v_payment.loyalty_points_redeemed, v_payment.loyalty_discount_amount,
      v_payment.loyalty_points_redeemed,
      v_payment.loyalty_discount_amount::integer,
      'Redeemed loyalty reward on order ' || v_order_number
    );
  end if;

  update public.pending_online_payments
  set status = 'paid', order_id = v_order_id, updated_at = now()
  where id = v_payment.id;

  return query select v_order_id, v_order_number, v_payment.total;
end;
$$;

revoke execute on function public.finalize_online_payment(text) from public, anon, authenticated;
grant execute on function public.finalize_online_payment(text) to service_role;


create or replace function public.get_my_customer_profile_id(
  p_restaurant_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select id into v_customer_id
  from public.customer_profiles
  where restaurant_id = p_restaurant_id
    and auth_user_id = auth.uid()
  limit 1;

  return v_customer_id;
end;
$$;

revoke all on function public.get_my_customer_profile_id(uuid) from public;
grant execute on function public.get_my_customer_profile_id(uuid) to authenticated;

-- Signed-in customers may redeem their own loyalty points on self-orders.
create or replace function public.redeem_loyalty_reward(
  p_order_id uuid,
  p_customer_id uuid
)
returns table (
  order_id uuid,
  customer_id uuid,
  points_redeemed integer,
  discount_amount numeric(12,2),
  remaining_points bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_account public.customer_loyalty_accounts%rowtype;
  v_discount numeric(12,2);
  v_staff_authorized boolean := false;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;

  select * into v_restaurant
  from public.restaurants
  where id = v_order.restaurant_id;
  if not found or not v_restaurant.loyalty_redemption_enabled then
    raise exception 'Loyalty redemption is disabled';
  end if;

  v_staff_authorized := exists (
    select 1 from public.restaurants r
    where r.id = v_order.restaurant_id
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1 from public.restaurant_staff s
          where s.restaurant_id = r.id
            and s.auth_user_id = auth.uid()
            and s.role = 'cashier'
            and s.is_active = true
        )
      )
  );

  if not v_staff_authorized and not exists (
    select 1 from public.customer_profiles cp
    where cp.id = p_customer_id
      and cp.restaurant_id = v_order.restaurant_id
      and cp.auth_user_id = auth.uid()
  ) then
    raise exception 'You are not authorized to redeem loyalty points for this order';
  end if;

  if v_order.customer_id is distinct from p_customer_id then
    raise exception 'This order is not linked to the selected customer';
  end if;

  if exists (
    select 1 from public.loyalty_transactions
    where order_id = p_order_id and transaction_type = 'redeem'
  ) then
    raise exception 'Loyalty points have already been redeemed for this order';
  end if;

  if v_order.status in ('completed', 'cancelled') then
    raise exception 'This order can no longer be changed';
  end if;

  select * into v_account
  from public.customer_loyalty_accounts
  where customer_id = p_customer_id
  for update;

  if not found then raise exception 'Customer loyalty account not found'; end if;
  if v_account.points_balance < v_restaurant.loyalty_redemption_points then
    raise exception 'Customer does not have enough loyalty points';
  end if;

  v_discount := least(
    round(v_restaurant.loyalty_redemption_amount, 2),
    greatest(round(v_order.subtotal, 2), 0)
  );
  if v_discount <= 0 then raise exception 'This order has no amount available for redemption'; end if;

  update public.orders
  set discount_amount = coalesce(discount_amount, 0) + v_discount,
      total = greatest(round(total - v_discount, 2), 0),
      updated_at = now()
  where id = p_order_id;

  update public.customer_loyalty_accounts
  set points_balance = points_balance - v_restaurant.loyalty_redemption_points,
      updated_at = now()
  where customer_id = p_customer_id;

  insert into public.loyalty_transactions (
    restaurant_id, customer_id, order_id, transaction_type, points,
    eligible_amount, rule_amount_threshold, rule_points_awarded, description
  ) values (
    v_order.restaurant_id, p_customer_id, p_order_id, 'redeem',
    -v_restaurant.loyalty_redemption_points, v_discount,
    v_restaurant.loyalty_redemption_points,
    v_restaurant.loyalty_redemption_amount::integer,
    'Redeemed loyalty reward on order ' || v_order.order_number
  );

  return query select
    p_order_id, p_customer_id,
    v_restaurant.loyalty_redemption_points, v_discount,
    v_account.points_balance - v_restaurant.loyalty_redemption_points;
end;
$$;

revoke all on function public.redeem_loyalty_reward(uuid, uuid) from public;
grant execute on function public.redeem_loyalty_reward(uuid, uuid) to authenticated;
