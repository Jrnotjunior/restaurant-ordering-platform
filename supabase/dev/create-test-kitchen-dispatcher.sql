-- Development-only helper: create dummy Kitchen and Dispatcher accounts.
-- Create the Auth users first in Supabase Authentication > Users, with Auto Confirm enabled.
--
-- Suggested test credentials:
-- Kitchen:
--   Email: kitchen.test@example.com
--   Password: KitchenTest123!
-- Dispatcher:
--   Email: dispatcher.test@example.com
--   Password: DispatcherTest123!
--
-- Then run this script.

do $$
declare
  v_restaurant_id uuid;
  v_kitchen_user_id uuid;
  v_dispatcher_user_id uuid;
begin
  select id into v_restaurant_id
  from public.restaurants
  where is_active = true
  order by created_at asc
  limit 1;

  if v_restaurant_id is null then
    raise exception 'No active restaurant found.';
  end if;

  select id into v_kitchen_user_id
  from auth.users
  where email = 'kitchen.test@example.com'
  limit 1;

  if v_kitchen_user_id is null then
    raise exception 'Create kitchen.test@example.com in Supabase Authentication > Users first.';
  end if;

  select id into v_dispatcher_user_id
  from auth.users
  where email = 'dispatcher.test@example.com'
  limit 1;

  if v_dispatcher_user_id is null then
    raise exception 'Create dispatcher.test@example.com in Supabase Authentication > Users first.';
  end if;

  insert into public.restaurant_staff (
    restaurant_id, auth_user_id, name, mobile_number, email, role, is_active
  )
  values (
    v_restaurant_id, v_kitchen_user_id, 'Test Kitchen', '09000000001',
    'kitchen.test@example.com', 'kitchen', true
  )
  on conflict (auth_user_id) do update
  set restaurant_id = excluded.restaurant_id,
      name = excluded.name,
      mobile_number = excluded.mobile_number,
      email = excluded.email,
      role = excluded.role,
      is_active = true;

  insert into public.restaurant_staff (
    restaurant_id, auth_user_id, name, mobile_number, email, role, is_active
  )
  values (
    v_restaurant_id, v_dispatcher_user_id, 'Test Dispatcher', '09000000002',
    'dispatcher.test@example.com', 'dispatcher', true
  )
  on conflict (auth_user_id) do update
  set restaurant_id = excluded.restaurant_id,
      name = excluded.name,
      mobile_number = excluded.mobile_number,
      email = excluded.email,
      role = excluded.role,
      is_active = true;
end $$;
