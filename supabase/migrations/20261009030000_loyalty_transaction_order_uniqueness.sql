-- The completed-order loyalty trigger uses ON CONFLICT (order_id, transaction_type).
-- PostgreSQL requires a non-partial unique index for that conflict target.
create unique index if not exists loyalty_transactions_order_type_unique
  on public.loyalty_transactions (order_id, transaction_type);
