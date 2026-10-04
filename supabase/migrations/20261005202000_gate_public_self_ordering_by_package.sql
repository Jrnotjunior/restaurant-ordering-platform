-- Gate public customer ordering by the restaurant's active package and ordering setting.
create or replace function public.restaurant_public_self_ordering_enabled(
  p_restaurant_id uuid
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.restaurants r
    join public.restaurant_subscriptions s on s.restaurant_id = r.id
    join public.system_package_modules pm on pm.package_id = s.package_id
    join public.system_modules m on m.module_key = pm.module_key
    left join public.restaurant_module_overrides o
      on o.restaurant_id = r.id
     and o.module_key = m.module_key
    where r.id = p_restaurant_id
      and r.is_active = true
      and r.ordering_enabled = true
      and s.status = 'active'
      and (s.expires_at is null or s.expires_at > now())
      and m.module_key = 'self_ordering'
      and m.is_active = true
      and coalesce(o.enabled, true) = true
  );
$$;

revoke execute on function public.restaurant_public_self_ordering_enabled(uuid) from public;
grant execute on function public.restaurant_public_self_ordering_enabled(uuid) to anon, authenticated;
