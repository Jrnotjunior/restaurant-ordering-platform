-- Require AAL2 centrally for System Admin authorization helpers.
-- This propagates MFA enforcement to SECURITY DEFINER RPCs that already rely on
-- these helpers, without changing owner, staff, or customer authorization paths.

create or replace function public.system_admin_has_access()
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
         and access_level in ('owner', 'administrator', 'view_only')
     );
$$;

create or replace function public.system_admin_has_manage_access()
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
         and access_level in ('owner', 'administrator')
     );
$$;

revoke all on function public.system_admin_has_access() from public, anon;
grant execute on function public.system_admin_has_access() to authenticated;
revoke all on function public.system_admin_has_manage_access() from public, anon;
grant execute on function public.system_admin_has_manage_access() to authenticated;

comment on function public.system_admin_has_access() is
  'System Admin read access requires active allowlisted access and JWT AAL2.';
comment on function public.system_admin_has_manage_access() is
  'System Admin management access requires active allowlisted access and JWT AAL2.';
