-- Guard loyalty redemption against customer identities attached to multiple tenants.
-- The payment row determines the restaurant; caller-controlled tenant headers are not used.

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

  if not public.customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id) then
    raise exception 'Customer account does not belong to this restaurant';
  end if;
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

revoke all on function public.redeem_loyalty_reward_for_pending_payment(uuid) from public, anon;
grant execute on function public.redeem_loyalty_reward_for_pending_payment(uuid) to authenticated;
