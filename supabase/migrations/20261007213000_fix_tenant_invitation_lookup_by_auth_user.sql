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
    and ti.auth_user_id = auth.uid()
    and ti.expires_at > now()
  order by ti.created_at desc
  limit 1;
end;
$$;

revoke execute on function public.get_my_pending_tenant_invitation() from public, anon;
grant execute on function public.get_my_pending_tenant_invitation() to authenticated;


create or replace function public.complete_tenant_owner_setup()
returns table (restaurant_id uuid, restaurant_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;

  select ti.*
    into v_invitation
  from public.tenant_invitations as ti
  where ti.auth_user_id = auth.uid()
    and ti.status = 'pending'
    and ti.expires_at > now()
    and ti.restaurant_id is not null
  order by ti.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'No active tenant onboarding was found for this account';
  end if;

  update public.tenant_invitations
  set status = 'accepted',
      accepted_at = now(),
      updated_at = now()
  where id = v_invitation.id;

  return query
  select r.id, r.name
  from public.restaurants as r
  where r.id = v_invitation.restaurant_id
    and r.owner_id = auth.uid();
end;
$$;

revoke execute on function public.complete_tenant_owner_setup() from public, anon;
grant execute on function public.complete_tenant_owner_setup() to authenticated;
