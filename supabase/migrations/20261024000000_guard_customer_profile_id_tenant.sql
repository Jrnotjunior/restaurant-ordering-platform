-- Keep customer profile lookup bound to a single tenant identity.
-- A newly authenticated user with no customer profile may still proceed to registration.

create or replace function public.get_my_customer_profile_id(
  p_restaurant_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_customer_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  -- Preserve the first-time registration flow: no existing profile means no
  -- profile ID yet, not an authorization failure.
  if not exists (
    select 1
    from public.customer_profiles cp
    where cp.auth_user_id = auth.uid()
  ) then
    return null;
  end if;

  if not public.customer_identity_is_single_tenant(auth.uid(), p_restaurant_id) then
    raise exception 'Customer account does not belong to this restaurant';
  end if;

  select cp.id
    into v_customer_id
  from public.customer_profiles cp
  where cp.restaurant_id = p_restaurant_id
    and cp.auth_user_id = auth.uid()
  limit 1;

  return v_customer_id;
end;
$$;

revoke all on function public.get_my_customer_profile_id(uuid) from public, anon;
grant execute on function public.get_my_customer_profile_id(uuid) to authenticated;
