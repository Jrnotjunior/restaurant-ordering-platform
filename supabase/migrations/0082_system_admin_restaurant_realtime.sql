-- Enable realtime restaurant monitoring for the System Admin dashboard.
-- System Admin receives live INSERT/UPDATE/DELETE events for restaurants.

do $$
begin
  alter publication supabase_realtime add table public.restaurants;
exception
  when duplicate_object then
    null;
end
$$;
