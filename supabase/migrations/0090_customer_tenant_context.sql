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
$$$;

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
$$$;

revoke all on function public.upsert_customer_profile(uuid, text, text) from public;
grant execute on function public.upsert_customer_profile(uuid, text, text) to authenticated;


-- Customer self-service RPCs must use the current tenant too.
create or replace function public.get_my_customer_profile(
  p_restaurant_id uuid
)
returns table (
  customer_id uuid,
  name text,
  phone text,
  default_delivery_city text,
  default_delivery_barangay text,
  default_delivery_address text
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
  select
    cp.id,
    cp.name,
    cp.phone,
    ca.city,
    ca.barangay,
    ca.address
  from public.customer_profiles cp
  left join lateral (
    select ca.city, ca.barangay, ca.address
    from public.customer_addresses ca
    where ca.customer_id = cp.id
      and ca.restaurant_id = p_restaurant_id
      and ca.is_default = true
    limit 1
  ) ca on true
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
$$$;


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
  left join public.order_items oi on oi.order_id = o.id
  where p_restaurant_id = public.get_request_restaurant_id()
    and o.restaurant_id = p_restaurant_id
    and o.customer_id in (
      select cp.id
      from public.customer_profiles cp
      where cp.restaurant_id = p_restaurant_id
        and cp.auth_user_id = auth.uid()
    )
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
$$$;


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
$$$;

revoke all on function public.get_my_customer_profile(uuid) from public;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;
revoke all on function public.get_my_loyalty_points(uuid) from public;
grant execute on function public.get_my_loyalty_points(uuid) to authenticated;
revoke all on function public.get_my_order_history(uuid) from public, anon;
grant execute on function public.get_my_order_history(uuid) to authenticated;
revoke all on function public.get_my_customer_addresses(uuid) from public;
grant execute on function public.get_my_customer_addresses(uuid) to authenticated;
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
$$$;

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
$$$;

revoke all on function public.upsert_customer_profile(uuid, text, text) from public;
grant execute on function public.upsert_customer_profile(uuid, text, text) to authenticated;


-- Customer self-service RPCs must use the current tenant too.
create or replace function public.get_my_customer_profile(
  p_restaurant_id uuid
)
returns table (
  customer_id uuid,
  name text,
  phone text,
  default_delivery_city text,
  default_delivery_barangay text,
  default_delivery_address text
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
  select
    cp.id,
    cp.name,
    cp.phone,
    ca.city,
    ca.barangay,
    ca.address
  from public.customer_profiles cp
  left join lateral (
    select ca.city, ca.barangay, ca.address
    from public.customer_addresses ca
    where ca.customer_id = cp.id
      and ca.restaurant_id = p_restaurant_id
      and ca.is_default = true
    limit 1
  ) ca on true
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
$$$;


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
  left join public.order_items oi on oi.order_id = o.id
  where p_restaurant_id = public.get_request_restaurant_id()
    and o.restaurant_id = p_restaurant_id
    and o.customer_id in (
      select cp.id
      from public.customer_profiles cp
      where cp.restaurant_id = p_restaurant_id
        and cp.auth_user_id = auth.uid()
    )
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
$$$;


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
$$$;

revoke all on function public.get_my_customer_profile(uuid) from public;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;
revoke all on function public.get_my_loyalty_points(uuid) from public;
grant execute on function public.get_my_loyalty_points(uuid) to authenticated;
revoke all on function public.get_my_order_history(uuid) from public, anon;
grant execute on function public.get_my_order_history(uuid) to authenticated;
revoke all on function public.get_my_customer_addresses(uuid) from public;
grant execute on function public.get_my_customer_addresses(uuid) to authenticated;


-- Customer data is exposed through tenant-checked SECURITY DEFINER RPCs, not direct table access.
revoke all on table public.customer_profiles from anon, authenticated;
revoke all on table public.customer_loyalty_accounts from anon, authenticated;
revoke all on table public.loyalty_transactions from anon, authenticated;
revoke all on table public.customer_addresses from anon, authenticated;


-- Tenant-check customer/order attachment RPCs as well.
create or replace function public.attach_customer_to_order(
  p_order_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_customer public.customer_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Order does not belong to the current restaurant';
  end if;

  select * into v_customer
  from public.customer_profiles
  where id = p_customer_id
    and restaurant_id = v_order.restaurant_id;

  if not found then
    raise exception 'Customer does not belong to this restaurant';
  end if;

  if not (
    v_customer.auth_user_id = auth.uid()
    or exists (
      select 1
      from public.restaurants r
      where r.id = v_order.restaurant_id
        and (
          r.owner_id = auth.uid()
          or exists (
            select 1
            from public.restaurant_staff s
            where s.restaurant_id = v_order.restaurant_id
              and s.auth_user_id = auth.uid()
              and s.role = 'cashier'
              and s.is_active = true
          )
        )
    )
  ) then
    raise exception 'You are not authorized to attach this customer';
  end if;

  if v_order.customer_id is not null and v_order.customer_id <> p_customer_id then
    raise exception 'A different customer is already attached to this order';
  end if;

  update public.orders
  set customer_id = p_customer_id,
      updated_at = now()
  where id = p_order_id;
end;
$$$;

revoke all on function public.attach_customer_to_order(uuid, uuid) from public;
grant execute on function public.attach_customer_to_order(uuid, uuid) to authenticated;


create or replace function public.attach_customer_to_pending_online_payment(
  p_payment_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.pending_online_payments%rowtype;
  v_customer public.customer_profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select * into v_payment
  from public.pending_online_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Pending online payment not found';
  end if;

  if v_payment.restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Payment does not belong to the current restaurant';
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'Online payment is no longer pending';
  end if;

  select * into v_customer
  from public.customer_profiles
  where id = p_customer_id
    and restaurant_id = v_payment.restaurant_id
    and auth_user_id = auth.uid();

  if not found then
    raise exception 'Customer profile not found for this account';
  end if;

  update public.pending_online_payments
  set customer_id = p_customer_id,
      updated_at = now()
  where id = p_payment_id;
end;
$$$;

revoke all on function public.attach_customer_to_pending_online_payment(uuid, uuid) from public;
grant execute on function public.attach_customer_to_pending_online_payment(uuid, uuid) to authenticated;


create or replace function public.save_my_customer_address(
  p_restaurant_id uuid,
  p_label text,
  p_city text,
  p_barangay text,
  p_address text,
  p_set_default boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_address_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer data does not belong to the current restaurant';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer profile not found';
  end if;

  if length(trim(coalesce(p_city, ''))) = 0
     or length(trim(coalesce(p_barangay, ''))) = 0
     or length(trim(coalesce(p_address, ''))) = 0 then
    raise exception 'City, barangay, and address are required';
  end if;

  if (
    select count(*)
    from public.customer_addresses
    where customer_id = v_customer_id
      and restaurant_id = p_restaurant_id
  ) >= 2 then
    raise exception 'You can save a maximum of 2 addresses.';
  end if;

  if p_set_default then
    update public.customer_addresses
    set is_default = false, updated_at = now()
    where customer_id = v_customer_id
      and restaurant_id = p_restaurant_id;
  end if;

  insert into public.customer_addresses (
    customer_id, restaurant_id, label, city, barangay, address, is_default
  )
  values (
    v_customer_id,
    p_restaurant_id,
    coalesce(nullif(trim(p_label), ''), 'Address'),
    trim(p_city),
    trim(p_barangay),
    trim(p_address),
    p_set_default
  )
  returning id into v_address_id;

  if p_set_default then
    update public.customer_profiles
    set default_delivery_city = trim(p_city),
        default_delivery_barangay = trim(p_barangay),
        default_delivery_address = trim(p_address),
        updated_at = now()
    where id = v_customer_id;
  end if;

  return v_address_id;
end;
$$$;

revoke all on function public.save_my_customer_address(uuid, text, text, text, text, boolean) from public;
grant execute on function public.save_my_customer_address(uuid, text, text, text, text, boolean) to authenticated;


create or replace function public.set_my_customer_address_default(
  p_restaurant_id uuid,
  p_address_id uuid
)
returns void
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

  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer data does not belong to the current restaurant';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer profile not found';
  end if;

  if not exists (
    select 1 from public.customer_addresses ca
    where ca.id = p_address_id
      and ca.customer_id = v_customer_id
      and ca.restaurant_id = p_restaurant_id
  ) then
    raise exception 'Address not found';
  end if;

  update public.customer_addresses
  set is_default = false, updated_at = now()
  where customer_id = v_customer_id
    and restaurant_id = p_restaurant_id;

  update public.customer_addresses
  set is_default = true, updated_at = now()
  where id = p_address_id;

  update public.customer_profiles cp
  set default_delivery_city = ca.city,
      default_delivery_barangay = ca.barangay,
      default_delivery_address = ca.address,
      updated_at = now()
  from public.customer_addresses ca
  where cp.id = v_customer_id
    and ca.id = p_address_id;
end;
$$$;

revoke all on function public.set_my_customer_address_default(uuid, uuid) from public;
grant execute on function public.set_my_customer_address_default(uuid, uuid) to authenticated;


create or replace function public.update_my_customer_address(
  p_restaurant_id uuid,
  p_address_id uuid,
  p_label text,
  p_city text,
  p_barangay text,
  p_address text
)
returns boolean
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

  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer data does not belong to the current restaurant';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer profile not found';
  end if;

  if not exists (
    select 1 from public.customer_addresses ca
    where ca.id = p_address_id
      and ca.customer_id = v_customer_id
      and ca.restaurant_id = p_restaurant_id
  ) then
    raise exception 'Address not found';
  end if;

  if length(trim(coalesce(p_city, ''))) = 0
     or length(trim(coalesce(p_barangay, ''))) = 0
     or length(trim(coalesce(p_address, ''))) = 0 then
    raise exception 'City, barangay, and address are required';
  end if;

  update public.customer_addresses
  set label = coalesce(nullif(trim(p_label), ''), 'Address'),
      city = trim(p_city),
      barangay = trim(p_barangay),
      address = trim(p_address),
      updated_at = now()
  where id = p_address_id
    and customer_id = v_customer_id
    and restaurant_id = p_restaurant_id;

  update public.customer_profiles cp
  set default_delivery_city = ca.city,
      default_delivery_barangay = ca.barangay,
      default_delivery_address = ca.address,
      updated_at = now()
  from public.customer_addresses ca
  where cp.id = v_customer_id
    and ca.id = p_address_id
    and ca.is_default = true;

  return true;
end;
$$$;

revoke all on function public.update_my_customer_address(uuid, uuid, text, text, text, text) from public;
grant execute on function public.update_my_customer_address(uuid, uuid, text, text, text, text) to authenticated;


create or replace function public.delete_my_customer_address(
  p_restaurant_id uuid,
  p_address_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_was_default boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer data does not belong to the current restaurant';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer profile not found';
  end if;

  select ca.is_default into v_was_default
  from public.customer_addresses ca
  where ca.id = p_address_id
    and ca.customer_id = v_customer_id
    and ca.restaurant_id = p_restaurant_id;

  if not found then
    raise exception 'Address not found';
  end if;

  delete from public.customer_addresses
  where id = p_address_id
    and customer_id = v_customer_id
    and restaurant_id = p_restaurant_id;

  if v_was_default then
    update public.customer_addresses ca
    set is_default = true, updated_at = now()
    where ca.id = (
      select ca2.id
      from public.customer_addresses ca2
      where ca2.customer_id = v_customer_id
        and ca2.restaurant_id = p_restaurant_id
      order by ca2.created_at desc
      limit 1
    );

    update public.customer_profiles cp
    set default_delivery_city = ca.city,
        default_delivery_barangay = ca.barangay,
        default_delivery_address = ca.address,
        updated_at = now()
    from public.customer_addresses ca
    where cp.id = v_customer_id
      and ca.customer_id = v_customer_id
      and ca.restaurant_id = p_restaurant_id
      and ca.is_default = true;

    if not exists (
      select 1 from public.customer_addresses ca3
      where ca3.customer_id = v_customer_id
        and ca3.restaurant_id = p_restaurant_id
    ) then
      update public.customer_profiles
      set default_delivery_city = null,
          default_delivery_barangay = null,
          default_delivery_address = null,
          updated_at = now()
      where id = v_customer_id;
    end if;
  end if;
end;
$$$;

revoke all on function public.delete_my_customer_address(uuid, uuid) from public;
grant execute on function public.delete_my_customer_address(uuid, uuid) to authenticated;


create or replace function public.save_my_default_delivery_address(
  p_restaurant_id uuid,
  p_city text,
  p_barangay text,
  p_address text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_address_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer data does not belong to the current restaurant';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer profile not found';
  end if;

  if length(trim(coalesce(p_city, ''))) = 0
     or length(trim(coalesce(p_barangay, ''))) = 0
     or length(trim(coalesce(p_address, ''))) = 0 then
    raise exception 'City, barangay, and complete delivery address are required';
  end if;

  update public.customer_addresses
  set is_default = false, updated_at = now()
  where customer_id = v_customer_id
    and restaurant_id = p_restaurant_id;

  select ca.id into v_address_id
  from public.customer_addresses ca
  where ca.id = (
    select ca2.id
    from public.customer_addresses ca2
    where ca2.customer_id = v_customer_id
      and ca2.restaurant_id = p_restaurant_id
      and lower(trim(ca2.city)) = lower(trim(p_city))
      and lower(trim(ca2.barangay)) = lower(trim(p_barangay))
      and lower(trim(ca2.address)) = lower(trim(p_address))
    order by ca2.created_at desc
    limit 1
  );

  if v_address_id is null then
    insert into public.customer_addresses (
      customer_id, restaurant_id, label, city, barangay, address, is_default
    )
    values (
      v_customer_id, p_restaurant_id, 'Default address',
      trim(p_city), trim(p_barangay), trim(p_address), true
    )
    returning id into v_address_id;
  else
    update public.customer_addresses
    set city = trim(p_city),
        barangay = trim(p_barangay),
        address = trim(p_address),
        is_default = true,
        updated_at = now()
    where id = v_address_id;
  end if;

  update public.customer_profiles
  set default_delivery_city = trim(p_city),
      default_delivery_barangay = trim(p_barangay),
      default_delivery_address = trim(p_address),
      updated_at = now()
  where id = v_customer_id;
end;
$$$;

revoke all on function public.save_my_default_delivery_address(uuid, text, text, text) from public;
grant execute on function public.save_my_default_delivery_address(uuid, text, text, text) to authenticated;