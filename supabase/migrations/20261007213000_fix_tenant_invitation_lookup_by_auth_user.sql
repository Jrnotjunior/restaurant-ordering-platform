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
