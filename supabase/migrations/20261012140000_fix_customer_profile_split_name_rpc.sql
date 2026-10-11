-- Align customer profile creation with the split-name schema and current frontend RPC.
-- Forward-only repair: the prior RPC accepted p_name, but clients now send p_first_name/p_last_name.
-- Keep this function tenant-bound and preserve the loyalty-account bootstrap.

drop function if exists public.upsert_customer_profile(uuid, text, text);

create function public.upsert_customer_profile(
  p_restaurant_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text default null
)
returns table (
  customer_id uuid,
  restaurant_id uuid,
  first_name text,
  last_name text,
  phone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_last_name text := nullif(btrim(coalesce(p_last_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer account must be created for the current restaurant';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active = true
  ) then
    raise exception 'Restaurant not found or inactive';
  end if;

  if v_first_name is null or v_last_name is null then
    raise exception 'First name and last name are required';
  end if;

  if v_phone is not null and v_phone !~ '^09[0-9]{9}$' then
    raise exception 'Enter a valid Philippine mobile number';
  end if;

  insert into public.customer_profiles (
    restaurant_id,
    auth_user_id,
    first_name,
    last_name,
    phone
  )
  values (
    p_restaurant_id,
    auth.uid(),
    v_first_name,
    v_last_name,
    v_phone
  )
  on conflict (restaurant_id, auth_user_id)
  do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    phone = coalesce(excluded.phone, public.customer_profiles.phone),
    updated_at = now()
  returning id into v_customer_id;

  insert into public.customer_loyalty_accounts (customer_id)
  values (v_customer_id)
  on conflict (customer_id) do nothing;

  return query
  select cp.id, cp.restaurant_id, cp.first_name, cp.last_name, cp.phone
  from public.customer_profiles cp
  where cp.id = v_customer_id;
end;
$$;

revoke all on function public.upsert_customer_profile(uuid, text, text, text) from public, anon;
grant execute on function public.upsert_customer_profile(uuid, text, text, text) to authenticated;

comment on function public.upsert_customer_profile(uuid, text, text, text) is
  'Creates or updates the authenticated customer profile using separate first/last names, restricted to the active restaurant tenant.';
