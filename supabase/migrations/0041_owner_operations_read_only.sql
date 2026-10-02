-- Keep Store Owner access to operational visibility while reserving
-- operational order/dispatch mutations for the responsible staff roles.
--
-- Owners can still SELECT orders, riders, and delivery assignments through
-- the existing owner policies. This migration removes only mutation rights
-- from the owner policies.

drop policy if exists "Restaurant owners can update orders" on public.orders;

drop policy if exists "Restaurant owners can create delivery assignments" on public.delivery_assignments;
drop policy if exists "Restaurant owners can update delivery assignments" on public.delivery_assignments;
drop policy if exists "Restaurant owners can delete delivery assignments" on public.delivery_assignments;
