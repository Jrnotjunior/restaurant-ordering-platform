-- Close SECURITY DEFINER customer RPC paths for pre-existing duplicate tenant identities.
-- These checks complement the profile RLS policies and the insert/update trigger.

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

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
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

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
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
  left join public.order_items oi on oi.order_id = o.id
  where p_restaurant_id = public.get_request_restaurant_id()
    and public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)
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
$$;

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

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
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

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;

  select cp.id
  into v_customer_id
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
    set is_default = false,
        updated_at = now()
    where customer_id = v_customer_id
      and restaurant_id = p_restaurant_id;
  end if;

  insert into public.customer_addresses (
    customer_id,
    restaurant_id,
    label,
    city,
    barangay,
    address,
    is_default
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
    set
      default_delivery_city = trim(p_city),
      default_delivery_barangay = trim(p_barangay),
      default_delivery_address = trim(p_address),
      updated_at = now()
    where id = v_customer_id;
  end if;

  return v_address_id;
end;
$$;

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

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;

  select cp.id
  into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
  limit 1;

  if v_customer_id is null then
    raise exception 'Customer profile not found';
  end if;

  if not exists (
    select 1
    from public.customer_addresses ca
    where ca.id = p_address_id
      and ca.customer_id = v_customer_id
      and ca.restaurant_id = p_restaurant_id
  ) then
    raise exception 'Address not found';
  end if;

  update public.customer_addresses
  set is_default = false,
      updated_at = now()
  where customer_id = v_customer_id
    and restaurant_id = p_restaurant_id;

  update public.customer_addresses
  set is_default = true,
      updated_at = now()
  where id = p_address_id;

  update public.customer_profiles cp
  set
    default_delivery_city = ca.city,
    default_delivery_barangay = ca.barangay,
    default_delivery_address = ca.address,
    updated_at = now()
  from public.customer_addresses ca
  where cp.id = v_customer_id
    and ca.id = p_address_id;
end;
$$;

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

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;

  select cp.id
  into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
  limit 1;

  select ca.is_default
  into v_was_default
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
    set is_default = true,
        updated_at = now()
    where ca.id = (
      select ca2.id
      from public.customer_addresses ca2
      where ca2.customer_id = v_customer_id
        and ca2.restaurant_id = p_restaurant_id
      order by ca2.created_at desc
      limit 1
    );

    update public.customer_profiles cp
    set
      default_delivery_city = ca.city,
      default_delivery_barangay = ca.barangay,
      default_delivery_address = ca.address,
      updated_at = now()
    from public.customer_addresses ca
    where cp.id = v_customer_id
      and ca.customer_id = v_customer_id
      and ca.is_default = true;

    if not exists (
      select 1 from public.customer_addresses ca3
      where ca3.customer_id = v_customer_id
        and ca3.restaurant_id = p_restaurant_id
    ) then
      update public.customer_profiles
      set
        default_delivery_city = null,
        default_delivery_barangay = null,
        default_delivery_address = null,
        updated_at = now()
      where id = v_customer_id;
    end if;
  end if;
end;
$$;

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

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;

  select cp.id
  into v_customer_id
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
  set is_default = false,
      updated_at = now()
  where customer_id = v_customer_id
    and restaurant_id = p_restaurant_id;

  select ca.id
  into v_address_id
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
      customer_id,
      restaurant_id,
      label,
      city,
      barangay,
      address,
      is_default
    )
    values (
      v_customer_id,
      p_restaurant_id,
      'Default address',
      trim(p_city),
      trim(p_barangay),
      trim(p_address),
      true
    )
    returning id into v_address_id;
  else
    update public.customer_addresses
    set
      city = trim(p_city),
      barangay = trim(p_barangay),
      address = trim(p_address),
      is_default = true,
      updated_at = now()
    where id = v_address_id;
  end if;

  update public.customer_profiles
  set
    default_delivery_city = trim(p_city),
    default_delivery_barangay = trim(p_barangay),
    default_delivery_address = trim(p_address),
    updated_at = now()
  where id = v_customer_id;
end;
$$;
