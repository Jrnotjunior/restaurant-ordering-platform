-- Allow authenticated restaurant owners to insert staff rows, subject to RLS policies.
grant insert on table public.restaurant_staff to authenticated;
