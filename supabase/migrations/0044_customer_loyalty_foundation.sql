-- Customer loyalty foundation
-- Adds optional customer accounts and owner-configurable loyalty rules
-- without changing the existing guest order creation RPC signatures.

alter table public.restaurants
  add column if not exists loyalty_enabled boolean not null default false,
  add column if not exists loyalty_amount_threshold numeric(12,2) not null default 500.00,
  add column if not exists loyalty_points_awarded integer not null default 5;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_loyalty_amount_threshold_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_loyalty_amount_threshold_check
      check (loyalty_amount_threshold > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'restaurants_loyalty_points_awarded_check'
      and conrelid = 'public.restaurants'::regclass
  ) then
    alter table public.restaurants
      add constraint restaurants_loyalty_points_awarded_check
      check (loyalty_points_awarded > 0);
  end if;
end $$;

create table if not exists public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_profiles_name_not_empty check (length(trim(name)) > 0),
  constraint customer_profiles_phone_not_empty check (length(trim(phone)) > 0),
  constraint customer_profiles_restaurant_user_unique unique (restaurant_id, auth_user_id)
);

create unique index if not exists customer_profiles_restaurant_phone_uidx
  on public.customer_profiles (restaurant_id, lower(trim(phone)));

create index if not exists customer_profiles_restaurant_idx
  on public.customer_profiles (restaurant_id, created_at desc);

alter table public.orders
  add column if not exists customer_id uuid references public.customer_profiles(id) on delete set null;

create index if not exists orders_customer_idx
  on public.orders (customer_id, created_at desc);

alter table public.pending_online_payments
  add column if not exists customer_id uuid references public.customer_profiles(id) on delete set null;

create index if not exists pending_online_payments_customer_idx
  on public.pending_online_payments (customer_id, created_at desc);

create table if not exists public.customer_loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customer_profiles(id) on delete cascade,
  points_balance bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_loyalty_accounts_balance_check check (points_balance >= 0)
);

create table if not exists public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_id uuid not null references public.customer_profiles(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  transaction_type text not null,
  points integer not null,
  eligible_amount numeric(12,2),
  rule_amount_threshold numeric(12,2),
  rule_points_awarded integer,
  description text not null default '',
  created_at timestamptz not null default now(),
  constraint loyalty_transactions_type_check
    check (transaction_type in ('earn', 'reversal')),
  constraint loyalty_transactions_points_check
    check (points <> 0),
  constraint loyalty_transactions_amount_check
    check (eligible_amount is null or eligible_amount >= 0),
  constraint loyalty_transactions_threshold_check
    check (rule_amount_threshold is null or rule_amount_threshold > 0),
  constraint loyalty_transactions_rule_points_check
    check (rule_points_awarded is null or rule_points_awarded > 0)
);

create unique index if not exists loyalty_transactions_order_type_uidx
  on public.loyalty_transactions (order_id, transaction_type)
  where order_id is not null;

create index if not exists loyalty_transactions_customer_idx
  on public.loyalty_transactions (customer_id, created_at desc);

create index if not exists loyalty_transactions_restaurant_idx
  on public.loyalty_transactions (restaurant_id, created_at desc);

alter table public.customer_profiles enable row level security;
alter table public.customer_loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;

grant select, insert, update on table public.customer_profiles to authenticated;
grant select on table public.customer_loyalty_accounts to authenticated;
grant select on table public.loyalty_transactions to authenticated;

drop policy if exists "Customers can read own profile" on public.customer_profiles;
create policy "Customers can read own profile"
on public.customer_profiles
for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists "Customers can create own profile" on public.customer_profiles;
create policy "Customers can create own profile"
on public.customer_profiles
for insert
to authenticated
with check (auth_user_id = auth.uid());

drop policy if exists "Customers can update own profile" on public.customer_profiles;
create policy "Customers can update own profile"
on public.customer_profiles
for update
to authenticated
using (auth_user_id = auth.uid())
with check (auth_user_id = auth.uid());

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
  )
);

drop trigger if exists customer_profiles_set_updated_at on public.customer_profiles;
create trigger customer_profiles_set_updated_at
before update on public.customer_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists customer_loyalty_accounts_set_updated_at on public.customer_loyalty_accounts;
create trigger customer_loyalty_accounts_set_updated_at
before update on public.customer_loyalty_accounts
for each row
execute function public.set_updated_at();

