-- Allow restaurant owners to update only their own restaurant tagline.
-- This follows the owner-scoped logo update pattern and preserves tenant isolation.
create or replace function public.update_restaurant_tagline(
  p_restaurant_id uuid,
  p_tagline text
)
returns table (id uuid, tagline text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.restaurants r
  set tagline = coalesce(trim(p_tagline), '')
  where r.id = p_restaurant_id
    and r.owner_id = auth.uid()
    and r.is_active = true
  returning r.id, r.tagline into id, tagline;

  if not found then
    raise exception 'Restaurant not found or current user is not its active owner';
  end if;

  return next;
end;
$$;

revoke all on function public.update_restaurant_tagline(uuid, text) from public, anon;
grant execute on function public.update_restaurant_tagline(uuid, text) to authenticated;
