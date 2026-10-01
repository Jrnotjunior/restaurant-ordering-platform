-- Remove rider delivery scope rules.
-- Dispatch assignment is now controlled only by rider availability.
-- The dispatcher may assign any ready delivery to an available rider.

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rider_delivery_scopes'
  ) then
    alter publication supabase_realtime drop table public.rider_delivery_scopes;
  end if;
end $$;

drop table if exists public.rider_delivery_scopes;
