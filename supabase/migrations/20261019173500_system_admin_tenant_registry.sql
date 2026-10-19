-- Parent SaaS tenant registry APIs.
-- These are read-only admin functions; domain/package mutations continue to use
-- the existing separately authorized and audited management RPCs.

create or replace function public.system_admin_get_tenant_registry()
returns table (
  restaurant_id uuid,
  slug text,
  restaurant_name text,
  custom_domain text,
  is_active boolean,
  created_at timestamptz,
  package_id smallint,
  package_name text,
  subscription_status text,
  subscription_expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.system_admin_has_access() then
    raise exception 'System Administrator authorization required';
  end if;

  return query
  select
    r.id,
    r.slug,
    r.name,
    r.custom_domain,
    r.is_active,
    r.created_at,
    s.package_id,
    p.name,
    s.status,
    s.expires_at
  from public.restaurants r
  left join public.restaurant_subscriptions s on s.restaurant_id = r.id
  left join public.system_packages p on p.id = s.package_id
  order by r.created_at desc, r.name asc;
end;
$function$;

revoke all on function public.system_admin_get_tenant_registry() from public, anon;
grant execute on function public.system_admin_get_tenant_registry() to authenticated;

create or replace function public.system_admin_get_available_packages()
returns table (
  id smallint,
  package_key text,
  name text,
  description text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.system_admin_has_access() then
    raise exception 'System Administrator authorization required';
  end if;

  return query
  select p.id, p.package_key, p.name, p.description
  from public.system_packages p
  where p.is_active = true
  order by p.id;
end;
$function$;

revoke all on function public.system_admin_get_available_packages() from public, anon;
grant execute on function public.system_admin_get_available_packages() to authenticated;

notify pgrst, 'reload schema';
