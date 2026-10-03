-- Support multiple saved customer delivery addresses with one default address.

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_profiles(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  label text not null default 'Address',
  city text not null,
  barangay text not null,
  address text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_addresses_customer_idx
  on public.customer_addresses(customer_id);

create index if not exists customer_addresses_restaurant_customer_idx
  on public.customer_addresses(restaurant_id, customer_id);

create unique index if not exists customer_addresses_one_default_idx
  on public.customer_addresses(customer_id)
  where is_default = true;

alter table public.customer_addresses enable row level security;

drop policy if exists customer_addresses_select_own on public.customer_addresses;
create policy customer_addresses_select_own
on public.customer_addresses
for select
to authenticated
using (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
  )
);

drop policy if exists customer_addresses_insert_own on public.customer_addresses;
create policy customer_addresses_insert_own
on public.customer_addresses
for insert
to authenticated
with check (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
  )
);

drop policy if exists customer_addresses_update_own on public.customer_addresses;
create policy customer_addresses_update_own
on public.customer_addresses
for update
to authenticated
using (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
  )
);

drop policy if exists customer_addresses_delete_own on public.customer_addresses;
create policy customer_addresses_delete_own
on public.customer_addresses
for delete
to authenticated
using (
  exists (
    select 1
    from public.customer_profiles cp
    where cp.id = customer_addresses.customer_id
      and cp.auth_user_id = auth.uid()
  )
);

-- Migrate an existing default address into the new address table.
insert into public.customer_addresses (
  customer_id,
  restaurant_id,
  label,
  city,
  barangay,
  address,
  is_default
)
select
  cp.id,
  cp.restaurant_id,
  'Default address',
  cp.default_delivery_city,
  cp.default_delivery_barangay,
  cp.default_delivery_address,
  true
from public.customer_profiles cp
where nullif(trim(cp.default_delivery_city), '') is not null
  and nullif(trim(cp.default_delivery_barangay), '') is not null
  and nullif(trim(cp.default_delivery_address), '') is not null
  and not exists (
    select 1
    from public.customer_addresses ca
    where ca.customer_id = cp.id
  );

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

  return query
  select
    ca.id,
    ca.label,
    ca.city,
    ca.barangay,
    ca.address,
    ca.is_default
  from public.customer_addresses ca
  join public.customer_profiles cp on cp.id = ca.customer_id
  where cp.auth_user_id = auth.uid()
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

revoke all on function public.get_my_customer_addresses(uuid) from public;
grant execute on function public.get_my_customer_addresses(uuid) to authenticated;

revoke all on function public.save_my_customer_address(uuid, text, text, text, text, boolean) from public;
grant execute on function public.save_my_customer_address(uuid, text, text, text, text, boolean) to authenticated;

revoke all on function public.set_my_customer_address_default(uuid, uuid) from public;
grant execute on function public.set_my_customer_address_default(uuid, uuid) to authenticated;

revoke all on function public.delete_my_customer_address(uuid, uuid) from public;
grant execute on function public.delete_my_customer_address(uuid, uuid) to authenticated;

-- Make the profile lookup use the new address table's default.
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

revoke all on function public.get_my_customer_profile(uuid) from public;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;
