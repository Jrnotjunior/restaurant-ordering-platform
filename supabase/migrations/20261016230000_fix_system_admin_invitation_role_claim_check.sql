-- Invitation acceptance occurs before the administrator can enroll/verify MFA.
-- Authorize activation only for the authenticated user with their own pending
-- invitation. The System Admin app continues to enforce MFA before admin access.
create or replace function public.system_admin_activate_my_pending_access()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required';
  end if;

  select status into v_status
  from public.system_admin_access
  where admin_user_id = auth.uid()
  for update;

  if v_status is null then
    raise exception 'No System Administrator invitation found';
  end if;
  if v_status = 'revoked' then
    raise exception 'System Administrator access has been revoked';
  end if;
  if v_status = 'active' then
    return;
  end if;
  if v_status <> 'pending' then
    raise exception 'Invalid System Administrator invitation status';
  end if;

  update public.system_admin_access
  set is_active = true, status = 'active', updated_at = now()
  where admin_user_id = auth.uid() and status = 'pending';

  if not found then
    raise exception 'System Administrator invitation could not be activated';
  end if;

  perform public.system_admin_record_auth_event(
    'LOGIN_SUCCESS',
    'SYSTEM_ADMIN_INVITATION_ACCEPTED',
    jsonb_build_object('source', 'system_admin_invitation')
  );
end;
$function$;

revoke all on function public.system_admin_activate_my_pending_access() from public;
grant execute on function public.system_admin_activate_my_pending_access() to authenticated, postgres;