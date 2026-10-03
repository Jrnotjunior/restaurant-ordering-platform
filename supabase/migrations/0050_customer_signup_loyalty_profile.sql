-- Ensure every registered customer gets a loyalty profile at Auth signup.
-- Customer phone is optional; checkout/POS may collect a phone separately.

alter table public.customer_profiles
  alter column phone drop not null;

alter table public.customer_profiles
  drop constraint if exists customer_profiles_phone_not_empty;

create or replace function public.upsert_customer_profile(
  p_restaurant_id uuid,
  p_name text,
  p_phone text default null
)
returns table (
  customer_id uuid,
  restaurant_id uuid,
  name text,
  phone text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
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

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Customer name is required';
  end if;

  insert into public.customer_profiles (
    restaurant_id,
    auth_user_id,
    name,
    phone
  )
  values (
    p_restaurant_id,
    auth.uid(),
    trim(p_name),
    nullif(trim(coalesce(p_phone, '')), '')
  )
  on conflict (restaurant_id, auth_user_id)
  do update set
    name = excluded.name,
    phone = excluded.phone,
    updated_at = now()
  returning id into v_customer_id;

  insert into public.customer_loyalty_accounts (customer_id)
  values (v_customer_id)
  on conflict (customer_id) do nothing;

  return query
  select cp.id, cp.restaurant_id, cp.name, cp.phone
  from public.customer_profiles cp
  where cp.id = v_customer_id;
end;
$$;

revoke all on function public.upsert_customer_profile(uuid, text, text) from public;
grant execute on function public.upsert_customer_profile(uuid, text, text) to authenticated;

create or replace function public.handle_new_customer_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant_id uuid;
  v_name text;
  v_phone text;
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') <> 'customer' then
    return new;
  end if;

  begin
    v_restaurant_id := nullif(new.raw_user_meta_data ->> 'restaurant_id', '')::uuid;
  exception when others then
    v_restaurant_id := null;
  end;

  v_name := trim(coalesce(new.raw_user_meta_data ->> 'name', ''));

  if v_restaurant_id is null or v_name = '' then
    return new;
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = v_restaurant_id
      and r.is_active = true
  ) then
    return new;
  end if;

  v_phone := nullif(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');

  insert into public.customer_profiles (
    restaurant_id,
    auth_user_id,
    name,
    phone
  )
  values (
    v_restaurant_id,
    new.id,
    v_name,
    v_phone
  )
  on conflict (restaurant_id, auth_user_id)
  do update set
    name = excluded.name,
    phone = excluded.phone,
    updated_at = now();

  insert into public.customer_loyalty_accounts (customer_id)
  select cp.id
  from public.customer_profiles cp
  where cp.restaurant_id = v_restaurant_id
    and cp.auth_user_id = new.id
  on conflict (customer_id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_customer_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_customer_profile on auth.users;
create trigger on_auth_user_created_customer_profile
after insert on auth.users
for each row
execute function public.handle_new_customer_user();
