-- Support failed delivery outcomes without treating them as successful payment.
-- The order remains unpaid for COD and records why the delivery failed.

alter table public.orders
  add column if not exists delivery_failure_reason text;

alter table public.orders
  add column if not exists delivery_failed_at timestamptz;

alter table public.orders
  drop constraint if exists orders_delivery_status_check;

alter table public.orders
  add constraint orders_delivery_status_check
  check (delivery_status in ('unassigned', 'assigned', 'delivering', 'arrived', 'delivered', 'failed'));

alter table public.delivery_assignments
  drop constraint if exists delivery_assignments_status_check;

alter table public.delivery_assignments
  add constraint delivery_assignments_status_check
  check (status in ('assigned', 'delivering', 'arrived', 'delivered', 'failed', 'cancelled'));

drop index if exists delivery_assignments_active_order_uidx;

create unique index delivery_assignments_active_order_uidx
  on public.delivery_assignments (order_id)
  where status in ('assigned', 'delivering', 'arrived');

