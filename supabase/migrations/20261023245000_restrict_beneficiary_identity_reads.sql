-- Beneficiary name/address/TIN are sensitive statutory-discount data.
-- Restrict direct table reads to restaurant owners and active cashiers only.
drop policy if exists "Restaurant owners can read order discount beneficiaries"
on public.order_discount_beneficiaries;

create policy "Owners and active cashiers can read order discount beneficiaries"
on public.order_discount_beneficiaries
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.id = order_discount_beneficiaries.order_id
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1
          from public.restaurant_staff s
          where s.restaurant_id = r.id
            and s.auth_user_id = auth.uid()
            and s.role = 'cashier'
            and s.is_active = true
        )
      )
  )
);
