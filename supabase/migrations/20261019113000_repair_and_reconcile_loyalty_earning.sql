-- Repair automatic loyalty earning and reconcile historical eligible orders.
-- The live migration was applied as repair_and_reconcile_loyalty_earning.
-- Keep this migration in source control to reproduce the deployed database state.

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
begin
  if new.status <> 'completed'
     or new.customer_id is null
     or new.payment_status <> 'paid'
     or (tg_op = 'UPDATE'
         and old.status = 'completed'
         and old.customer_id is not distinct from new.customer_id
         and old.payment_status = 'paid') then
    return new;
  end if;

  select * into v_restaurant from public.restaurants where id = new.restaurant_id;
  if not found or not v_restaurant.loyalty_enabled
     or v_restaurant.loyalty_amount_threshold <= 0
     or v_restaurant.loyalty_points_awarded <= 0 then
    return new;
  end if;

  if exists (select 1 from public.loyalty_transactions
             where order_id = new.id and transaction_type = 'earn') then
    return new;
  end if;

  v_eligible_amount := greatest(round(coalesce(new.subtotal, 0) - coalesce(new.discount_amount, 0), 2), 0);
  if v_eligible_amount <= 0 then return new; end if;

  insert into public.customer_loyalty_accounts
    (customer_id, points_balance, eligible_spend_remainder, eligible_spend_balance)
  values (new.customer_id, 0, 0, 0)
  on conflict (customer_id) do nothing;

  select eligible_spend_remainder into v_remainder
  from public.customer_loyalty_accounts
  where customer_id = new.customer_id for update;

  v_accumulated_amount := round(coalesce(v_remainder, 0) + v_eligible_amount, 2);
  v_points := floor(v_accumulated_amount / v_restaurant.loyalty_amount_threshold)::integer
              * v_restaurant.loyalty_points_awarded;
  v_remainder := round(mod(v_accumulated_amount, v_restaurant.loyalty_amount_threshold), 2);

  update public.customer_loyalty_accounts
  set eligible_spend_remainder = v_remainder,
      eligible_spend_balance = v_remainder,
      points_balance = points_balance + v_points,
      updated_at = now()
  where customer_id = new.customer_id;

  if v_points > 0 then
    insert into public.loyalty_transactions
      (restaurant_id, customer_id, order_id, transaction_type, points, eligible_amount,
       rule_amount_threshold, rule_points_awarded, description)
    values
      (new.restaurant_id, new.customer_id, new.id, 'earn', v_points, v_eligible_amount,
       v_restaurant.loyalty_amount_threshold, v_restaurant.loyalty_points_awarded,
       'Points earned from cumulative eligible spend including order ' || new.order_number);
  end if;
  return new;
end;
$$;

revoke all on function public.award_loyalty_points_on_order_completed() from public;
drop trigger if exists orders_award_loyalty_on_completed on public.orders;
drop trigger if exists orders_award_loyalty_points on public.orders;

create trigger orders_award_loyalty_on_completed
after insert or update of status, customer_id, payment_status on public.orders
for each row
when (new.status = 'completed' and new.customer_id is not null and new.payment_status = 'paid')
execute function public.award_loyalty_points_on_order_completed();

do $$
declare
  v_customer record;
  v_order record;
  v_restaurant public.restaurants%rowtype;
  v_running numeric(12,2);
  v_order_eligible numeric(12,2);
  v_prior_points integer;
  v_new_points integer;
  v_remainder numeric(12,2);
  v_total_added integer;
begin
  for v_customer in
    select distinct o.customer_id, o.restaurant_id
    from public.orders o join public.restaurants r on r.id = o.restaurant_id
    where o.customer_id is not null and o.status = 'completed' and o.payment_status = 'paid'
      and r.loyalty_enabled and r.loyalty_amount_threshold > 0 and r.loyalty_points_awarded > 0
  loop
    select * into v_restaurant from public.restaurants where id = v_customer.restaurant_id;
    v_running := 0;
    v_total_added := 0;

    insert into public.customer_loyalty_accounts
      (customer_id, points_balance, eligible_spend_remainder, eligible_spend_balance)
    values (v_customer.customer_id, 0, 0, 0)
    on conflict (customer_id) do nothing;

    for v_order in
      select o.* from public.orders o
      where o.customer_id = v_customer.customer_id
        and o.restaurant_id = v_customer.restaurant_id
        and o.status = 'completed' and o.payment_status = 'paid'
      order by o.created_at, o.id
    loop
      v_order_eligible := greatest(round(coalesce(v_order.subtotal, 0) - coalesce(v_order.discount_amount, 0), 2), 0);
      v_prior_points := floor(v_running / v_restaurant.loyalty_amount_threshold)::integer
                        * v_restaurant.loyalty_points_awarded;
      v_running := round(v_running + v_order_eligible, 2);
      v_new_points := floor(v_running / v_restaurant.loyalty_amount_threshold)::integer
                      * v_restaurant.loyalty_points_awarded - v_prior_points;

      if v_new_points > 0 and not exists (
        select 1 from public.loyalty_transactions lt
        where lt.order_id = v_order.id and lt.transaction_type = 'earn'
      ) then
        insert into public.loyalty_transactions
          (restaurant_id, customer_id, order_id, transaction_type, points, eligible_amount,
           rule_amount_threshold, rule_points_awarded, description)
        values
          (v_order.restaurant_id, v_order.customer_id, v_order.id, 'earn', v_new_points,
           v_order_eligible, v_restaurant.loyalty_amount_threshold, v_restaurant.loyalty_points_awarded,
           'Historical loyalty reconciliation for completed order ' || v_order.order_number);
        v_total_added := v_total_added + v_new_points;
      end if;
    end loop;

    v_remainder := round(mod(v_running, v_restaurant.loyalty_amount_threshold), 2);
    update public.customer_loyalty_accounts
    set points_balance = points_balance + v_total_added,
        eligible_spend_remainder = v_remainder,
        eligible_spend_balance = v_remainder,
        updated_at = now()
    where customer_id = v_customer.customer_id;
  end loop;
end;
$$;
