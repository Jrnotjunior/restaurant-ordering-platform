-- Harden customer profile writes and make loyalty awarding idempotent.

revoke insert, update on table public.customer_profiles from authenticated;

create or replace function public.award_loyalty_points_on_order_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_eligible_amount numeric(12,2);
  v_points integer;
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

  v_eligible_amount :=
    case
      when coalesce(new.tax_net_sales, 0) > 0
        then round(new.tax_net_sales, 2)
      else greatest(
        round(new.subtotal - coalesce(new.discount_amount, 0), 2),
        0
      )
    end;

  v_points := floor(
    v_eligible_amount / v_restaurant.loyalty_amount_threshold
  )::integer * v_restaurant.loyalty_points_awarded;

  if v_points <= 0 then
    return new;
  end if;

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

  get diagnostics v_rows_affected = row_count;
  if v_rows_affected = 0 then
    return new;
  end if;

  insert into public.customer_loyalty_accounts (customer_id, points_balance)
  values (new.customer_id, v_points)
  on conflict (customer_id)
  do update set
    points_balance = public.customer_loyalty_accounts.points_balance + excluded.points_balance,
    updated_at = now();

  return new;
end;
$$;

revoke all on function public.award_loyalty_points_on_order_completed() from public;
