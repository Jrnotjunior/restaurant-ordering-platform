-- Close remaining System Admin SECURITY DEFINER paths that authorize through
-- is_system_admin() or system_admin_is_owner() rather than the manage/access helpers.

create or replace function public.is_system_admin()
returns boolean
language sql
security definer
stable
set search_path = public, auth, pg_temp
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'system_admin'
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

create or replace function public.system_admin_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'system_admin'
     and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and exists (
       select 1
       from public.system_admin_access
       where admin_user_id = auth.uid()
         and is_active = true
         and access_level = 'owner'
     );
$$;

revoke all on function public.is_system_admin() from public, anon;
grant execute on function public.is_system_admin() to authenticated;
revoke all on function public.system_admin_is_owner() from public, anon;
grant execute on function public.system_admin_is_owner() to authenticated;

comment on function public.is_system_admin() is
  'System Admin identity check requires app_metadata role and JWT AAL2.';
comment on function public.system_admin_is_owner() is
  'System Admin Owner operations require active owner access and JWT AAL2.';
