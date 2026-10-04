-- Preserve existing restaurant behavior by assigning existing tenants to Full System.
insert into public.restaurant_subscriptions (restaurant_id, package_id, status)
select r.id, 1, 'active'
from public.restaurants r
where not exists (select 1 from public.restaurant_subscriptions s where s.restaurant_id=r.id)
on conflict (restaurant_id) do nothing;

create or replace function public.system_admin_set_restaurant_module_override(
  p_restaurant_id uuid,p_module_key text,p_enabled boolean
)
returns table(module_key text,module_name text,included_by_package boolean,override_enabled boolean,effective_enabled boolean)
language plpgsql security definer set search_path='' as $$
declare v_module public.system_modules%rowtype; v_package_id smallint; v_previous boolean; v_included boolean;
begin
  if not public.system_admin_has_manage_access() then raise exception 'System Administrator manage access required'; end if;
  select * into v_module from public.system_modules where module_key=p_module_key and is_active=true;
  if not found then raise exception 'Invalid or inactive module'; end if;
  select s.package_id into v_package_id from public.restaurant_subscriptions s
  where s.restaurant_id=p_restaurant_id and s.status='active' and (s.expires_at is null or s.expires_at>now());
  if v_package_id is null then raise exception 'Restaurant has no active package'; end if;
  select exists(select 1 from public.system_package_modules pm where pm.package_id=v_package_id and pm.module_key=p_module_key) into v_included;
  if not v_included then raise exception 'Module is not included in the restaurant package'; end if;
  select o.enabled into v_previous from public.restaurant_module_overrides o where o.restaurant_id=p_restaurant_id and o.module_key=p_module_key;
  insert into public.restaurant_module_overrides(restaurant_id,module_key,enabled,updated_at)
  values(p_restaurant_id,p_module_key,p_enabled,now())
  on conflict(restaurant_id,module_key) do update set enabled=excluded.enabled,updated_at=now();
  perform public.system_admin_write_audit_log('ADMIN_ACTION',case when p_enabled then 'Restaurant module enabled' else 'Restaurant module disabled' end,
    p_restaurant_id,'restaurant_module_override',p_restaurant_id,
    jsonb_build_object('module_key',p_module_key,'previous_override',v_previous,'new_override',p_enabled,'package_id',v_package_id));
  return query select v_module.module_key,v_module.name,v_included,p_enabled,p_enabled;
end;
$$;
