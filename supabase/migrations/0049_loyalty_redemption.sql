-- Configurable one-reward loyalty redemption.
alter table public.restaurants
  add column if not exists loyalty_redemption_enabled boolean not null default true,
  add column if not exists loyalty_redemption_points integer not null default 50,
  add column if not exists loyalty_redemption_amount numeric(12,2) not null default 50.00;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_loyalty_redemption_points_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_loyalty_redemption_points_check
      check (loyalty_redemption_points > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_loyalty_redemption_amount_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_loyalty_redemption_amount_check
      check (loyalty_redemption_amount > 0);
  end if;
end $$;

alter table public.loyalty_transactions
  drop constraint if exists loyalty_transactions_type_check;

alter table public.loyalty_transactions
  add constraint loyalty_transactions_type_check
  check (transaction_type in ('earn', 'reversal', 'redeem'));

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
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  select * into v_restaurant
  from public.restaurants
  where id = v_order.restaurant_id;

  if not found or not v_restaurant.loyalty_redemption_enabled then
    raise exception 'Loyalty redemption is disabled';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = v_order.restaurant_id
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1
          from public.restaurant_staff s
          where s.restaurant_id = r.id
            and s.auth_user_id = auth.uid()
            and s.role = 'cashier'
            and s.is_active = true
        )
      )
  ) then
    raise exception 'You are not authorized to redeem loyalty points for this order';
  end if;

  if v_order.customer_id is distinct from p_customer_id then
    raise exception 'This order is not linked to the selected customer';
  end if;

  if exists (
    select 1
    from public.loyalty_transactions
    where order_id = p_order_id
      and transaction_type = 'redeem'
  ) then
    raise exception 'Loyalty points have already been redeemed for this order';
  end if;

  if v_order.status = 'completed' or v_order.status = 'cancelled' then
    raise exception 'This order can no longer be changed';
  end if;

  select * into v_account
  from public.customer_loyalty_accounts
  where customer_id = p_customer_id
  for update;

  if not found then
    raise exception 'Customer loyalty account not found';
  end if;

  if v_account.points_balance < v_restaurant.loyalty_redemption_points then
    raise exception 'Customer does not have enough loyalty points';
  end if;

  v_discount := least(
    round(v_restaurant.loyalty_redemption_amount, 2),
    greatest(round(v_order.total, 2), 0)
  );

  if v_discount <= 0 then
    raise exception 'This order has no amount available for redemption';
  end if;

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
    restaurant_id,
    customer_id,
    order_id,
    transaction_type,
    points,
    eligible_amount,
    rule_amount_threshold,
    rule_points_awarded,
    description
  )
  values (
    v_order.restaurant_id,
    p_customer_id,
    p_order_id,
    'redeem',
    -v_restaurant.loyalty_redemption_points,
    v_discount,
    v_restaurant.loyalty_redemption_points,
    v_restaurant.loyalty_redemption_amount::integer,
    'Redeemed loyalty reward on order ' || v_order.order_number
  );

  return query
  select
    p_order_id,
    p_customer_id,
    v_restaurant.loyalty_redemption_points,
    v_discount,
    v_account.points_balance - v_restaurant.loyalty_redemption_points;
end;
$$;

revoke all on function public.redeem_loyalty_reward(uuid, uuid) from public;
grant execute on function public.redeem_loyalty_reward(uuid, uuid) to authenticated;
