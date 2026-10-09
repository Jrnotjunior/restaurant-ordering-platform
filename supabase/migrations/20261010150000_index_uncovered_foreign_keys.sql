-- Add indexes for foreign-key columns identified by the live Supabase performance advisor.
-- These indexes support joins and parent-row updates/deletes; they do not change row access or business logic.

create index if not exists idx_customer_profiles_auth_user_id
  on public.customer_profiles (auth_user_id);

create index if not exists idx_loyalty_transactions_customer_id
  on public.loyalty_transactions (customer_id);

create index if not exists idx_loyalty_transactions_restaurant_id
  on public.loyalty_transactions (restaurant_id);

create index if not exists idx_order_items_product_id
  on public.order_items (product_id);

create index if not exists idx_pending_online_payments_order_id
  on public.pending_online_payments (order_id);

create index if not exists idx_pending_online_payments_restaurant_id
  on public.pending_online_payments (restaurant_id);

create index if not exists idx_products_category_restaurant
  on public.products (category_id, restaurant_id);

create index if not exists idx_system_admin_access_granted_by
  on public.system_admin_access (granted_by);

create index if not exists idx_system_package_modules_module_key
  on public.system_package_modules (module_key);

create index if not exists idx_tenant_invitations_restaurant_id
  on public.tenant_invitations (restaurant_id);
