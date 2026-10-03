-- Fix dispatcher rider visibility without recursive RLS on restaurant_staff.
--
-- The dispatcher policy cannot query restaurant_staff directly because that
-- causes PostgreSQL to evaluate the same RLS policy recursively. Use a
-- SECURITY DEFINER helper for the dispatcher identity check instead.

create or replace function public.is_active_dispatcher_for_restaurant(
  p_restaurant_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_staff s
    join public.restaurants r
      on r.id = s.restaurant_id
    where s.restaurant_id = p_restaurant_id
      and s.auth_user_id = auth.uid()
      and s.role = 'dispatcher'
      and s.is_active = true
      and r.is_active = true
  );
$$;

revoke all on function public.is_active_dispatcher_for_restaurant(uuid) from public;
grant execute on function public.is_active_dispatcher_for_restaurant(uuid) to authenticated;

drop policy if exists "Dispatchers can read rider staff"
on public.restaurant_staff;

create policy "Dispatchers can read rider staff"
on public.restaurant_staff
for select
to authenticated
using (
  role = 'rider'
  and is_active = true
  and public.is_active_dispatcher_for_restaurant(restaurant_id)
);
