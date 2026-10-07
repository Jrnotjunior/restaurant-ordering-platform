-- Clean up abandoned tenant onboarding records.
-- Pending tenant invitations are provisional until complete_tenant_owner_setup()
-- accepts them. Once an invitation expires, its provisional restaurant and
-- tenant auth account must not remain in the system.

create or replace function public.expire_stale_tenant_invitations()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_count integer := 0;
  v_invitation record;
begin
  for v_invitation in
    select ti.id, ti.auth_user_id, ti.restaurant_id
    from public.tenant_invitations ti
    where ti.status = 'pending'
      and ti.expires_at <= now()
    for update
  loop
    -- Delete the provisional restaurant first. It was created by the
    -- System Administrator only for this pending onboarding flow.
    if v_invitation.restaurant_id is not null then
      delete from public.restaurants
      where id = v_invitation.restaurant_id;
    end if;

    -- Remove the invitation record itself.
    delete from public.tenant_invitations
    where id = v_invitation.id;

    -- Remove the provisional Supabase Auth account. Only accounts attached
    -- to a still-pending invitation are eligible for this cleanup.
    if v_invitation.auth_user_id is not null then
      delete from auth.users
      where id = v_invitation.auth_user_id;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.expire_stale_tenant_invitations() from public, anon, authenticated;

-- Run cleanup automatically so expired invitations do not remain in the
-- database waiting for a tenant to open the invitation page.
create extension if not exists pg_cron with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'cleanup-expired-tenant-invitations';

select cron.schedule(
  'cleanup-expired-tenant-invitations',
  '*/15 * * * *',
  $$select public.expire_stale_tenant_invitations();$$
);
