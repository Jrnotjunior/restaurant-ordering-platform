-- Allow public checkout to read delivery zones.
-- The RLS policy in 0007 already limits rows to existing restaurants;
-- this grant supplies the table-level SELECT privilege needed by PostgREST.
grant select on table public.restaurant_delivery_zones to anon, authenticated;
