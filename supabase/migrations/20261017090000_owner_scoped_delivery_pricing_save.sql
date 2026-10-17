create or replace function public.update_restaurant_delivery_pricing(
  p_restaurant_id uuid,
  p_base_fee numeric,
  p_distance_increment_meters integer,
  p_fee_per_increment numeric,
  p_max_distance_meters integer
)
returns table (
  id uuid,
  delivery_base_fee numeric,
  delivery_distance_increment_meters integer,
  delivery_fee_per_increment numeric,
  delivery_max_distance_meters integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_base_fee is null or p_base_fee < 0
    or p_distance_increment_meters is null or p_distance_increment_meters <= 0
    or p_fee_per_increment is null or p_fee_per_increment < 0
    or p_max_distance_meters is null or p_max_distance_meters <= 0 then
    raise exception 'Invalid delivery pricing values';
  end if;

  return query
  update public.restaurants r
  set delivery_base_fee = p_base_fee,
      delivery_distance_increment_meters = p_distance_increment_meters,
      delivery_fee_per_increment = p_fee_per_increment,
      delivery_max_distance_meters = p_max_distance_meters
  where r.id = p_restaurant_id
    and r.owner_id = auth.uid()
    and r.is_active = true
  returning r.id, r.delivery_base_fee, r.delivery_distance_increment_meters,
            r.delivery_fee_per_increment, r.delivery_max_distance_meters;

  if not found then
    raise exception 'Restaurant not found or current user is not its active owner';
  end if;
end;
$$;

revoke all on function public.update_restaurant_delivery_pricing(uuid, numeric, integer, numeric, integer) from public, anon;
grant execute on function public.update_restaurant_delivery_pricing(uuid, numeric, integer, numeric, integer) to authenticated;
