-- Add an explicit arrival stage so cash collection is only available
-- after the rider reaches the customer.

alter table public.orders
  drop constraint if exists orders_delivery_status_check;

alter table public.orders
  add constraint orders_delivery_status_check
  check (delivery_status in ('unassigned', 'assigned', 'delivering', 'arrived', 'delivered'));

alter table public.delivery_assignments
  drop constraint if exists delivery_assignments_status_check;

alter table public.delivery_assignments
  add constraint delivery_assignments_status_check
  check (status in ('assigned', 'delivering', 'arrived', 'delivered', 'cancelled'));

drop index if exists delivery_assignments_active_order_uidx;

create unique index delivery_assignments_active_order_uidx
  on public.delivery_assignments (order_id)
  where status in ('assigned', 'delivering', 'arrived');
