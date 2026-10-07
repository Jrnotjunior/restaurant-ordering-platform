-- Ensure System Administrator restaurant deletes also clean up the tenant Auth account.
-- The existing System Admin DELETE policy allows deletion directly from
-- public.restaurants. These triggers make that path safe without changing
-- ordinary owner/staff deletion behavior.

create or replace function public.system_admin_prepare_restaurant_delete()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.system_admin_has_manage_access() then
    return old;
  end if;

  -- These references intentionally use NO ACTION/RESTRICT and therefore must
  -- be removed before the restaurant row can be deleted.
  delete from public.system_admin_audit_logs
  where restaurant_id = old.id;

  delete from public.system_api_usage_events
  where restaurant_id = old.id;

  delete from public.paymongo_webhook_events
  where restaurant_id = old.id;

  delete from public.tenant_invitations
  where restaurant_id = old.id;

  return old;
end;
$$;

create or replace function public.system_admin_cleanup_deleted_restaurant_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.system_admin_has_manage_access() then
    return old;
  end if;

  -- Only remove the Auth account when it is no longer used by another
  -- restaurant or tenant invitation.
  if old.owner_id is not null
     and not exists (
       select 1
       from public.restaurants
       where owner_id = old.owner_id
     )
     and not exists (
       select 1
       from public.tenant_invitations
       where auth_user_id = old.owner_id
     )
  then
    delete from auth.users
    where id = old.owner_id;
  end if;

  return old;
end;
$$;

drop trigger if exists system_admin_prepare_restaurant_delete_trigger
on public.restaurants;

create trigger system_admin_prepare_restaurant_delete_trigger
before delete on public.restaurants
for each row
execute function public.system_admin_prepare_restaurant_delete();

drop trigger if exists system_admin_cleanup_deleted_restaurant_owner_trigger
on public.restaurants;

create trigger system_admin_cleanup_deleted_restaurant_owner_trigger
after delete on public.restaurants
for each row
execute function public.system_admin_cleanup_deleted_restaurant_owner();

revoke all on function public.system_admin_prepare_restaurant_delete() from public, anon, authenticated;
revoke all on function public.system_admin_cleanup_deleted_restaurant_owner() from public, anon, authenticated;
