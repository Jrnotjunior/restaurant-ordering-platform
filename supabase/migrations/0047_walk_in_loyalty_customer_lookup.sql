-- POS customer name autocomplete for registered loyalty accounts only.
-- Guest/walk-in orders remain guests and do not earn loyalty points.

alter table public.customer_profiles
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
    true
  from public.customer_profiles cp
  left join public.customer_loyalty_accounts cla
    on cla.customer_id = cp.id
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id is not null
    and lower(trim(cp.name)) like lower(trim(coalesce(p_name, ''))) || '%'
  order by
    case
      when lower(trim(cp.name)) = lower(trim(coalesce(p_name, ''))) then 0
      else 1
    end,
    lower(cp.name)
  limit 8;
end;
$$;

revoke all
on function public.find_customers_by_name(uuid, text)
from public;

grant execute
on function public.find_customers_by_name(uuid, text)
to authenticated;

drop function if exists public.get_or_create_walk_in_customer(uuid, text);
