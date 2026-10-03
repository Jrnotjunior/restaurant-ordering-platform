-- 0085_restaurant_custom_domain_resolution.sql
--
-- Resolves an active restaurant from a hostname without exposing the
-- restaurants table directly to anonymous callers.
--
-- This is the application/database lookup layer only. DNS, TLS, and
-- hosting configuration for real custom domains are handled separately.

create or replace function public.resolve_restaurant_by_domain(
  p_hostname text
)
returns table (
  id uuid,
  slug text,
  name text,
  tagline text,
  logo_url text,
  location_text text,
  contact_number text,
  email text,
  is_active boolean,
  custom_domain text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_hostname text;
begin
  v_hostname := lower(btrim(coalesce(p_hostname, '')));

  if v_hostname = '' then
    return;
  end if;

  return query
  select
    r.id,
    r.slug,
    r.name,
    r.tagline,
    r.logo_url,
    r.location_text,
    r.contact_number,
    r.email,
    r.is_active,
    r.custom_domain
  from public.restaurants r
  where r.is_active = true
    and r.custom_domain is not null
    and lower(btrim(r.custom_domain)) = v_hostname
  limit 1;
end;
$$;

revoke all on function public.resolve_restaurant_by_domain(text)
from public;

grant execute on function public.resolve_restaurant_by_domain(text)
to anon, authenticated;
