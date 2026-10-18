alter table public.pending_online_payments
  drop constraint if exists pending_online_payments_order_type_check;

alter table public.pending_online_payments
  add constraint pending_online_payments_order_type_check
  check (order_type = any (array['delivery','take_out','pickup','dine_in']::text[]));