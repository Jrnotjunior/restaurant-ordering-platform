-- Persist restaurant logos through an owner-scoped RPC.
-- This avoids depending on a broad restaurants UPDATE policy while preserving tenant isolation.
create or replace function public.update_restaurant_logo(
  p_restaurant_id uuid,
  p_logo_url text
)
returns table (id uuid, logo_url text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.restaurants r
  set logo_url = nullif(trim(p_logo_url), '')
  where r.id = p_restaurant_id
    and r.owner_id = auth.uid()
    and r.is_active = true
  returning r.id, r.logo_url into id, logo_url;

  if not found then
    raise exception 'Restaurant not found or current user is not its active owner';
  end if;

  return next;
end;
$$;

revoke all on function public.update_restaurant_logo(uuid, text) from public, anon;
grant execute on function public.update_restaurant_logo(uuid, text) to authenticated;
