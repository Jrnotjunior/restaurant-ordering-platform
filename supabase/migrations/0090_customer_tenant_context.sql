-- 0090_customer_tenant_context.sql
-- Enforce the active restaurant tenant for customer-facing profile data.
--
-- The frontend sends the current restaurant hostname (or configured slug)
-- in request headers. PostgREST exposes request headers through
-- current_setting('request.headers', true). The helper resolves that
-- context to an active restaurant.
--
-- A customer may have one profile per restaurant, but the Data API must
-- only expose the profile for the restaurant currently being visited.

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


-- Customer profiles: only the signed-in user's profile for the active tenant.
drop policy if exists "Customers can read own profile" on public.customer_profiles;
create policy "Customers can read own profile"
on public.customer_profiles
for select
to authenticated
using (
  auth_user_id = auth.uid()
  and restaurant_id = public.get_request_restaurant_id()
);

drop policy if exists "Customers can create own profile" on public.customer_profiles;
create policy "Customers can create own profile"
on public.customer_profiles
for insert
to authenticated
with check (
  auth_user_id = auth.uid()
  and restaurant_id = public.get_request_restaurant_id()
);

drop policy if exists "Customers can update own profile" on public.customer_profiles;
create policy "Customers can update own profile"
on public.customer_profiles
for update
to authenticated
using (
  auth_user_id = auth.uid()
  and restaurant_id = public.get_request_restaurant_id()
)
with check (
  auth_user_id = auth.uid()
  and restaurant_id = public.get_request_restaurant_id()
);


-- Loyalty data follows the same tenant boundary.
drop policy if exists "Customers can read own loyalty account" on public.customer_loyalty_accounts;
create policy "Customers can read own loyalty account"
on public.customer_loyalty_accounts
for select
to authenticated
using (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_loyalty_accounts.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = public.get_request_restaurant_id()
  )
);

drop policy if exists "Customers can read own loyalty transactions" on public.loyalty_transactions;
create policy "Customers can read own loyalty transactions"
on public.loyalty_transactions
for select
to authenticated
using (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = loyalty_transactions.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = public.get_request_restaurant_id()
      and loyalty_transactions.restaurant_id = public.get_request_restaurant_id()
  )
);


-- Saved addresses follow both the customer and restaurant boundary.
drop policy if exists customer_addresses_select_own on public.customer_addresses;
create policy customer_addresses_select_own
on public.customer_addresses
for select
to authenticated
using (
  restaurant_id = public.get_request_restaurant_id()
  and exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = public.get_request_restaurant_id()
  )
);

drop policy if exists customer_addresses_insert_own on public.customer_addresses;
create policy customer_addresses_insert_own
on public.customer_addresses
for insert
to authenticated
with check (
  restaurant_id = public.get_request_restaurant_id()
  and exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = public.get_request_restaurant_id()
  )
);

drop policy if exists customer_addresses_update_own on public.customer_addresses;
create policy customer_addresses_update_own
on public.customer_addresses
for update
to authenticated
using (
  restaurant_id = public.get_request_restaurant_id()
  and exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = public.get_request_restaurant_id()
  )
)
with check (
  restaurant_id = public.get_request_restaurant_id()
  and exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = public.get_request_restaurant_id()
  )
);

drop policy if exists customer_addresses_delete_own on public.customer_addresses;
create policy customer_addresses_delete_own
on public.customer_addresses
for delete
to authenticated
using (
  restaurant_id = public.get_request_restaurant_id()
  and exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
      and cp.restaurant_id = public.get_request_restaurant_id()
  )
);