-- Create or update the signed-in customer's restaurant profile.
create or replace function public.upsert_customer_profile(
  p_restaurant_id uuid,
  p_name text,
  p_phone text
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

  if p_restaurant_id is null then
    raise exception 'Restaurant is required';
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

  if length(trim(coalesce(p_phone, ''))) = 0 then
    raise exception 'Phone number is required';
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
    trim(p_phone)
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

-- Secure POS lookup by phone. Only the restaurant owner or an active cashier
-- may use this function.
create or replace function public.find_customer_by_phone(
  p_restaurant_id uuid,
  p_phone text
)
returns table (
  customer_id uuid,
  name text,
  phone text,
  points_balance bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active = true
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1
          from public.restaurant_staff s
          where s.restaurant_id = r.id
            and s.auth_user_id = auth.uid()
            and s.role = 'cashier'
            and s.is_active = true
        )
      )
  ) then
    raise exception 'You are not authorized to look up customers for this restaurant';
  end if;

  return query
  select
    cp.id,
    cp.name,
    cp.phone,
    coalesce(cla.points_balance, 0)
  from public.customer_profiles cp
  left join public.customer_loyalty_accounts cla
    on cla.customer_id = cp.id
  where cp.restaurant_id = p_restaurant_id
    and lower(trim(cp.phone)) = lower(trim(coalesce(p_phone, '')))
  limit 1;
end;
$$;

revoke all on function public.find_customer_by_phone(uuid, text) from public;
grant execute on function public.find_customer_by_phone(uuid, text) to authenticated;

-- Attach a registered customer to an already-created POS/online order.
-- Keeping this separate preserves the existing guest checkout RPC signature.
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
$$;

revoke all on function public.attach_customer_to_order(uuid, uuid) from public;
grant execute on function public.attach_customer_to_order(uuid, uuid) to authenticated;

-- Attach a signed-in customer to a pending online payment before PayMongo checkout.
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
$$;

revoke all on function public.attach_customer_to_pending_online_payment(uuid, uuid) from public;
grant execute on function public.attach_customer_to_pending_online_payment(uuid, uuid) to authenticated;

-- Award points exactly once when a linked customer's order becomes completed.
create or replace function public.award_loyalty_points_on_order_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
  v_eligible_amount numeric(12,2);
  v_points bigint;
begin
  if old.status = 'completed' or new.status <> 'completed' or new.customer_id is null then
    return new;
  end if;

  select * into v_restaurant
  from public.restaurants
  where id = new.restaurant_id;

  if not found or not v_restaurant.loyalty_enabled then
    return new;
  end if;

  if v_restaurant.loyalty_amount_threshold <= 0
     or v_restaurant.loyalty_points_awarded <= 0 then
    return new;
  end if;

  -- POS orders have a finalized tax_net_sales snapshot, which is already
  -- after the POS discount and before VAT. Other orders use subtotal minus
  -- any stored discount, with delivery excluded.
  v_eligible_amount :=
    case
      when coalesce(new.tax_net_sales, 0) > 0
        then round(new.tax_net_sales, 2)
      else greatest(
        round(new.subtotal - coalesce(new.discount_amount, 0), 2),
        0
      )
    end;

  v_points :=
    floor(v_eligible_amount / v_restaurant.loyalty_amount_threshold)
    * v_restaurant.loyalty_points_awarded;

  if v_points <= 0 then
    return new;
  end if;

  insert into public.customer_loyalty_accounts (customer_id, points_balance)
  values (new.customer_id, v_points)
  on conflict (customer_id)
  do update set
    points_balance = public.customer_loyalty_accounts.points_balance + excluded.points_balance,
    updated_at = now();

  insert into public.loyalty_transactions (
    restaurant_id,
    customer_id,
    order_id,
    transaction_type,
    points,
    eligible_amount,
    rule_amount_threshold,
    rule_points_awarded,
    description
  )
  values (
    new.restaurant_id,
    new.customer_id,
    new.id,
    'earn',
    v_points,
    v_eligible_amount,
    v_restaurant.loyalty_amount_threshold,
    v_restaurant.loyalty_points_awarded,
    'Points earned from completed order ' || new.order_number
  )
  on conflict (order_id, transaction_type) do nothing;

  return new;
end;
$$;

drop trigger if exists orders_award_loyalty_on_completed on public.orders;
create trigger orders_award_loyalty_on_completed
after update of status, customer_id on public.orders
for each row
when (new.status = 'completed' and new.customer_id is not null)
execute function public.award_loyalty_points_on_order_completed();

revoke all on function public.award_loyalty_points_on_order_completed() from public;

-- Keep customer-facing reads limited to the customer's own profile/history.
-- Trusted database logic above is responsible for changing balances.
