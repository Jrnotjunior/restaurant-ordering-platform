-- Storage RLS policies call this SECURITY DEFINER helper.
-- Authenticated owners need EXECUTE permission for policy evaluation;
-- the function itself still limits access to the signed-in restaurant owner.
grant execute on function public.is_restaurant_owner(uuid) to authenticated;
