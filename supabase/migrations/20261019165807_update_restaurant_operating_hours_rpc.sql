-- Save tenant operating hours through an owner-scoped RPC and return the exact saved JSON.
create or replace function public.update_restaurant_operating_hours(
  p_restaurant_id uuid,
  p_operating_hours jsonb
)
returns table(id uuid, operating_hours jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day_key text;
  v_day jsonb;
  v_open text;
  v_close text;
  v_saved_id uuid;
  v_saved_hours jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_operating_hours is null or jsonb_typeof(p_operating_hours) is distinct from 'object' then
    raise exception 'Operating hours must be a JSON object';
  end if;

  for v_day_key in
    select unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']::text[])
  loop
    v_day := p_operating_hours -> v_day_key;

    if jsonb_typeof(v_day) is distinct from 'object' then
      raise exception 'Operating hours are missing a valid entry for %', v_day_key;
    end if;

    if jsonb_typeof(v_day -> 'isOpen') is distinct from 'boolean' then
      raise exception 'Operating hours for % must include an isOpen boolean', v_day_key;
    end if;

    v_open := v_day ->> 'open';
    v_close := v_day ->> 'close';

    if v_open is null or v_open !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Invalid opening time for %; expected HH:mm in 24-hour time', v_day_key;
    end if;

    if v_close is null or v_close !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Invalid closing time for %; expected HH:mm in 24-hour time', v_day_key;
    end if;
  end loop;

  update public.restaurants r
     set operating_hours = p_operating_hours
   where r.id = p_restaurant_id
     and r.owner_id = auth.uid()
     and r.is_active = true
  returning r.id, r.operating_hours
       into v_saved_id, v_saved_hours;

  if not found then
    raise exception 'Restaurant not found or current user is not its active owner';
  end if;

  return query select v_saved_id, v_saved_hours;
end;
$$;

revoke all on function public.update_restaurant_operating_hours(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.update_restaurant_operating_hours(uuid, jsonb)
to authenticated;

notify pgrst, 'reload schema';
