-- Extend the privileged-session gate to additional tenant-managed data.
-- Public storefront reads remain available because these policies apply only
-- to authenticated requests and the helper exempts customers/non-privileged users.

drop policy if exists "Require MFA for privileged product access" on public.products;
create policy "Require MFA for privileged product access"
on public.products as restrictive for all to authenticated
using (public.privileged_restaurant_mfa_verified())
with check (public.privileged_restaurant_mfa_verified());

drop policy if exists "Require MFA for privileged category access" on public.categories;
create policy "Require MFA for privileged category access"
on public.categories as restrictive for all to authenticated
using (public.privileged_restaurant_mfa_verified())
with check (public.privileged_restaurant_mfa_verified());

drop policy if exists "Require MFA for privileged delivery zone management" on public.restaurant_delivery_zones;
create policy "Require MFA for privileged delivery zone management"
on public.restaurant_delivery_zones as restrictive for all to authenticated
using (public.privileged_restaurant_mfa_verified())
with check (public.privileged_restaurant_mfa_verified());

drop policy if exists "Require MFA for privileged discount beneficiary access" on public.order_discount_beneficiaries;
create policy "Require MFA for privileged discount beneficiary access"
on public.order_discount_beneficiaries as restrictive for all to authenticated
using (public.privileged_restaurant_mfa_verified())
with check (public.privileged_restaurant_mfa_verified());
