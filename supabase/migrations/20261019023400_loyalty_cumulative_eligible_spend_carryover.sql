-- Carry forward eligible spend across completed orders so customers earn points
-- cumulatively, using each restaurant's current configured earning rule.

alter table public.customer_loyalty_accounts
  add column if not exists eligible_spend_balance numeric(12,2) not null default 0;

alter table public.customer_loyalty_accounts
  drop constraint if exists customer_loyalty_accounts_eligible_spend_balance_check;

alter table public.customer_loyalty_accounts
  add constraint customer_loyalty_accounts_eligible_spend_balance_check
  check (eligible_spend_balance >= 0);

create or replace function public.award_loyalty_points_on_order_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_eligible_amount numeric(12,2);
  v_previous_balance numeric(12,2);
  v_accumulated_amount numeric(12,2);
  v_points integer;
begin
  if old.status = 'completed' or new.status <> 'completed' or new.customer_id is null then
    return new;
  end if;

  select * into v_restaurant
  from public.restaurants
  where id = new.restaurant_id;

  if not found or not v_restaurant.loyalty_enabled then
    return new;
  end if;

  if v_restaurant.loyalty_amount_threshold <= 0
     or v_restaurant.loyalty_points_awarded <= 0 then
    return new;
  end if;

  v_eligible_amount :=
    case
      when coalesce(new.tax_net_sales, 0) > 0
        then round(new.tax_net_sales, 2)
      else greatest(
        round(new.subtotal - coalesce(new.discount_amount, 0), 2),
        0
      )
    end;

  insert into public.customer_loyalty_accounts (customer_id, points_balance, eligible_spend_balance)
  values (new.customer_id, 0, 0)
  on conflict (customer_id) do nothing;

  select eligible_spend_balance
    into v_previous_balance
  from public.customer_loyalty_accounts
  where customer_id = new.customer_id
  for update;

  v_accumulated_amount := round(v_previous_balance + v_eligible_amount, 2);

  v_points := floor(
    v_accumulated_amount / v_restaurant.loyalty_amount_threshold
  )::integer * v_restaurant.loyalty_points_awarded;

  update public.customer_loyalty_accounts
  set eligible_spend_balance = round(
        v_accumulated_amount
        - floor(v_accumulated_amount / v_restaurant.loyalty_amount_threshold)
          * v_restaurant.loyalty_amount_threshold,
        2
      ),
      points_balance = points_balance + greatest(v_points, 0),
      updated_at = now()
  where customer_id = new.customer_id;

  if v_points > 0 then
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
      new.restaurant_id,
      new.customer_id,
      new.id,
      'earn',
      v_points,
      v_eligible_amount,
      v_restaurant.loyalty_amount_threshold,
      v_restaurant.loyalty_points_awarded,
      'Points earned from completed order ' || new.order_number
    )
    on conflict (order_id, transaction_type) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists orders_award_loyalty_on_completed on public.orders;
drop trigger if exists orders_award_loyalty_points on public.orders;

create trigger orders_award_loyalty_points
after update of status on public.orders
for each row
when (new.status = 'completed')
execute function public.award_loyalty_points_on_order_completed();

revoke all on function public.award_loyalty_points_on_order_completed() from public;
