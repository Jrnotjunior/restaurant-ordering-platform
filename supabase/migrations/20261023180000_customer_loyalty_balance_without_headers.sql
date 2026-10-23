-- Loyalty balance is read only through the authenticated customer's profile.
create or replace function public.get_my_loyalty_points(
  p_restaurant_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points bigint;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id is null
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;

  select coalesce(cla.points_balance, 0)
    into v_points
  from public.customer_profiles cp
  left join public.customer_loyalty_accounts cla
    on cla.customer_id = cp.id
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;

  return coalesce(v_points, 0);
end;
$$;

revoke all on function public.get_my_loyalty_points(uuid) from public, anon;
grant execute on function public.get_my_loyalty_points(uuid) to authenticated;
