-- Ensure customer Auth signups always have a restaurant profile and loyalty account.
-- Recreate the Auth trigger and backfill customer accounts that were created
-- before the trigger was installed or while the previous trigger was missing.

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
  v_customer_id uuid;
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
    updated_at = now()
  returning id into v_customer_id;

  insert into public.customer_loyalty_accounts (customer_id)
  values (v_customer_id)
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

-- Backfill existing customer Auth users that are missing their profile.
do $$
declare
  v_user record;
  v_customer_id uuid;
  v_restaurant_id uuid;
  v_name text;
  v_phone text;
begin
  for v_user in
    select
      u.id,
      u.raw_user_meta_data
    from auth.users u
    where coalesce(u.raw_user_meta_data ->> 'role', '') = 'customer'
  loop
    begin
      v_restaurant_id := nullif(v_user.raw_user_meta_data ->> 'restaurant_id', '')::uuid;
    exception when others then
      v_restaurant_id := null;
    end;

    v_name := trim(coalesce(v_user.raw_user_meta_data ->> 'name', ''));

    if v_restaurant_id is null or v_name = '' then
      continue;
    end if;

    if not exists (
      select 1
      from public.restaurants r
      where r.id = v_restaurant_id
        and r.is_active = true
    ) then
      continue;
    end if;

    v_phone := nullif(trim(coalesce(v_user.raw_user_meta_data ->> 'phone', '')), '');

    insert into public.customer_profiles (
      restaurant_id,
      auth_user_id,
      name,
      phone
    )
    values (
      v_restaurant_id,
      v_user.id,
      v_name,
      v_phone
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
  end loop;
end $$;
