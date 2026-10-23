-- System Administrator-only master control for tenant online payments.
-- Keep the per-method selections in the existing JSON setting.

create or replace function public.system_admin_get_online_payments_enabled(p_restaurant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((r.online_payment_methods ->> 'enabled')::boolean, true)
  from public.restaurants r
  where r.id = p_restaurant_id
    and public.is_system_admin();
$$;

revoke all on function public.system_admin_get_online_payments_enabled(uuid) from public, anon;
grant execute on function public.system_admin_get_online_payments_enabled(uuid) to authenticated;

create or replace function public.system_admin_set_online_payments_enabled(
  p_restaurant_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_methods jsonb;
begin
  if not public.is_system_admin() then
    raise exception 'System Administrator access required.';
  end if;

  if p_enabled is null then
    raise exception 'Online payments enabled status is required.';
  end if;

  select coalesce(online_payment_methods, '{}'::jsonb)
    into v_methods
    from public.restaurants
    where id = p_restaurant_id
    for update;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  update public.restaurants
    set online_payment_methods = jsonb_set(coalesce(v_methods, '{}'::jsonb), '{enabled}', to_jsonb(p_enabled), true)
    where id = p_restaurant_id;

  return p_enabled;
end;
$$;

revoke all on function public.system_admin_set_online_payments_enabled(uuid, boolean) from public, anon;
grant execute on function public.system_admin_set_online_payments_enabled(uuid, boolean) to authenticated;

create or replace function public.protect_system_admin_online_payments_toggle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin()
    and coalesce((new.online_payment_methods ->> 'enabled')::boolean, true)
      is distinct from coalesce((old.online_payment_methods ->> 'enabled')::boolean, true)
  then
    raise exception 'Online payments availability is controlled by the System Administrator.';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_system_admin_online_payments_toggle() from public, anon, authenticated;

drop trigger if exists protect_system_admin_online_payments_toggle on public.restaurants;
create trigger protect_system_admin_online_payments_toggle
before update of online_payment_methods on public.restaurants
for each row execute function public.protect_system_admin_online_payments_toggle();
