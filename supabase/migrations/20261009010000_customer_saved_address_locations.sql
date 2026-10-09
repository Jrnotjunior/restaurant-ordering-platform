-- Persist exact map locations for customer saved addresses.
-- Text remains editable for unit/building/landmark details; coordinates identify the delivery point.

alter table public.customer_addresses
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists place_id text;

alter table public.customer_addresses
  drop constraint if exists customer_addresses_latitude_check,
  drop constraint if exists customer_addresses_longitude_check;

alter table public.customer_addresses
  add constraint customer_addresses_latitude_check
    check (latitude is null or latitude between -90 and 90),
  add constraint customer_addresses_longitude_check
    check (longitude is null or longitude between -180 and 180);

create index if not exists customer_addresses_location_idx
  on public.customer_addresses (restaurant_id, latitude, longitude)
  where latitude is not null and longitude is not null;

-- Return exact location data with saved addresses.
-- Drop the previous return shape before recreating it with location columns.
drop function if exists public.get_my_customer_addresses(uuid);

create function public.get_my_customer_addresses(
  p_restaurant_id uuid
)
returns table (
  id uuid,
  label text,
  city text,
  barangay text,
  address text,
  is_default boolean,
  latitude double precision,
  longitude double precision,
  place_id text
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
  select ca.id, ca.label, ca.city, ca.barangay, ca.address, ca.is_default,
         ca.latitude, ca.longitude, ca.place_id
  from public.customer_addresses ca
  join public.customer_profiles cp on cp.id = ca.customer_id
  where cp.auth_user_id = auth.uid()
    and cp.restaurant_id = p_restaurant_id
    and ca.restaurant_id = p_restaurant_id
  order by ca.is_default desc, ca.created_at desc;
end;
$$;

revoke all on function public.get_my_customer_addresses(uuid) from public;
grant execute on function public.get_my_customer_addresses(uuid) to authenticated;

-- Save a new address with an exact map location.
create or replace function public.save_my_customer_address(
  p_restaurant_id uuid,
  p_label text,
  p_city text,
  p_barangay text,
  p_address text,
  p_set_default boolean,
  p_latitude double precision,
  p_longitude double precision,
  p_place_id text
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
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'An exact map location is required';
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
    select count(*) from public.customer_addresses
    where customer_id = v_customer_id and restaurant_id = p_restaurant_id
  ) >= 2 then
    raise exception 'You can save a maximum of 2 addresses.';
  end if;

  if p_set_default then
    update public.customer_addresses
    set is_default = false, updated_at = now()
    where customer_id = v_customer_id and restaurant_id = p_restaurant_id;
  end if;

  insert into public.customer_addresses (
    customer_id, restaurant_id, label, city, barangay, address,
    latitude, longitude, place_id, is_default
  )
  values (
    v_customer_id, p_restaurant_id,
    coalesce(nullif(trim(p_label), ''), 'Address'),
    trim(p_city), trim(p_barangay), trim(p_address),
    p_latitude, p_longitude, nullif(trim(coalesce(p_place_id, '')), ''), p_set_default
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
$$;

revoke all on function public.save_my_customer_address(uuid,text,text,text,text,boolean,double precision,double precision,text) from public;
grant execute on function public.save_my_customer_address(uuid,text,text,text,text,boolean,double precision,double precision,text) to authenticated;

-- Update an address and keep its exact map location synchronized.
create or replace function public.update_my_customer_address(
  p_restaurant_id uuid,
  p_address_id uuid,
  p_label text,
  p_city text,
  p_barangay text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_place_id text
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
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'An exact map location is required';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid() and cp.restaurant_id = p_restaurant_id
  limit 1;

  if v_customer_id is null then raise exception 'Customer profile not found'; end if;

  if not exists (
    select 1 from public.customer_addresses ca
    where ca.id = p_address_id and ca.customer_id = v_customer_id and ca.restaurant_id = p_restaurant_id
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
      latitude = p_latitude,
      longitude = p_longitude,
      place_id = nullif(trim(coalesce(p_place_id, '')), ''),
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
  where cp.id = v_customer_id and ca.id = p_address_id and ca.is_default = true;

  return true;
end;
$$;

revoke all on function public.update_my_customer_address(uuid,uuid,text,text,text,text,double precision,double precision,text) from public;
grant execute on function public.update_my_customer_address(uuid,uuid,text,text,text,text,double precision,double precision,text) to authenticated;

-- Extend the checkout default-address save path so it cannot discard coordinates.
create or replace function public.save_my_default_delivery_address(
  p_restaurant_id uuid,
  p_city text,
  p_barangay text,
  p_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_place_id text
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
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer data does not belong to the current restaurant';
  end if;
  if p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90
     or p_longitude not between -180 and 180 then
    raise exception 'An exact map location is required';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.restaurant_id = p_restaurant_id and cp.auth_user_id = auth.uid()
  limit 1;

  if v_customer_id is null then raise exception 'Customer profile not found'; end if;

  if length(trim(coalesce(p_city, ''))) = 0
     or length(trim(coalesce(p_barangay, ''))) = 0
     or length(trim(coalesce(p_address, ''))) = 0 then
    raise exception 'City, barangay, and complete delivery address are required';
  end if;

  update public.customer_addresses
  set is_default = false, updated_at = now()
  where customer_id = v_customer_id and restaurant_id = p_restaurant_id;

  select ca.id into v_address_id
  from public.customer_addresses ca
  where ca.customer_id = v_customer_id
    and ca.restaurant_id = p_restaurant_id
    and lower(trim(ca.city)) = lower(trim(p_city))
    and lower(trim(ca.barangay)) = lower(trim(p_barangay))
    and lower(trim(ca.address)) = lower(trim(p_address))
  order by ca.created_at desc
  limit 1;

  if v_address_id is null then
    insert into public.customer_addresses (
      customer_id, restaurant_id, label, city, barangay, address,
      latitude, longitude, place_id, is_default
    )
    values (
      v_customer_id, p_restaurant_id, 'Default address',
      trim(p_city), trim(p_barangay), trim(p_address),
      p_latitude, p_longitude, nullif(trim(coalesce(p_place_id, '')), ''), true
    )
    returning id into v_address_id;
  else
    update public.customer_addresses
    set city = trim(p_city),
        barangay = trim(p_barangay),
        address = trim(p_address),
        latitude = p_latitude,
        longitude = p_longitude,
        place_id = nullif(trim(coalesce(p_place_id, '')), ''),
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
$$;

revoke all on function public.save_my_default_delivery_address(uuid,text,text,text,double precision,double precision,text) from public;
grant execute on function public.save_my_default_delivery_address(uuid,text,text,text,double precision,double precision,text) to authenticated;

-- Keep default selection synchronized with the stored coordinates.
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
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer data does not belong to the current restaurant';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.auth_user_id = auth.uid() and cp.restaurant_id = p_restaurant_id
  limit 1;

  if v_customer_id is null then raise exception 'Customer profile not found'; end if;

  if not exists (
    select 1 from public.customer_addresses ca
    where ca.id = p_address_id and ca.customer_id = v_customer_id and ca.restaurant_id = p_restaurant_id
  ) then
    raise exception 'Address not found';
  end if;

  update public.customer_addresses
  set is_default = false, updated_at = now()
  where customer_id = v_customer_id and restaurant_id = p_restaurant_id;

  update public.customer_addresses
  set is_default = true, updated_at = now()
  where id = p_address_id;

  update public.customer_profiles cp
  set default_delivery_city = ca.city,
      default_delivery_barangay = ca.barangay,
      default_delivery_address = ca.address,
      updated_at = now()
  from public.customer_addresses ca
  where cp.id = v_customer_id and ca.id = p_address_id;
end;
$$;

-- Profile lookup now returns the exact default map location too.
-- Drop the previous return shape before recreating it with location columns.
drop function if exists public.get_my_customer_profile(uuid);

create function public.get_my_customer_profile(
  p_restaurant_id uuid
)
returns table (
  customer_id uuid,
  name text,
  phone text,
  default_delivery_city text,
  default_delivery_barangay text,
  default_delivery_address text,
  default_delivery_latitude double precision,
  default_delivery_longitude double precision,
  default_delivery_place_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Customer profile does not belong to the current restaurant';
  end if;

  return query
  select cp.id, cp.name, cp.phone,
         ca.city, ca.barangay, ca.address,
         ca.latitude, ca.longitude, ca.place_id
  from public.customer_profiles cp
  left join lateral (
    select ca.city, ca.barangay, ca.address, ca.latitude, ca.longitude, ca.place_id
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

revoke all on function public.get_my_customer_profile(uuid) from public;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;
