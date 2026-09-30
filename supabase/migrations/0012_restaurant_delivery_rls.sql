-- Restaurant delivery operations need direct authenticated access to the
-- delivery-flow tables. The restaurant owner is authorized through the
-- restaurant owner_id relationship.

drop policy if exists "Restaurant owners can read orders" on public.orders;
create policy "Restaurant owners can read orders"
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = orders.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop policy if exists "Restaurant owners can update orders" on public.orders;
create policy "Restaurant owners can update orders"
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = orders.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.restaurants r
    where r.id = orders.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop policy if exists "Restaurant owners can read riders" on public.restaurant_riders;
create policy "Restaurant owners can read riders"
on public.restaurant_riders
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = restaurant_riders.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop policy if exists "Restaurant owners can read rider scopes" on public.rider_delivery_scopes;
create policy "Restaurant owners can read rider scopes"
on public.rider_delivery_scopes
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_riders rr
    join public.restaurants r on r.id = rr.restaurant_id
    where rr.id = rider_delivery_scopes.rider_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

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

drop policy if exists "Restaurant owners can create delivery assignments" on public.delivery_assignments;
create policy "Restaurant owners can create delivery assignments"
on public.delivery_assignments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.restaurants r
    where r.id = delivery_assignments.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop policy if exists "Restaurant owners can update delivery assignments" on public.delivery_assignments;
create policy "Restaurant owners can update delivery assignments"
on public.delivery_assignments
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurants r
    where r.id = delivery_assignments.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.restaurants r
    where r.id = delivery_assignments.restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop policy if exists "Restaurant owners can delete delivery assignments" on public.delivery_assignments;
create policy "Restaurant owners can delete delivery assignments"
on public.delivery_assignments
for delete
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
