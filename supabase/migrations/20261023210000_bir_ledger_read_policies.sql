-- Defense-in-depth read policies for restricted taxpayer and issued-document tables.
-- Direct privileges remain revoked; these policies do not grant access by themselves.
-- No direct INSERT/UPDATE/DELETE policy is defined for authenticated users.

drop policy if exists "Owner and system admin can read taxpayer profiles" on public.restaurant_taxpayer_profiles;
create policy "Owner and system admin can read taxpayer profiles"
on public.restaurant_taxpayer_profiles
for select
to authenticated
using (
  public.is_system_admin()
  or exists (
    select 1 from public.restaurants r
    where r.id = restaurant_taxpayer_profiles.restaurant_id
      and r.owner_id = auth.uid()
  )
);

drop policy if exists "Owner and system admin can read invoice issuance config" on public.restaurant_invoice_issuance_configs;
create policy "Owner and system admin can read invoice issuance config"
on public.restaurant_invoice_issuance_configs
for select
to authenticated
using (
  public.is_system_admin()
  or exists (
    select 1 from public.restaurants r
    where r.id = restaurant_invoice_issuance_configs.restaurant_id
      and r.owner_id = auth.uid()
  )
);

drop policy if exists "Owner and system admin can read issued sales documents" on public.issued_sales_documents;
create policy "Owner and system admin can read issued sales documents"
on public.issued_sales_documents
for select
to authenticated
using (
  public.is_system_admin()
  or exists (
    select 1 from public.restaurants r
    where r.id = issued_sales_documents.restaurant_id
      and r.owner_id = auth.uid()
  )
);

drop policy if exists "Owner and system admin can read issued document events" on public.issued_sales_document_events;
create policy "Owner and system admin can read issued document events"
on public.issued_sales_document_events
for select
to authenticated
using (
  public.is_system_admin()
  or exists (
    select 1 from public.restaurants r
    where r.id = issued_sales_document_events.restaurant_id
      and r.owner_id = auth.uid()
  )
);
