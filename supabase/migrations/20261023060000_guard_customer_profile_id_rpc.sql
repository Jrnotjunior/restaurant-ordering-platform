-- Guard the customer-profile ID lookup as well as the richer profile RPCs.
-- Client-supplied restaurant IDs and tenant headers are not authorization.
create or replace function public.get_my_customer_profile_id(
  p_restaurant_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  if p_restaurant_id is null
     or p_restaurant_id <> public.get_request_restaurant_id()
     or not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer identity is not authorized for this restaurant';
  end if;

  select cp.id into v_customer_id
  from public.customer_profiles cp
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;

  return v_customer_id;
end;
$$;

revoke all on function public.get_my_customer_profile_id(uuid) from public, anon;
grant execute on function public.get_my_customer_profile_id(uuid) to authenticated;
