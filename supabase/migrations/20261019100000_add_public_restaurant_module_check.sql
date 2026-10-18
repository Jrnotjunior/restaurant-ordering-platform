create or replace function public.public_restaurant_has_module(p_restaurant_id uuid, p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_module_key <> 'dispatch_delivery' then false
    else coalesce((
      select o.enabled
      from public.restaurant_module_overrides o
      where o.restaurant_id = p_restaurant_id
        and o.module_key = p_module_key
    ), exists (
      select 1
      from public.restaurant_subscriptions s
      join public.system_package_modules pm on pm.package_id = s.package_id
      join public.system_modules m on m.module_key = pm.module_key
      where s.restaurant_id = p_restaurant_id
        and s.status = 'active'
        and (s.expires_at is null or s.expires_at > now())
        and m.module_key = p_module_key
        and m.is_active = true
    ))
  end;
$function$;

revoke all on function public.public_restaurant_has_module(uuid, text) from public;
grant execute on function public.public_restaurant_has_module(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
