-- Close remaining delivery-assignment scope gaps found during live policy review.
-- Preserve owner visibility while restricting rider rows and updates to the
-- rider's own active restaurant and matching order.

drop policy if exists "Restaurant owners can read delivery assignments" on public.delivery_assignments;
create policy "Restaurant owners can read delivery assignments"
on public.delivery_assignments
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = delivery_assignments.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop policy if exists "Riders can read their assignments" on public.delivery_assignments;
create policy "Riders can read their assignments"
on public.delivery_assignments
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    join public.orders o on o.id = delivery_assignments.order_id
      and o.restaurant_id = delivery_assignments.restaurant_id
    where s.id = delivery_assignments.rider_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
      and s.restaurant_id = delivery_assignments.restaurant_id
      and r.is_active = true
  )
);

drop policy if exists "Riders can update their assignments" on public.delivery_assignments;
create policy "Riders can update their assignments"
on public.delivery_assignments
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    join public.orders o on o.id = delivery_assignments.order_id
      and o.restaurant_id = delivery_assignments.restaurant_id
    where s.id = delivery_assignments.rider_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
      and s.restaurant_id = delivery_assignments.restaurant_id
      and r.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    join public.orders o on o.id = delivery_assignments.order_id
      and o.restaurant_id = delivery_assignments.restaurant_id
    where s.id = delivery_assignments.rider_id
      and s.auth_user_id = auth.uid()
      and s.role = 'rider'
      and s.is_active = true
      and s.restaurant_id = delivery_assignments.restaurant_id
      and r.is_active = true
  )
);
