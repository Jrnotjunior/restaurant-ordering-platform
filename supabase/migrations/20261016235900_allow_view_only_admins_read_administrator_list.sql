-- View-only System Administrators may read the administrators list.
-- Mutation RPCs remain separately protected by owner authorization.
create or replace function public.system_admin_get_administrators()
returns table(
  id uuid,
  admin_user_id uuid,
  email text,
  name text,
  access_level text,
  is_active boolean,
  status text,
  granted_by uuid,
  granted_by_email text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
begin
  if not exists (
    select 1
    from public.system_admin_access me
    where me.admin_user_id = auth.uid()
      and me.is_active = true
      and me.status = 'active'
      and me.access_level in ('owner', 'administrator', 'view_only')
  ) then
    raise exception 'Active System Administrator authorization required';
  end if;

  return query
  select
    a.id::uuid,
    a.admin_user_id::uuid,
    u.email::text,
    coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      ''
    )::text as name,
    a.access_level::text,
    a.is_active::boolean,
    a.status::text,
    a.granted_by::uuid,
    gu.email::text as granted_by_email,
    a.created_at::timestamptz,
    a.updated_at::timestamptz
  from public.system_admin_access a
  join auth.users u on u.id = a.admin_user_id
  left join auth.users gu on gu.id = a.granted_by
  order by
    case a.access_level
      when 'owner' then 1
      when 'administrator' then 2
      when 'view_only' then 3
      else 4
    end,
    a.created_at asc;
end;
$function$;
revoke all on function public.system_admin_get_administrators() from public;
grant execute on function public.system_admin_get_administrators() to authenticated, service_role;
