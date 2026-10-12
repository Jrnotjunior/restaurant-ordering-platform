-- Customer profile creation must go through the validated registration RPC.
-- Authenticated users must not be able to insert a customer profile directly.
drop policy if exists "Customers can create own profile" on public.customer_profiles;
revoke insert on table public.customer_profiles from anon, authenticated;
