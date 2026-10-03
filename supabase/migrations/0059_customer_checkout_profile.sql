-- Allow a signed-in customer to load their own profile for checkout.
create or replace function public.get_my_customer_profile(
  p_restaurant_id uuid
)
returns table (
  customer_id uuid,
  name text,
  phone text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  return query
  select
    cp.id,
    cp.name,
    cp.phone
  from public.customer_profiles cp
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;
end;
$$;

revoke all on function public.get_my_customer_profile(uuid) from public;
grant execute on function public.get_my_customer_profile(uuid) to authenticated;
