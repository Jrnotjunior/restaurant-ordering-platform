-- Remove legacy permissive policies that bypass tenant-scoped RLS checks.
-- PostgreSQL combines permissive policies with OR, so adding a narrower
-- policy does not constrain access while an unrestricted policy remains.

drop policy if exists "Public can view categories" on public.categories;
drop policy if exists "Public can view products" on public.products;
drop policy if exists "Public can view restaurants" on public.restaurants;

-- Delivery assignments must be scoped to an active dispatcher, an assigned
-- active rider, or the restaurant owner for read-only operational visibility.
drop policy if exists "restaurant can create delivery assignments" on public.delivery_assignments;
drop policy if exists "restaurant can read delivery assignments" on public.delivery_assignments;
drop policy if exists "restaurant can update delivery assignments" on public.delivery_assignments;

-- Keep customer data scoped to the signed-in customer and current restaurant.
-- The older duplicate policies checked only auth_user_id and could bypass
-- restaurant-context checks from the newer policies.
drop policy if exists customer_profiles_select_own on public.customer_profiles;
drop policy if exists customer_loyalty_accounts_select_own on public.customer_loyalty_accounts;
drop policy if exists loyalty_transactions_select_own on public.loyalty_transactions;

-- Storefront customization is public content, but only for active restaurants.
drop policy if exists "website customization public read" on public.restaurant_website_customizations;
create policy "website customization public read"
on public.restaurant_website_customizations
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = restaurant_website_customizations.restaurant_id
      and r.is_active = true
  )
);
