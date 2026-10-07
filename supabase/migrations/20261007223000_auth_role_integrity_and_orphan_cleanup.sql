-- Enforce the application-role invariant for Supabase Auth users.
-- Every permanent Auth account must be represented by at least one application role:
-- Customer, Restaurant Staff, Restaurant Owner, or System Administrator.
-- Pending tenant invitations are a temporary onboarding state and are protected
-- until the invitation-expiration cleanup removes them.

create or replace function public.auth_user_has_application_role(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select
    exists (select 1 from public.customer_profiles cp where cp.auth_user_id = p_user_id)
    or exists (select 1 from public.restaurant_staff rs where rs.auth_user_id = p_user_id)
    or exists (select 1 from public.restaurants r where r.owner_id = p_user_id)
    or exists (select 1 from public.system_admin_access saa where saa.admin_user_id = p_user_id)
    or exists (
      select 1
      from public.tenant_invitations ti
      where ti.auth_user_id = p_user_id
        and ti.status = 'pending'
    );
$$;

revoke execute on function public.auth_user_has_application_role(uuid) from public, anon, authenticated;
grant execute on function public.auth_user_has_application_role(uuid) to service_role;

-- Server-side safety net. It only considers Auth accounts that are at least
-- one hour old, have no application role, are not pending invitations, and
-- do not own Storage objects. The one-hour age guard prevents a signup/onboarding
-- transaction from being mistaken for an orphan during a brief race.
create or replace function public.reconcile_roleless_auth_users()
returns integer
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  v_user record;
  v_deleted integer := 0;
begin
  for v_user in
    select u.id
    from auth.users u
    where u.created_at < now() - interval '1 hour'
      and not public.auth_user_has_application_role(u.id)
      and not exists (
        select 1 from storage.objects so where so.owner_id = u.id::text
      )
    order by u.created_at
  loop
    begin
      delete from auth.users
      where id = v_user.id
        and not public.auth_user_has_application_role(v_user.id)
        and not exists (
          select 1 from storage.objects so where so.owner_id = v_user.id::text
        );

      if found then
        v_deleted := v_deleted + 1;
      end if;
    exception
      when others then
        raise warning 'Roleless Auth cleanup skipped user %: %', v_user.id, sqlerrm;
    end;
  end loop;

  return v_deleted;
end;
$$;

revoke execute on function public.reconcile_roleless_auth_users() from public, anon, authenticated;
grant execute on function public.reconcile_roleless_auth_users() to service_role;

-- Make expired invitation cleanup obey the same role invariant.
create or replace function public.cleanup_abandoned_tenant_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
  v_has_password boolean := false;
begin
  select *
    into v_invitation
  from public.tenant_invitations
  where id = p_invitation_id
    and status = 'pending'
  for update;

  if not found then
    return false;
  end if;

  select coalesce(length(u.encrypted_password), 0) > 0
    into v_has_password
  from auth.users u
  where u.id = v_invitation.auth_user_id;

  if v_has_password
     and v_invitation.restaurant_id is not null
     and exists (
       select 1
       from public.restaurants r
       where r.id = v_invitation.restaurant_id
         and r.owner_id = v_invitation.auth_user_id
     )
  then
    update public.tenant_invitations
    set status = 'accepted',
        accepted_at = coalesce(accepted_at, now()),
        updated_at = now()
    where id = v_invitation.id;
    return true;
  end if;

  if v_invitation.expires_at > now() then
    return false;
  end if;

  if v_invitation.restaurant_id is not null
     and (
       exists (select 1 from public.orders where restaurant_id = v_invitation.restaurant_id)
       or exists (select 1 from public.pending_online_payments where restaurant_id = v_invitation.restaurant_id)
     )
  then
    return false;
  end if;

  if v_invitation.restaurant_id is not null then
    delete from public.system_admin_audit_logs where restaurant_id = v_invitation.restaurant_id;
    delete from public.system_api_usage_events where restaurant_id = v_invitation.restaurant_id;
    delete from public.paymongo_webhook_events where restaurant_id = v_invitation.restaurant_id;
    delete from public.tenant_invitations where id = v_invitation.id;
    delete from public.restaurants where id = v_invitation.restaurant_id;
  else
    delete from public.tenant_invitations where id = v_invitation.id;
  end if;

  if v_invitation.auth_user_id is not null
     and not v_has_password
     and not public.auth_user_has_application_role(v_invitation.auth_user_id)
     and not exists (
       select 1 from storage.objects so where so.owner_id = v_invitation.auth_user_id::text
     )
  then
    delete from auth.users where id = v_invitation.auth_user_id;
  end if;

  return true;
end;
$$;

revoke execute on function public.cleanup_abandoned_tenant_invitation(uuid) from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'cleanup-expired-tenant-invitations',
  'reconcile-roleless-auth-users'
);

select cron.schedule(
  'cleanup-expired-tenant-invitations',
  '*/15 * * * *',
  $$select public.expire_stale_tenant_invitations();$$
);

select cron.schedule(
  'reconcile-roleless-auth-users',
  '7,22,37,52 * * * *',
  $$select public.reconcile_roleless_auth_users();$$
);
