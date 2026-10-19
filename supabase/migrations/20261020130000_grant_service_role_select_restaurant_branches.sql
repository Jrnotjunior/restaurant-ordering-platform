-- The delivery-route Edge Function uses the service_role client to resolve
-- the selected branch. Explicitly grant read access for this server-side lookup.
-- Row-level security remains enabled for client roles.
GRANT SELECT ON TABLE public.restaurant_branches TO service_role;
