-- Move tenant Auth deletion out of PostgreSQL and into a protected
-- Supabase Edge Function using Auth Admin APIs.
--
-- PostgreSQL owns the tenant/database deletion.
-- The Edge Function owns the Supabase Auth account deletion.
-- This avoids direct DELETEs against auth.users.

drop trigger if exists system_admin_cleanup_deleted_restaurant_owner_trigger
on public.restaurants;

drop function if exists public.system_admin_cleanup_deleted_restaurant_owner();

drop function if exists public.system_admin_delete_restaurant(uuid);

create function public.system_admin_delete_restaurant(p_restaurant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner_id uuid;
begin
  if auth.uid() is null or not public.system_admin_has_manage_access() then
    raise exception 'System Administrator access is required';
  end if;

  select r.owner_id
    into v_owner_id
  from public.restaurants r
  where r.id = p_restaurant_id
  for update;

  if not found then
    raise exception 'Restaurant not found';
  end if;

  if exists (
    select 1
    from public.orders
    where restaurant_id = p_restaurant_id
  ) then
    raise exception 'Restaurant cannot be deleted because it has existing orders';
  end if;

  if exists (
    select 1
    from public.pending_online_payments
    where restaurant_id = p_restaurant_id
  ) then
    raise exception 'Restaurant cannot be deleted because it has pending online payments';
  end if;

  delete from public.system_admin_audit_logs
  where restaurant_id = p_restaurant_id;

  delete from public.system_api_usage_events
  where restaurant_id = p_restaurant_id;

  delete from public.paymongo_webhook_events
  where restaurant_id = p_restaurant_id;

  delete from public.tenant_invitations
  where restaurant_id = p_restaurant_id;

  delete from public.restaurants
  where id = p_restaurant_id;

  return v_owner_id;
end;
$$;

revoke all on function public.system_admin_delete_restaurant(uuid)
from public, anon, authenticated;

grant execute on function public.system_admin_delete_restaurant(uuid)
to authenticated;
