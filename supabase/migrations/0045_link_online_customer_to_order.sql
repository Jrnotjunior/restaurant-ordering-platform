-- Link customer accounts from pending online payments to finalized orders.
-- Keeps the existing finalize_online_payment RPC unchanged.

create or replace function public.link_pending_customer_to_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'paid'
     and new.order_id is not null
     and new.customer_id is not null then
    update public.orders
    set customer_id = new.customer_id,
        updated_at = now()
    where id = new.order_id
      and customer_id is null;
  end if;

  return new;
end;
$$;

drop trigger if exists pending_online_payment_link_customer on public.pending_online_payments;
create trigger pending_online_payment_link_customer
after update of status, order_id, customer_id on public.pending_online_payments
for each row
when (new.status = 'paid' and new.order_id is not null and new.customer_id is not null)
execute function public.link_pending_customer_to_order();

revoke all on function public.link_pending_customer_to_order() from public;
