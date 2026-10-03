-- System Administrator authorization foundation.
-- System Admin identity is stored in Supabase Auth app_metadata:
-- { "role": "system_admin" }
--
-- The helper is SECURITY DEFINER so platform-wide checks can be reused by
-- RLS policies and database triggers without exposing auth internals.

create or replace function public.is_system_admin()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'system_admin';
$$;

revoke all on function public.is_system_admin() from public, anon, authenticated;

create or replace function public.get_my_system_admin_status()
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select public.is_system_admin();
$$;

revoke all on function public.get_my_system_admin_status() from public, anon;
grant execute on function public.get_my_system_admin_status() to authenticated;

drop policy if exists "System admins can view all restaurants" on public.restaurants;
create policy "System admins can view all restaurants"
on public.restaurants
for select
to authenticated
using (public.is_system_admin());

drop policy if exists "System admins can insert restaurants" on public.restaurants;
create policy "System admins can insert restaurants"
on public.restaurants
for insert
to authenticated
with check (public.is_system_admin());

drop policy if exists "System admins can update restaurants" on public.restaurants;
create policy "System admins can update restaurants"
on public.restaurants
for update
to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

drop policy if exists "System admins can delete restaurants" on public.restaurants;
create policy "System admins can delete restaurants"
on public.restaurants
for delete
to authenticated
using (public.is_system_admin());

-- Existing workflow protection now uses the shared authorization helper.
create or replace function public.protect_system_workflow_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.cash_on_delivery_enabled is distinct from old.cash_on_delivery_enabled
     or new.automatic_rider_assignment_enabled is distinct from old.automatic_rider_assignment_enabled then
    if not public.is_system_admin() then
      raise exception 'Cash on Delivery and Automatic Rider Assignment are controlled by the System Administrator.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_system_workflow_settings() from public, anon, authenticated;
