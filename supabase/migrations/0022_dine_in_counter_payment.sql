-- Dine-in cash orders are paid at the restaurant counter before entering the kitchen.
-- The cashier confirms payment through the restaurant dashboard.

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
      and r.owner_id = auth.uid()
      and r.is_active = true
  ) then
    raise exception 'Order not found or you are not authorized to update it';
  end if;

  if not exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.order_type = 'dine_in'
      and o.payment_method = 'cash'
      and o.payment_status = 'pending'
      and o.status = 'pending'
  ) then
    raise exception 'Only unpaid pending dine-in cash orders can be confirmed';
  end if;

  update public.orders
  set payment_status = 'paid', status = 'confirmed', updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.confirm_dine_in_payment(uuid) from public;
grant execute on function public.confirm_dine_in_payment(uuid) to authenticated;
