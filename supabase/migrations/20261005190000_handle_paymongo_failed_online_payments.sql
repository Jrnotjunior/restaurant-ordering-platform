-- Mark PayMongo checkout attempts as failed/expired without creating restaurant orders.

create or replace function public.mark_pending_online_payment_status(
  p_reference_number text,
  p_status text
)
returns table (
  status text,
  order_number text,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.pending_online_payments%rowtype;
begin
  if p_status not in ('failed', 'expired', 'cancelled') then
    raise exception 'Invalid online payment status';
  end if;

  select *
    into v_payment
  from public.pending_online_payments
  where reference_number = trim(p_reference_number)
  for update;

  if not found then
    raise exception 'Pending online payment not found';
  end if;

  if v_payment.status = 'paid' then
    return query
    select v_payment.status, o.order_number, v_payment.total
    from public.orders o
    where o.id = v_payment.order_id;
    return;
  end if;

  if v_payment.status <> 'pending' then
    return query
    select v_payment.status, null::text, v_payment.total;
    return;
  end if;

  update public.pending_online_payments
  set status = p_status,
      updated_at = now()
  where id = v_payment.id;

  return query
  select p_status, null::text, v_payment.total;
end;
$$;

revoke execute on function public.mark_pending_online_payment_status(text, text) from public, anon, authenticated;
grant execute on function public.mark_pending_online_payment_status(text, text) to service_role;
