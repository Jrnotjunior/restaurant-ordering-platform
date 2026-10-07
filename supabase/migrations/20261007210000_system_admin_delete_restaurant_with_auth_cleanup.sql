-- System Administrator restaurant deletion with tenant Auth cleanup.
-- Deletes the restaurant and, when safe, its tenant owner Auth account.
-- The Auth account is preserved if it is still referenced by another
-- restaurant or tenant invitation.

create or replace function public.system_admin_delete_restaurant(p_restaurant_id uuid)
returns boolean
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

  -- Never silently destroy operational history. Existing orders and pending
  -- online payments intentionally use RESTRICT/NO ACTION references.
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

  -- Remove rows whose foreign keys intentionally use NO ACTION/RESTRICT.
  delete from public.system_admin_audit_logs
  where restaurant_id = p_restaurant_id;

  delete from public.system_api_usage_events
  where restaurant_id = p_restaurant_id;

  delete from public.paymongo_webhook_events
  where restaurant_id = p_restaurant_id;

  -- Tenant invitations reference the restaurant without automatic deletion.
  delete from public.tenant_invitations
  where restaurant_id = p_restaurant_id;

  -- Most restaurant-owned records cascade from restaurants.
  delete from public.restaurants
  where id = p_restaurant_id;

  -- Only remove the tenant Auth account if it is no longer associated with
  -- another restaurant or tenant invitation.
  if v_owner_id is not null
     and not exists (
       select 1
       from public.restaurants
       where owner_id = v_owner_id
     )
     and not exists (
       select 1
       from public.tenant_invitations
       where auth_user_id = v_owner_id
     )
  then
    delete from auth.users
    where id = v_owner_id;
  end if;

  return true;
end;
$$;

revoke all on function public.system_admin_delete_restaurant(uuid)
from public, anon, authenticated;

grant execute on function public.system_admin_delete_restaurant(uuid)
to authenticated;
