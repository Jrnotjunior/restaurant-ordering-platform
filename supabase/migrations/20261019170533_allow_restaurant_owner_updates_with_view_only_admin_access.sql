-- Permit an authenticated restaurant owner to update their own restaurant,
-- even if that same account also has view-only System Admin access.
-- The owner_id check is row-scoped; this does not grant access to other restaurants.
drop policy if exists "System Admin management access guard - update" on public.restaurants;

create policy "System Admin management access guard - update"
on public.restaurants
as restrictive
for update
to authenticated
using (
  (not public.system_admin_has_access())
  or public.system_admin_has_manage_access()
  or owner_id = (select auth.uid())
)
with check (
  (not public.system_admin_has_access())
  or public.system_admin_has_manage_access()
  or owner_id = (select auth.uid())
);