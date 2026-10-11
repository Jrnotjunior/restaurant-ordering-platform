-- Keep owner-only System Admin operations aligned with the shared identity
-- helper: an owner row must be both enabled and in active status.
create or replace function public.system_admin_is_owner()
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
         and a.access_level = 'owner'
     );
$function$;

revoke all on function public.system_admin_is_owner() from public, anon;
grant execute on function public.system_admin_is_owner() to authenticated;

comment on function public.system_admin_is_owner() is
  'Owner-only System Admin operations require AAL2 and active allowlisted owner access with active status.';
