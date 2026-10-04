create or replace function public.system_admin_create_restaurant_from_invitation(
  p_invitation_id uuid,
  p_auth_user_id uuid,
  p_name text,
  p_slug text,
  p_package_id smallint
)
returns table (restaurant_id uuid, slug text, name text, package_id smallint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
  v_restaurant_id uuid;
  v_name text := trim(coalesce(p_name, ''));
  v_slug text := lower(trim(coalesce(p_slug, '')));
begin
  if auth.uid() is null or not public.system_admin_has_manage_access() then
    raise exception 'System Administrator access is required';
  end if;
  if p_auth_user_id is null then raise exception 'Owner account is required'; end if;
  if v_name = '' or length(v_name) < 2 then raise exception 'Restaurant name is required'; end if;
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Slug must use lowercase letters, numbers, and single hyphens'; end if;
  if exists (select 1 from public.restaurants r where lower(r.slug) = v_slug) then raise exception 'That restaurant identity is already in use'; end if;
  if not exists (select 1 from public.system_packages p where p.id = p_package_id and p.is_active) then raise exception 'Selected package is not available'; end if;

  select * into v_invitation
  from public.tenant_invitations
  where id = p_invitation_id and status = 'pending' and auth_user_id = p_auth_user_id and expires_at > now()
  for update;

  if not found then raise exception 'This tenant invitation is invalid, expired, or already used'; end if;
  if exists (select 1 from public.restaurants r where r.owner_id = p_auth_user_id) then raise exception 'This account already owns a restaurant'; end if;

  insert into public.restaurants (owner_id, name, slug, tagline, is_active)
  values (p_auth_user_id, v_name, v_slug, '', true)
  returning id into v_restaurant_id;

  insert into public.restaurant_subscriptions (restaurant_id, package_id, status)
  values (v_restaurant_id, p_package_id, 'active');

  update public.tenant_invitations
  set restaurant_id = v_restaurant_id, updated_at = now()
  where id = v_invitation.id;

  perform public.system_admin_write_audit_log(
    p_event_type := 'ADMIN_ACTION',
    p_action := 'RESTAURANT_CREATED_WITH_PACKAGE',
    p_restaurant_id := v_restaurant_id,
    p_entity_type := 'RESTAURANT',
    p_entity_id := v_restaurant_id,
    p_details := jsonb_build_object('restaurant_name', v_name, 'slug', v_slug, 'package_id', p_package_id, 'owner_auth_user_id', p_auth_user_id, 'invitation_id', p_invitation.id)
  );

  return query select v_restaurant_id, v_slug, v_name, p_package_id;
end;
$$;

revoke execute on function public.system_admin_create_restaurant_from_invitation(uuid, uuid, text, text, smallint) from public, anon, authenticated;
grant execute on function public.system_admin_create_restaurant_from_invitation(uuid, uuid, text, text, smallint) to authenticated;

create or replace function public.complete_tenant_owner_setup()
returns table (restaurant_id uuid, restaurant_name text)
language plpgsql
security definer
set search_path = public
as $$
declare v_invitation public.tenant_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into v_invitation
  from public.tenant_invitations
  where auth_user_id = auth.uid() and status = 'pending' and expires_at > now() and restaurant_id is not null
  order by created_at desc limit 1 for update;
  if not found then raise exception 'No active tenant onboarding was found for this account'; end if;

  update public.tenant_invitations
  set status = 'accepted', accepted_at = now(), updated_at = now()
  where id = v_invitation.id;

  return query select r.id, r.name from public.restaurants r
  where r.id = v_invitation.restaurant_id and r.owner_id = auth.uid();
end;
$$;

revoke execute on function public.complete_tenant_owner_setup() from public, anon;
grant execute on function public.complete_tenant_owner_setup() to authenticated;

drop function if exists public.get_my_pending_tenant_invitation();
create or replace function public.get_my_pending_tenant_invitation()
returns table (id uuid, email text, expires_at timestamptz, restaurant_id uuid, restaurant_name text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  return query
  select ti.id, ti.email, ti.expires_at, ti.restaurant_id, r.name
  from public.tenant_invitations ti
  left join public.restaurants r on r.id = ti.restaurant_id
  where ti.status = 'pending'
    and lower(ti.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and ti.expires_at > now()
  order by ti.created_at desc limit 1;
end;
$$;

revoke execute on function public.get_my_pending_tenant_invitation() from public, anon;
grant execute on function public.get_my_pending_tenant_invitation() to authenticated;