-- Customer profile creation must also be tenant-bound. This RPC is used by
-- signup and remains the trusted path for creating a profile.
create or replace function public.upsert_customer_profile(
  p_restaurant_id uuid,
  p_name text,
  p_phone text default null
)
returns table (
  customer_id uuid,
  restaurant_id uuid,
  name text,
  phone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer account must be created for the current restaurant';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active = true
  ) then
    raise exception 'Restaurant not found or inactive';
  end if;

  if length(trim(coalesce(p_name, ''))) = 0 then
    raise exception 'Customer name is required';
  end if;

  insert into public.customer_profiles (
    restaurant_id,
    auth_user_id,
    name,
    phone
  )
  values (
    p_restaurant_id,
    auth.uid(),
    trim(p_name),
    nullif(trim(coalesce(p_phone, '')), '')
  )
  on conflict (restaurant_id, auth_user_id)
  do update set
    name = excluded.name,
    phone = excluded.phone,
    updated_at = now()
  returning id into v_customer_id;

  insert into public.customer_loyalty_accounts (customer_id)
  values (v_customer_id)
  on conflict (customer_id) do nothing;

  return query
  select cp.id, cp.restaurant_id, cp.name, cp.phone
  from public.customer_profiles cp
  where cp.id = v_customer_id;
end;
$$;

revoke all on function public.upsert_customer_profile(uuid, text, text) from public;
grant execute on function public.upsert_customer_profile(uuid, text, text) to authenticated;


-- Customer self-service RPCs must use the current tenant too.
create or replace function public.get_my_customer_profile(
  p_restaurant_id uuid
)
returns table (
  customer_id uuid,
  name text,
  phone text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer profile does not belong to the current restaurant';
  end if;

  return query
  select cp.id, cp.name, cp.phone
  from public.customer_profiles cp
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;
end;
$$;


create or replace function public.get_my_loyalty_points(
  p_restaurant_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points bigint;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Loyalty account does not belong to the current restaurant';
  end if;

  select coalesce(cla.points_balance, 0)
    into v_points
  from public.customer_profiles cp
  left join public.customer_loyalty_accounts cla
    on cla.customer_id = cp.id
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;

  return coalesce(v_points, 0);
end;
$$;


create or replace function public.get_my_order_history(
  p_restaurant_id uuid
)
returns table (
  order_id uuid,
  order_number text,
  order_type text,
  payment_method text,
  payment_status text,
  status text,
  delivery_status text,
  total numeric,
  created_at timestamptz,
  items jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.id,
    o.order_number,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.status,
    o.delivery_status,
    o.total,
    o.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'productName', oi.product_name,
          'quantity', oi.quantity,
          'unitPrice', oi.unit_price,
          'lineTotal', oi.line_total
        )
        order by oi.created_at, oi.id
      ) filter (where oi.id is not null),
      '[]'::jsonb
    )
  from public.orders o
  where p_restaurant_id = public.get_request_restaurant_id()
    and o.restaurant_id = p_restaurant_id
    and o.customer_id in (
      select cp.id
      from public.customer_profiles cp
      where cp.restaurant_id = p_restaurant_id
        and cp.auth_user_id = auth.uid()
    )
  left join public.order_items oi on oi.order_id = o.id
  group by
    o.id,
    o.order_number,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.status,
    o.delivery_status,
    o.total,
    o.created_at
  order by o.created_at desc;
$$;


-- Address RPCs must reject a restaurant other than the current tenant.
create or replace function public.get_my_customer_addresses(
  p_restaurant_id uuid
)
returns table (
  id uuid,
  label text,
  city text,
  barangay text,
  address text,
  is_default boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Addresses do not belong to the current restaurant';
  end if;

  return query
  select ca.id, ca.label, ca.city, ca.barangay, ca.address, ca.is_default
  from public.customer_addresses ca
  join public.customer_profiles cp on cp.id = ca.customer_id
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
    and ca.restaurant_id = p_restaurant_id
  order by ca.is_default desc, ca.created_at desc;
end;
$$;

revoke all on function public.get_my_customer_profile(uuid) from public;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;
revoke all on function public.get_my_loyalty_points(uuid) from public;
grant execute on function public.get_my_loyalty_points(uuid) to authenticated;
revoke all on function public.get_my_order_history(uuid) from public, anon;
grant execute on function public.get_my_order_history(uuid) to authenticated;
revoke all on function public.get_my_customer_addresses(uuid) from public;
grant execute on function public.get_my_customer_addresses(uuid) to authenticated;
