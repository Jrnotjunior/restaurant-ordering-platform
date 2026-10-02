-- Keep sold-out products visible to customers.
-- Customers can see active restaurant products regardless of availability,
-- while unavailable products remain non-orderable in the UI.

drop policy if exists "Public can view available products" on public.products;

create policy "Public can view active products"
on public.products
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = products.restaurant_id
      and r.is_active = true
  )
);
