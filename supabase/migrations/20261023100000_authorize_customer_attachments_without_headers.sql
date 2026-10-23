-- Authorize customer attachment from database-owned order/customer relationships.
-- Do not use get_request_restaurant_id() here: it currently derives tenant context
-- from caller-supplied headers, which are not an authorization boundary.

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

  if v_order.restaurant_id is null then
    raise exception 'Order has no restaurant';
  end if;

  select * into v_customer
  from public.customer_profiles
  where id = p_customer_id
    and restaurant_id = v_order.restaurant_id;

  if not found then
    raise exception 'Customer does not belong to this restaurant';
  end if;

  v_staff_authorized := exists (
    select 1
    from public.restaurants r
    where r.id = v_order.restaurant_id
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

  update public.orders
  set customer_id = p_customer_id, updated_at = now()
  where id = p_order_id;
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

  if v_payment.restaurant_id is null
     or not public.customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
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
  set customer_id = p_customer_id, updated_at = now()
  where id = p_payment_id;
end;
$$;

revoke all on function public.attach_customer_to_pending_online_payment(uuid, uuid) from public, anon;
grant execute on function public.attach_customer_to_pending_online_payment(uuid, uuid) to authenticated;
