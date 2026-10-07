-- Finalize abandoned tenant onboarding cleanup.
-- A tenant restaurant/account is provisional while its invitation is pending.
-- If the invitation is expired or manually expired before acceptance, remove
-- the provisional records instead of leaving an orphan restaurant/auth user.

create or replace function public.cleanup_abandoned_tenant_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
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

  -- A pending tenant must not have operational data. If something was
  -- created against the provisional restaurant, do not destroy it silently.
  if v_invitation.restaurant_id is not null
     and (
       exists (select 1 from public.orders where restaurant_id = v_invitation.restaurant_id)
       or exists (select 1 from public.pending_online_payments where restaurant_id = v_invitation.restaurant_id)
     )
  then
    return false;
  end if;

  if v_invitation.restaurant_id is not null then
    -- These tables intentionally keep their restaurant FK as RESTRICT/NO ACTION
    -- because their records are audit/usage history. They must be removed for
    -- an abandoned provisional restaurant before the restaurant itself can go.
    delete from public.system_admin_audit_logs
    where restaurant_id = v_invitation.restaurant_id;

    delete from public.system_api_usage_events
    where restaurant_id = v_invitation.restaurant_id;

    delete from public.paymongo_webhook_events
    where restaurant_id = v_invitation.restaurant_id;

    -- Remove the invitation before the restaurant because its FK is NO ACTION.
    delete from public.tenant_invitations
    where id = v_invitation.id;

    delete from public.restaurants
    where id = v_invitation.restaurant_id;
  else
    delete from public.tenant_invitations
    where id = v_invitation.id;
  end if;

  -- Remove the provisional Supabase Auth account only when it is no longer
  -- referenced by another tenant invitation or restaurant.
  if v_invitation.auth_user_id is not null
     and not exists (
       select 1
       from public.tenant_invitations ti
       where ti.auth_user_id = v_invitation.auth_user_id
     )
     and not exists (
       select 1
       from public.restaurants r
       where r.owner_id = v_invitation.auth_user_id
     )
  then
    delete from auth.users
    where id = v_invitation.auth_user_id;
  end if;

  return true;
end;
$$;

revoke execute on function public.cleanup_abandoned_tenant_invitation(uuid) from public, anon, authenticated;

create or replace function public.expire_stale_tenant_invitations()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_count integer := 0;
  v_invitation_id uuid;
begin
  for v_invitation_id in
    select ti.id
    from public.tenant_invitations ti
    where ti.status = 'pending'
      and ti.expires_at <= now()
    order by ti.expires_at
    for update
  loop
    if public.cleanup_abandoned_tenant_invitation(v_invitation_id) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.expire_stale_tenant_invitations() from public, anon, authenticated;

create or replace function public.system_admin_expire_tenant_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null or not public.system_admin_has_manage_access() then
    raise exception 'System Administrator access is required';
  end if;

  return public.cleanup_abandoned_tenant_invitation(p_invitation_id);
end;
$$;

revoke execute on function public.system_admin_expire_tenant_invitation(uuid) from public, anon;
grant execute on function public.system_admin_expire_tenant_invitation(uuid) to authenticated;

create extension if not exists pg_cron with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-expired-tenant-invitations';

select cron.schedule(
  'cleanup-expired-tenant-invitations',
  '*/15 * * * *',
  $$select public.expire_stale_tenant_invitations();$$
);
