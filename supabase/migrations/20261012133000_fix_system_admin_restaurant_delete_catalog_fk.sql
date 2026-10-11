-- Fix System Admin restaurant deletion when products reference categories.
-- Preserve the existing safety checks: restaurants with orders or pending
-- online payments remain non-deletable. Products are tenant-owned catalog
-- data and must be removed before categories because the category FK is RESTRICT.
create or replace function public.system_admin_delete_restaurant(p_restaurant_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner_id uuid;
begin
  if auth.uid() is null or not public.system_admin_has_manage_access() then
    raise exception 'System Administrator access is required';
  end if;

  select r.owner_id
    into v_owner_id
  from public.restaurants r
  where r.id = p_restaurant_id
  for update;

  if not found then
    raise exception 'Restaurant not found';
  end if;

  if exists (
    select 1
    from public.orders
    where restaurant_id = p_restaurant_id
  ) then
    raise exception 'Restaurant cannot be deleted because it has existing orders';
  end if;

  if exists (
    select 1
    from public.pending_online_payments
    where restaurant_id = p_restaurant_id
  ) then
    raise exception 'Restaurant cannot be deleted because it has pending online payments';
  end if;

  delete from public.system_admin_audit_logs
  where restaurant_id = p_restaurant_id;

  delete from public.system_api_usage_events
  where restaurant_id = p_restaurant_id;

  delete from public.paymongo_webhook_events
  where restaurant_id = p_restaurant_id;

  delete from public.tenant_invitations
  where restaurant_id = p_restaurant_id;

  -- products.category_id references categories with ON DELETE RESTRICT,
  -- so remove the restaurant's products before restaurant-owned categories.
  -- order_items.product_id uses ON DELETE SET NULL; order-bearing restaurants
  -- are already blocked above to preserve operational history.
  delete from public.products
  where restaurant_id = p_restaurant_id;

  -- Restaurant-owned categories and other CASCADE children are now safe to
  -- remove. Existing orders/payments remain protected by the checks above.
  delete from public.restaurants
  where id = p_restaurant_id;

  return v_owner_id;
end;
$$;

revoke all on function public.system_admin_delete_restaurant(uuid)
from public, anon, authenticated;

grant execute on function public.system_admin_delete_restaurant(uuid)
to authenticated;