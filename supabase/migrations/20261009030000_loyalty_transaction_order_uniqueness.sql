-- The completed-order loyalty trigger uses ON CONFLICT (order_id, transaction_type).
-- Enforce that idempotency key in production and in future deployments.
create unique index if not exists loyalty_transactions_order_type_unique
  on public.loyalty_transactions (order_id, transaction_type)
  where order_id is not null;
