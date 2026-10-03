-- 0084_system_admin_restaurant_domains.sql
-- Custom domain management for restaurants.
-- One primary custom domain is allowed per restaurant.

alter table public.restaurants
  add column if not exists custom_domain text;

create unique index if not exists restaurants_custom_domain_unique_idx
  on public.restaurants (lower(custom_domain))
  where custom_domain is not null and btrim(custom_domain) <> '';

alter table public.restaurants
  drop constraint if exists restaurants_custom_domain_format;

alter table public.restaurants
  add constraint restaurants_custom_domain_format
  check (
    custom_domain is null
    or (
      custom_domain = lower(btrim(custom_domain))
      and custom_domain !~ '^[a-z]+://'
      and custom_domain !~ '[/?#]'
      and custom_domain ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]+)?$'
    )
  );

create or replace function public.system_admin_set_restaurant_domain(
  p_restaurant_id uuid,
  p_custom_domain text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text;
begin
  if not public.is_system_admin() then
    raise exception 'System Administrator access required.';
  end if;

  v_domain = nullif(lower(btrim(p_custom_domain)), '');

  if v_domain is not null and (
    v_domain ~ '^[a-z]+://'
    or v_domain ~ '[/?#]'
    or v_domain !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]+)?$'
  ) then
    raise exception 'Enter a valid domain such as restaurant.com.';
  end if;

  update public.restaurants
  set custom_domain = v_domain
  where id = p_restaurant_id;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  return v_domain;
exception
  when unique_violation then
    raise exception 'That domain is already assigned to another restaurant.';
end;
$$;

revoke all on function public.system_admin_set_restaurant_domain(uuid, text)
from public, anon;

grant execute on function public.system_admin_set_restaurant_domain(uuid, text)
to authenticated;
