-- Guard legacy customer account and attachment RPCs against existing duplicate identities.
-- The trigger blocks new duplicate profiles; these checks also fail closed for legacy duplicates.

create or replace function public.upsert_customer_profile(
  p_restaurant_id uuid,
  p_name text,
  p_phone text default null
)
returns table (customer_id uuid, restaurant_id uuid, name text, phone text)
language plpgsql
security definer
set search_path = public
as $$
declare v_customer_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or exists (
       select 1 from public.customer_profiles cp
       where cp.auth_user_id = auth.uid()
         and cp.restaurant_id <> p_restaurant_id
     ) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;
  if not exists (select 1 from public.restaurants r where r.id = p_restaurant_id and r.is_active = true) then
    raise exception 'Restaurant not found or inactive';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'Customer name is required'; end if;

  insert into public.customer_profiles (restaurant_id, auth_user_id, name, phone)
  values (p_restaurant_id, auth.uid(), trim(p_name), nullif(trim(coalesce(p_phone, '')), ''))
  on conflict (restaurant_id, auth_user_id)
  do update set name = excluded.name, phone = excluded.phone, updated_at = now()
  returning id into v_customer_id;

  insert into public.customer_loyalty_accounts (customer_id)
  values (v_customer_id) on conflict (customer_id) do nothing;

  return query select cp.id, cp.restaurant_id, cp.name, cp.phone
  from public.customer_profiles cp where cp.id = v_customer_id;
end;
$$;
revoke all on function public.upsert_customer_profile(uuid, text, text) from public, anon;
grant execute on function public.upsert_customer_profile(uuid, text, text) to authenticated;

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
  v_staff_authorized boolean := false;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.restaurant_id is null or v_order.restaurant_id <> public.get_request_restaurant_id() then
    raise exception 'Order does not belong to the current restaurant';
  end if;

  select * into v_customer from public.customer_profiles
  where id = p_customer_id and restaurant_id = v_order.restaurant_id;
  if not found then raise exception 'Customer does not belong to this restaurant'; end if;

  v_staff_authorized := exists (
    select 1 from public.restaurants r where r.id = v_order.restaurant_id and (
      r.owner_id = auth.uid() or exists (
        select 1 from public.restaurant_staff s
        where s.restaurant_id = r.id and s.auth_user_id = auth.uid()
          and s.role = 'cashier' and s.is_active = true
      )
    )
  );

  if not v_staff_authorized then
    if v_customer.auth_user_id is distinct from auth.uid()
       or not public.customer_identity_is_single_tenant(auth.uid(), v_order.restaurant_id) then
      raise exception 'You are not authorized to attach this customer';
    end if;
  end if;

  if v_order.customer_id is not null and v_order.customer_id <> p_customer_id then
    raise exception 'A different customer is already attached to this order';
  end if;

  update public.orders set customer_id = p_customer_id, updated_at = now() where id = p_order_id;
end;
$$;
revoke all on function public.attach_customer_to_order(uuid, uuid) from public, anon;
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
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into v_payment from public.pending_online_payments where id = p_payment_id for update;
  if not found then raise exception 'Pending online payment not found'; end if;
  if v_payment.restaurant_id is null or v_payment.restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;
  if v_payment.status <> 'pending' then raise exception 'Online payment is no longer pending'; end if;

  select * into v_customer from public.customer_profiles
  where id = p_customer_id and restaurant_id = v_payment.restaurant_id and auth_user_id = auth.uid();
  if not found then raise exception 'Customer profile not found for this account'; end if;

  update public.pending_online_payments
  set customer_id = p_customer_id, updated_at = now() where id = p_payment_id;
end;
$$;
revoke all on function public.attach_customer_to_pending_online_payment(uuid, uuid) from public, anon;
grant execute on function public.attach_customer_to_pending_online_payment(uuid, uuid) to authenticated;
