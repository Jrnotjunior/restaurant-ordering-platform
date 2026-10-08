-- Allow authorized restaurant cashiers to confirm POS cash payments for both dine-in and take-out orders.
-- Customer pickup/online flows are not affected: this RPC remains restricted to cash POS orders.

create or replace function public.confirm_dine_in_payment(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.id = p_order_id
      and r.is_active = true
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1
          from public.restaurant_staff s
          where s.restaurant_id = o.restaurant_id
            and s.auth_user_id = auth.uid()
            and s.role = 'cashier'
            and s.is_active = true
        )
      )
  ) then
    raise exception 'Order not found or you are not authorized to update it';
  end if;

  if not exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.order_type in ('dine_in', 'pickup')
      and o.payment_method = 'cash'
      and o.payment_status = 'pending'
      and o.status = 'pending'
  ) then
    raise exception 'Only unpaid pending POS cash orders can be confirmed';
  end if;

  update public.orders
  set payment_status = 'paid',
      status = 'confirmed',
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.confirm_dine_in_payment(uuid) from public;
grant execute on function public.confirm_dine_in_payment(uuid) to authenticated;
