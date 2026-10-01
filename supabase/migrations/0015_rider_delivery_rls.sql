-- Allow riders to read and update only deliveries assigned to their own rider profile.

drop policy if exists "Riders can read their orders" on public.orders;
create policy "Riders can read their orders"
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_riders rr
    where rr.id = orders.rider_id
      and rr.auth_user_id = auth.uid()
  )
);

drop policy if exists "Riders can update their orders" on public.orders;
create policy "Riders can update their orders"
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurant_riders rr
    where rr.id = orders.rider_id
      and rr.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.restaurant_riders rr
    where rr.id = orders.rider_id
      and rr.auth_user_id = auth.uid()
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
    from public.restaurant_riders rr
    where rr.id = delivery_assignments.rider_id
      and rr.auth_user_id = auth.uid()
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
    from public.restaurant_riders rr
    where rr.id = delivery_assignments.rider_id
      and rr.auth_user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.restaurant_riders rr
    where rr.id = delivery_assignments.rider_id
      and rr.auth_user_id = auth.uid()
  )
);

drop policy if exists "Riders can read their profile" on public.restaurant_riders;
create policy "Riders can read their profile"
on public.restaurant_riders
for select
to authenticated
using (
  auth_user_id = auth.uid()
);

drop policy if exists "Riders can read their order items" on public.order_items;
create policy "Riders can read their order items"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    join public.restaurant_riders rr
      on rr.id = o.rider_id
    where o.id = order_items.order_id
      and rr.auth_user_id = auth.uid()
  )
);
