-- Allow the dedicated dispatcher staff account to operate the existing
-- restaurant dispatch workflow without changing owner permissions.

drop policy if exists "Dispatchers can read orders" on public.orders;
create policy "Dispatchers can read orders"
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where s.restaurant_id = orders.restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  )
);

drop policy if exists "Dispatchers can update orders" on public.orders;
create policy "Dispatchers can update orders"
on public.orders
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where s.restaurant_id = orders.restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where s.restaurant_id = orders.restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  )
);

drop policy if exists "Dispatchers can read riders" on public.restaurant_riders;
create policy "Dispatchers can read riders"
on public.restaurant_riders
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where s.restaurant_id = restaurant_riders.restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  )
);

drop policy if exists "Dispatchers can read delivery assignments" on public.delivery_assignments;
create policy "Dispatchers can read delivery assignments"
on public.delivery_assignments
for select
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where s.restaurant_id = delivery_assignments.restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  )
);

drop policy if exists "Dispatchers can create delivery assignments" on public.delivery_assignments;
create policy "Dispatchers can create delivery assignments"
on public.delivery_assignments
for insert
to authenticated
with check (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where s.restaurant_id = delivery_assignments.restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  )
);

drop policy if exists "Dispatchers can update delivery assignments" on public.delivery_assignments;
create policy "Dispatchers can update delivery assignments"
on public.delivery_assignments
for update
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where s.restaurant_id = delivery_assignments.restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where s.restaurant_id = delivery_assignments.restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  )
);

drop policy if exists "Dispatchers can delete delivery assignments" on public.delivery_assignments;
create policy "Dispatchers can delete delivery assignments"
on public.delivery_assignments
for delete
to authenticated
using (
  exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r on r.id = s.restaurant_id
    where s.restaurant_id = delivery_assignments.restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  )
);
