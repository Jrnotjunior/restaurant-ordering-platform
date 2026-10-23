-- Customer registration must not treat caller-controlled restaurant headers as authorization.
-- The selected restaurant is validated against the database, and the single-tenant
-- trigger on customer_profiles prevents an identity from being attached to another tenant.
-- This keeps first-time signup working without making x-restaurant-* headers trusted.

drop function if exists public.upsert_customer_profile(uuid, text, text);
drop function if exists public.upsert_customer_profile(uuid, text, text, text);

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
  v_first_name text;
  v_last_name text;
  v_phone text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id is null then
    raise exception 'Restaurant is required';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active = true
  ) then
    raise exception 'Restaurant not found or inactive';
  end if;

  v_first_name := trim(coalesce(p_first_name, ''));
  v_last_name := trim(coalesce(p_last_name, ''));
  v_phone := nullif(trim(coalesce(p_phone, '')), '');

  if v_phone is not null and v_phone !~ '^09[0-9]{9}
    raise exception 'First name and last name are required';
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
    phone = excluded.phone,
    updated_at = now()
  returning id into v_customer_id;

  insert into public.customer_loyalty_accounts (customer_id)
  values (v_customer_id)
  on conflict (customer_id) do nothing;

  return query
  select cp.id, cp.restaurant_id, cp.first_name, cp.last_name, cp.phone
  from public.customer_profiles cp
  where cp.id = v_customer_id
    and cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function public.upsert_customer_profile(uuid, text, text, text) from public, anon;
grant execute on function public.upsert_customer_profile(uuid, text, text, text) to authenticated;
 then
    raise exception 'Enter an 11-digit mobile number starting with 09';
  end if;

  if v_first_name = '' or v_last_name = '' then
    raise exception 'First name and last name are required';
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
    phone = excluded.phone,
    updated_at = now()
  returning id into v_customer_id;

  insert into public.customer_loyalty_accounts (customer_id)
  values (v_customer_id)
  on conflict (customer_id) do nothing;

  return query
  select cp.id, cp.restaurant_id, cp.first_name, cp.last_name, cp.phone
  from public.customer_profiles cp
  where cp.id = v_customer_id
    and cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function public.upsert_customer_profile(uuid, text, text, text) from public, anon;
grant execute on function public.upsert_customer_profile(uuid, text, text, text) to authenticated;
