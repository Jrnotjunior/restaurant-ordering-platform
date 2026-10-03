-- System Admin restaurant owner management.
-- Allows the System Admin to view and assign an existing Supabase Auth user
-- as the owner of a restaurant without exposing auth.users to the browser.

create or replace function public.system_admin_get_restaurant_owner(p_restaurant_id uuid)
returns table (
  user_id uuid,
  email text,
  full_name text
)
language sql
security definer
stable
set search_path = public, auth
as $$
  select
    u.id,
    u.email,
    coalesce(
      nullif(u.raw_user_meta_data ->> 'full_name', ''),
      nullif(u.raw_user_meta_data ->> 'name', '')
    )
  from public.restaurants r
  join auth.users u on u.id = r.owner_id
  where r.id = p_restaurant_id
    and public.is_system_admin();
$$;

revoke all on function public.system_admin_get_restaurant_owner(uuid) from public, anon;
grant execute on function public.system_admin_get_restaurant_owner(uuid) to authenticated;

create or replace function public.system_admin_assign_restaurant_owner(
  p_restaurant_id uuid,
  p_email text
)
returns table (
  user_id uuid,
  email text,
  full_name text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user auth.users%rowtype;
begin
  if not public.is_system_admin() then
    raise exception 'System Administrator access required.';
  end if;

  if not exists (select 1 from public.restaurants where id = p_restaurant_id) then
    raise exception 'Restaurant not found.';
  end if;

  select *
  into v_user
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_user.id is null then
    raise exception 'No Auth account was found for that email.';
  end if;

  update public.restaurants
  set owner_id = v_user.id
  where id = p_restaurant_id;

  return query
  select
    v_user.id,
    v_user.email,
    coalesce(
      nullif(v_user.raw_user_meta_data ->> 'full_name', ''),
      nullif(v_user.raw_user_meta_data ->> 'name', '')
    );
end;
$$;

revoke all on function public.system_admin_assign_restaurant_owner(uuid, text) from public, anon;
grant execute on function public.system_admin_assign_restaurant_owner(uuid, text) to authenticated;

create or replace function public.system_admin_remove_restaurant_owner(p_restaurant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception 'System Administrator access required.';
  end if;

  update public.restaurants
  set owner_id = null
  where id = p_restaurant_id;
end;
$$;

revoke all on function public.system_admin_remove_restaurant_owner(uuid) from public, anon;
grant execute on function public.system_admin_remove_restaurant_owner(uuid) to authenticated;
