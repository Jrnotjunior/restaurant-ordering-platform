-- Qualify the Auth email column to avoid ambiguity with the RETURNS TABLE email output.
create or replace function public.system_admin_assign_restaurant_owner(
  p_restaurant_id uuid,
  p_email text
)
returns table (user_id uuid, email text, full_name text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user auth.users%rowtype;
  v_previous_owner_id uuid;
begin
  if auth.uid() is null or not public.system_admin_has_manage_access() then
    raise exception 'System Administrator access required.';
  end if;

  if p_email is null or trim(p_email) = '' then
    raise exception 'Owner email is required.';
  end if;

  select r.owner_id into v_previous_owner_id
  from public.restaurants r
  where r.id = p_restaurant_id
  for update;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  select u.* into v_user
  from auth.users as u
  where lower(u.email) = lower(trim(p_email))
  limit 1
  for update;

  if v_user.id is null then
    raise exception 'No Auth account was found for that email.';
  end if;

  if exists (
    select 1 from public.restaurants r
    where r.owner_id = v_user.id
      and r.id <> p_restaurant_id
  ) then
    raise exception 'This account already owns another restaurant.';
  end if;

  update public.restaurants set owner_id = v_user.id
  where id = p_restaurant_id;

  perform public.system_admin_write_audit_log(
    p_event_type := 'ADMIN_ACTION',
    p_action := 'RESTAURANT_OWNER_ASSIGNED',
    p_restaurant_id := p_restaurant_id,
    p_entity_type := 'RESTAURANT',
    p_entity_id := p_restaurant_id,
    p_details := jsonb_build_object(
      'previous_owner_auth_user_id', v_previous_owner_id,
      'new_owner_auth_user_id', v_user.id,
      'owner_email', v_user.email
    )
  );

  return query
  select v_user.id, v_user.email,
    coalesce(nullif(v_user.raw_user_meta_data ->> 'full_name', ''),
             nullif(v_user.raw_user_meta_data ->> 'name', ''));
end;
$$;

revoke all on function public.system_admin_assign_restaurant_owner(uuid, text) from public, anon;
grant execute on function public.system_admin_assign_restaurant_owner(uuid, text) to authenticated;
