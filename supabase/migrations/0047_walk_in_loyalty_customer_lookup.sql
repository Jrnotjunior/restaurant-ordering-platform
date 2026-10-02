-- Walk-in loyalty customers and POS name autocomplete.
-- Walk-in customers do not need a Supabase Auth account; the POS name identifies
-- the loyalty record. Online guest checkout does not use this flow.

alter table public.customer_profiles
  alter column auth_user_id drop not null,
  alter column phone drop not null;

alter table public.customer_profiles
  drop constraint if exists customer_profiles_phone_not_empty;

drop index if exists public.customer_profiles_restaurant_phone_uidx;

create index if not exists customer_profiles_restaurant_name_idx
  on public.customer_profiles (restaurant_id, lower(trim(name)));

create or replace function public.find_customers_by_name(
  p_restaurant_id uuid,
  p_name text
)
returns table (
  customer_id uuid,
  name text,
  phone text,
  points_balance bigint,
  is_registered boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active = true
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
    raise exception 'You are not authorized to look up customers for this restaurant';
  end if;

  return query
  select
    cp.id,
    cp.name,
    cp.phone,
    coalesce(cla.points_balance, 0),
    cp.auth_user_id is not null
  from public.customer_profiles cp
  left join public.customer_loyalty_accounts cla
    on cla.customer_id = cp.id
  where cp.restaurant_id = p_restaurant_id
    and lower(trim(cp.name)) like lower(trim(coalesce(p_name, ''))) || '%'
  order by
    case when lower(trim(cp.name)) = lower(trim(coalesce(p_name, ''))) then 0 else 1 end,
    lower(cp.name)
  limit 8;
end;
$$;

revoke all on function public.find_customers_by_name(uuid, text) from public;
grant execute on function public.find_customers_by_name(uuid, text) to authenticated;

create or replace function public.get_or_create_walk_in_customer(
  p_restaurant_id uuid,
  p_name text
)
returns table (
  customer_id uuid,
  name text,
  points_balance bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer public.customer_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active = true
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
    raise exception 'You are not authorized to create loyalty customers for this restaurant';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0
     or lower(trim(p_name)) = 'walk-in customer' then
    return;
  end if;

  -- Names are the POS loyalty identity. Reuse an existing matching record so
  -- repeated walk-in visits accumulate on the same balance.
  select *
  into v_customer
  from public.customer_profiles
  where restaurant_id = p_restaurant_id
    and lower(trim(name)) = lower(trim(p_name))
  order by
    case when auth_user_id is not null then 0 else 1 end,
    created_at
  limit 1
  for update;

  if not found then
    insert into public.customer_profiles (
      restaurant_id,
      auth_user_id,
      name,
      phone
    )
    values (
      p_restaurant_id,
      null,
      trim(p_name),
      null
    )
    returning * into v_customer;
  end if;

  insert into public.customer_loyalty_accounts (customer_id)
  values (v_customer.id)
  on conflict (customer_id) do nothing;

  return query
  select
    v_customer.id,
    v_customer.name,
    coalesce(
      (select cla.points_balance
       from public.customer_loyalty_accounts cla
       where cla.customer_id = v_customer.id),
      0
    );
end;
$$;

revoke all on function public.get_or_create_walk_in_customer(uuid, text) from public;
grant execute on function public.get_or_create_walk_in_customer(uuid, text) to authenticated;
