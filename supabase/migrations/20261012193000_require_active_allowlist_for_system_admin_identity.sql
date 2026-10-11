-- Require current, active allowlisted access in the shared System Admin identity
-- helper. A stale app_metadata role claim plus AAL2 must not preserve access
-- after an administrator has been revoked or deactivated.
create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select auth.uid() is not null
     and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'system_admin'
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1
       from public.system_admin_access a
       where a.admin_user_id = auth.uid()
         and a.is_active = true
         and a.status = 'active'
         and a.access_level in ('owner', 'administrator', 'view_only')
     );
$function$;

revoke all on function public.is_system_admin() from public, anon;
grant execute on function public.is_system_admin() to authenticated;

comment on function public.is_system_admin() is
  'System Admin identity requires AAL2 and active allowlisted access with active status.';
