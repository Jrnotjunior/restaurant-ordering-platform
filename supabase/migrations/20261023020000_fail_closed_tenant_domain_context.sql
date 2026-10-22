-- Fail closed when a tenant storefront hostname does not resolve.
-- Keep slug fallback only for the canonical management host and non-tenant
-- development hosts. Guest checkout remains unaffected; this helper scopes
-- authenticated customer data access.
create or replace function public.get_request_restaurant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_headers jsonb;
  v_domain text;
  v_slug text;
  v_restaurant_id uuid;
begin
  v_headers := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb,
    '{}'::jsonb
  );

  v_domain := lower(btrim(coalesce(v_headers ->> 'x-restaurant-domain', '')));
  v_slug := lower(btrim(coalesce(v_headers ->> 'x-restaurant-slug', '')));

  if v_domain <> '' then
    select r.id
      into v_restaurant_id
    from public.restaurants r
    where r.is_active = true
      and r.custom_domain is not null
      and lower(btrim(r.custom_domain)) = v_domain
    limit 1;

    if v_restaurant_id is not null then
      return v_restaurant_id;
    end if;

    -- Do not allow an unknown or mismatched tenant subdomain to fall back
    -- to a different restaurant selected through x-restaurant-slug.
    if v_domain like '%.web2table.io'
       and v_domain <> 'app.web2table.io' then
      return null;
    end if;
  end if;

  if v_slug <> '' then
    select r.id
      into v_restaurant_id
    from public.restaurants r
    where r.is_active = true
      and lower(r.slug) = v_slug
    limit 1;
  end if;

  return v_restaurant_id;
exception
  when others then
    return null;
end;
$$;

revoke all on function public.get_request_restaurant_id() from public, anon;
grant execute on function public.get_request_restaurant_id() to authenticated;
