-- Align tenant invitation lifetime with Supabase Auth invitation links.
-- Supabase invitation links use the project's Email OTP Expiration setting.
-- The current project uses a short-lived invitation flow, so provisional
-- tenant records must not remain pending for seven days after the Auth link
-- is already unusable.

alter table public.tenant_invitations
  alter column expires_at set default (now() + interval '1 hour');

-- Existing pending invitations created under the old seven-day default should
-- use the same one-hour lifetime. Invitations whose owner already set a
-- password are reconciled as accepted below instead of being deleted.
update public.tenant_invitations ti
set expires_at = ti.created_at + interval '1 hour',
    updated_at = now()
where ti.status = 'pending'
  and not exists (
    select 1
    from auth.users u
    where u.id = ti.auth_user_id
      and coalesce(length(u.encrypted_password), 0) > 0
  );

-- A password means the tenant has completed the authentication portion of
-- onboarding. If the restaurant belongs to that auth account, finalize the
-- invitation so the cleanup job cannot mistake a completed tenant for an
-- abandoned one.
update public.tenant_invitations ti
set status = 'accepted',
    accepted_at = coalesce(ti.accepted_at, now()),
    updated_at = now()
where ti.status = 'pending'
  and ti.restaurant_id is not null
  and exists (
    select 1
    from auth.users u
    where u.id = ti.auth_user_id
      and coalesce(length(u.encrypted_password), 0) > 0
  )
  and exists (
    select 1
    from public.restaurants r
    where r.id = ti.restaurant_id
      and r.owner_id = ti.auth_user_id
  );

create or replace function public.cleanup_abandoned_tenant_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_invitation public.tenant_invitations%rowtype;
  v_has_password boolean := false;
begin
  select *
    into v_invitation
  from public.tenant_invitations
  where id = p_invitation_id
    and status = 'pending'
  for update;

  if not found then
    return false;
  end if;

  select coalesce(length(u.encrypted_password), 0) > 0
    into v_has_password
  from auth.users u
  where u.id = v_invitation.auth_user_id;

  -- If the tenant already set a password and owns the provisional restaurant,
  -- finalize onboarding instead of treating the record as abandoned.
  if v_has_password
     and v_invitation.restaurant_id is not null
     and exists (
       select 1
       from public.restaurants r
       where r.id = v_invitation.restaurant_id
         and r.owner_id = v_invitation.auth_user_id
     )
  then
    update public.tenant_invitations
    set status = 'accepted',
        accepted_at = coalesce(accepted_at, now()),
        updated_at = now()
    where id = v_invitation.id;

    return true;
  end if;

  -- Only delete an invitation once its Auth-equivalent lifetime has elapsed.
  if v_invitation.expires_at > now() then
    return false;
  end if;

  -- Never destroy operational data. A pending invitation should not have
  -- orders or pending payments; if it does, leave it for manual review.
  if v_invitation.restaurant_id is not null
     and (
       exists (select 1 from public.orders where restaurant_id = v_invitation.restaurant_id)
       or exists (select 1 from public.pending_online_payments where restaurant_id = v_invitation.restaurant_id)
     )
  then
    return false;
  end if;

  if v_invitation.restaurant_id is not null then
    delete from public.system_admin_audit_logs
    where restaurant_id = v_invitation.restaurant_id;

    delete from public.system_api_usage_events
    where restaurant_id = v_invitation.restaurant_id;

    delete from public.paymongo_webhook_events
    where restaurant_id = v_invitation.restaurant_id;

    delete from public.tenant_invitations
    where id = v_invitation.id;

    delete from public.restaurants
    where id = v_invitation.restaurant_id;
  else
    delete from public.tenant_invitations
    where id = v_invitation.id;
  end if;

  -- Delete the provisional Auth account only when it has no password and is
  -- no longer referenced by another invitation or restaurant.
  if v_invitation.auth_user_id is not null
     and not v_has_password
     and not exists (
       select 1
       from public.tenant_invitations ti
       where ti.auth_user_id = v_invitation.auth_user_id
     )
     and not exists (
       select 1
       from public.restaurants r
       where r.owner_id = v_invitation.auth_user_id
     )
  then
    delete from auth.users
    where id = v_invitation.auth_user_id;
  end if;

  return true;
end;
$$;

revoke execute on function public.cleanup_abandoned_tenant_invitation(uuid) from public, anon, authenticated;

create or replace function public.expire_stale_tenant_invitations()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_count integer := 0;
  v_invitation_id uuid;
begin
  for v_invitation_id in
    select ti.id
    from public.tenant_invitations ti
    where ti.status = 'pending'
    order by ti.expires_at
    for update
  loop
    if public.cleanup_abandoned_tenant_invitation(v_invitation_id) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.expire_stale_tenant_invitations() from public, anon, authenticated;
