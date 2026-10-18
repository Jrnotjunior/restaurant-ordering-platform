-- Carry eligible customer spending forward across orders so partial spend earns
-- points once the configured threshold is reached. The restaurant's current
-- loyalty rule remains the source of truth; balances are isolated per customer.

alter table public.customer_loyalty_accounts
  add column if not exists eligible_spend_remainder numeric(12,2) not null default 0;

alter table public.customer_loyalty_accounts
  drop constraint if exists customer_loyalty_accounts_remainder_check;

alter table public.customer_loyalty_accounts
  add constraint customer_loyalty_accounts_remainder_check
  check (eligible_spend_remainder >= 0);

create or replace function public.award_loyalty_points_on_order_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_eligible_amount numeric(12,2);
  v_accumulated_amount numeric(12,2);
  v_points integer;
  v_remainder numeric(12,2);
  v_rows_affected integer;
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

  -- Exclude delivery fees and use the finalized eligible sales amount.
  v_eligible_amount :=
    case
      when coalesce(new.tax_net_sales, 0) > 0
        then round(new.tax_net_sales, 2)
      else greatest(
        round(new.subtotal - coalesce(new.discount_amount, 0), 2),
        0
      )
    end;

  if v_eligible_amount <= 0 then
    return new;
  end if;

  insert into public.customer_loyalty_accounts (
    customer_id, points_balance, eligible_spend_remainder
  )
  values (new.customer_id, 0, 0)
  on conflict (customer_id) do nothing;

  -- Serialize simultaneous orders for this customer's loyalty balance.
  select eligible_spend_remainder
    into v_remainder
  from public.customer_loyalty_accounts
  where customer_id = new.customer_id
  for update;

  v_accumulated_amount := round(coalesce(v_remainder, 0) + v_eligible_amount, 2);
  v_points := floor(v_accumulated_amount / v_restaurant.loyalty_amount_threshold)::integer
              * v_restaurant.loyalty_points_awarded;
  v_remainder := round(mod(v_accumulated_amount, v_restaurant.loyalty_amount_threshold), 2);

  update public.customer_loyalty_accounts
  set eligible_spend_remainder = v_remainder,
      points_balance = points_balance + v_points,
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
      'Points earned from cumulative eligible spend including order ' || new.order_number
    )
    on conflict (order_id, transaction_type) do nothing;

    get diagnostics v_rows_affected = row_count;
    if v_rows_affected = 0 then
      -- Defensive rollback of this function's balance adjustment if an earn
      -- transaction already exists for this order.
      update public.customer_loyalty_accounts
      set points_balance = points_balance - v_points,
          updated_at = now()
      where customer_id = new.customer_id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.award_loyalty_points_on_order_completed() from public;

drop trigger if exists orders_award_loyalty_on_completed on public.orders;
create trigger orders_award_loyalty_on_completed
after update of status, customer_id on public.orders
for each row
when (new.status = 'completed' and new.customer_id is not null)
execute function public.award_loyalty_points_on_order_completed();
