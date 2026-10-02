-- Customer order tracking realtime notifications.
-- Sends only the order number and delivery status to the customer-specific
-- realtime topic. The client then reloads the protected order-status RPC.

create or replace function public.notify_customer_order_changed()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'order_number', NEW.order_number,
      'delivery_status', NEW.delivery_status,
      'status', NEW.status
    ),
    'customer_order_changed',
    'customer-order:' || NEW.order_number::text,
    false
  );

  return NEW;
end;
$$;

drop trigger if exists orders_customer_realtime_trigger
on public.orders;

create trigger orders_customer_realtime_trigger
after update of delivery_status, status, payment_status
on public.orders
for each row
execute function public.notify_customer_order_changed();
