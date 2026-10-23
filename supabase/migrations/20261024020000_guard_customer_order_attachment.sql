-- Guard customer self-attachment to an order against cross-tenant identities.
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

  if v_customer.auth_user_id = auth.uid()
     and not public.customer_identity_is_single_tenant(auth.uid(), v_order.restaurant_id) then
    raise exception 'Customer account does not belong to this restaurant';
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

revoke all on function public.attach_customer_to_order(uuid, uuid) from public, anon;
grant execute on function public.attach_customer_to_order(uuid, uuid) to authenticated;
