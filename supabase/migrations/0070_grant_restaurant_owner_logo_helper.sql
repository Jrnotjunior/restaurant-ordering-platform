-- Allow authenticated owners to use the logo ownership helper.
-- The helper itself only returns whether the current user owns the restaurant.

grant execute on function public.is_restaurant_owner(uuid) to authenticated;
