-- Require a completed MFA challenge for the one-time System Admin bootstrap.
-- The bootstrap is only available while system_admin_access is empty; adding
-- AAL2 here closes the remaining path that checked the role claim alone.
create or replace function public.system_admin_bootstrap_owner()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if exists (
    select 1
    from public.system_admin_access
  ) then
    raise exception 'System Administrator access has already been initialized';
  end if;

  if coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'system_admin'
     or coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     or auth.uid() is null then
    raise exception 'Initial System Administrator bootstrap requires an authenticated System Administrator session with MFA';
  end if;

  insert into public.system_admin_access (
    admin_user_id,
    access_level,
    is_active,
    status,
    granted_by
  )
  values (
    auth.uid(),
    'owner',
    true,
    'active',
    auth.uid()
  );
end;
$function$;

revoke all on function public.system_admin_bootstrap_owner() from public, anon;
grant execute on function public.system_admin_bootstrap_owner() to authenticated;
