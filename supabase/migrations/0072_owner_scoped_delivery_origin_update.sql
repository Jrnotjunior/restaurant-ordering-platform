-- Save restaurant delivery origin only for the authenticated active owner.
create or replace function public.update_restaurant_delivery_origin(
  p_restaurant_id uuid,
  p_store_address text,
  p_latitude double precision,
  p_longitude double precision
)
returns table (id uuid, delivery_location_latitude double precision, delivery_location_longitude double precision)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if (p_latitude is null) <> (p_longitude is null) then
    raise exception 'Latitude and longitude must both be provided';
  end if;

  if p_latitude is not null and (p_latitude < -90 or p_latitude > 90 or p_longitude < -180 or p_longitude > 180) then
    raise exception 'Invalid delivery coordinates';
  end if;

  return query
  update public.restaurants r
  set store_address = nullif(btrim(p_store_address), ''),
      delivery_location_latitude = p_latitude,
      delivery_location_longitude = p_longitude
  where r.id = p_restaurant_id
    and r.owner_id = auth.uid()
    and r.is_active = true
  returning r.id, r.delivery_location_latitude, r.delivery_location_longitude;

  if not found then
    raise exception 'Restaurant not found or current user is not its active owner';
  end if;
end;
$$;

revoke all on function public.update_restaurant_delivery_origin(uuid, text, double precision, double precision) from public, anon;
grant execute on function public.update_restaurant_delivery_origin(uuid, text, double precision, double precision) to authenticated;
