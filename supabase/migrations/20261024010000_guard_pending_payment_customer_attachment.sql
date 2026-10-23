-- Prevent a customer identity with profiles in multiple restaurants from
-- attaching itself to a pending payment in one of those restaurants.
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

  if not public.customer_identity_is_single_tenant(auth.uid(), v_payment.restaurant_id) then
    raise exception 'Customer account does not belong to this restaurant';
  end if;

  select * into v_customer
  from public.customer_profiles
  where id = p_customer_id
    and restaurant_id = v_payment.restaurant_id
    and auth_user_id = auth.uid();

  if not found then
    raise exception 'Customer profile not found for this account';
  end if;

  if v_payment.customer_id is not null and v_payment.customer_id <> p_customer_id then
    raise exception 'A different customer is already attached to this payment';
  end if;

  update public.pending_online_payments
  set customer_id = p_customer_id,
      updated_at = now()
  where id = p_payment_id;
end;
$$;

revoke all on function public.attach_customer_to_pending_online_payment(uuid, uuid) from public, anon;
grant execute on function public.attach_customer_to_pending_online_payment(uuid, uuid) to authenticated;
