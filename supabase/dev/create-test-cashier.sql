-- Development-only helper: create a dummy cashier for role-access testing.
-- Run this manually in Supabase SQL Editor. Remove the dummy Auth user and
-- restaurant_staff row after testing.
--
-- Replace the values below before running if desired.

do $$
declare
  v_restaurant_id uuid;
  v_user_id uuid;
begin
  select id into v_restaurant_id
  from public.restaurants
  where is_active = true
  order by created_at asc
  limit 1;

  if v_restaurant_id is null then
    raise exception 'No active restaurant found.';
  end if;

  -- This script creates the staff row only if the Auth user already exists.
  -- The Auth user must be created from Supabase Authentication > Users,
  -- because passwords cannot safely be inserted into auth.users with SQL.
  select id into v_user_id
  from auth.users
  where email = 'cashier.test@example.com'
  limit 1;

  if v_user_id is null then
    raise exception 'Create cashier.test@example.com first in Supabase Authentication > Users, then run this SQL again.';
  end if;

  insert into public.restaurant_staff (
    restaurant_id,
    auth_user_id,
    name,
    mobile_number,
    email,
    role,
    is_active
  )
  values (
    v_restaurant_id,
    v_user_id,
    'Test Cashier',
    '09000000000',
    'cashier.test@example.com',
    'cashier',
    true
  )
  on conflict (auth_user_id) do update
  set
    restaurant_id = excluded.restaurant_id,
    name = excluded.name,
    mobile_number = excluded.mobile_number,
    email = excluded.email,
    role = excluded.role,
    is_active = true;
end $$;
