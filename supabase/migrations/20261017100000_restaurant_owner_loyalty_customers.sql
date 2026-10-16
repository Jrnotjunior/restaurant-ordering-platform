-- Owner-scoped customer loyalty overview.
-- Exposes only customers belonging to the restaurant owned by the caller.

create or replace function public.get_restaurant_loyalty_customers(
  p_restaurant_id uuid
)
returns table (
  customer_id uuid,
  customer_name text,
  email text,
  phone text,
  registered_at timestamptz,
  points_balance bigint,
  lifetime_points_earned bigint,
  lifetime_points_redeemed bigint,
  last_activity_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  ) then
    raise exception 'You are not authorized to view loyalty customers for this restaurant';
  end if;

  return query
  select
    cp.id,
    coalesce(
      nullif(btrim(concat_ws(' ', cp.first_name, cp.last_name)), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
      'Customer'
    ),
    coalesce(u.email, ''),
    cp.phone,
    cp.created_at,
    coalesce(cla.points_balance, 0)::bigint,
    coalesce(sum(case when lt.transaction_type = 'earn' and lt.points > 0 then lt.points else 0 end), 0)::bigint,
    coalesce(sum(case when lt.transaction_type = 'redeem' then abs(lt.points) else 0 end), 0)::bigint,
    max(lt.created_at)
  from public.customer_profiles cp
  join auth.users u on u.id = cp.auth_user_id
  left join public.customer_loyalty_accounts cla on cla.customer_id = cp.id
  left join public.loyalty_transactions lt
    on lt.customer_id = cp.id
   and lt.restaurant_id = cp.restaurant_id
  where cp.restaurant_id = p_restaurant_id
  group by cp.id, cp.first_name, cp.last_name, u.raw_user_meta_data, u.email, cp.phone, cp.created_at, cla.points_balance
  order by cp.created_at desc;
end;
$$;

revoke all on function public.get_restaurant_loyalty_customers(uuid) from public, anon;
grant execute on function public.get_restaurant_loyalty_customers(uuid) to authenticated;
