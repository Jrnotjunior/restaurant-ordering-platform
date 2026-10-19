-- Trigger helper functions are invoked by their triggers only.
-- They are not intended to be callable through the PostgREST RPC surface.
REVOKE ALL ON FUNCTION public.create_initial_restaurant_branch() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_default_branch_before_insert() FROM PUBLIC, anon, authenticated;
