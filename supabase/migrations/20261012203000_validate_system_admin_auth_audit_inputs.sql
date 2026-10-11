-- Validate caller-controlled authentication audit inputs. Keep the function
-- self-attributed to auth.uid(), but reject NULL event types (SQL NOT IN does
-- not reject NULL) and malformed/unbounded detail payloads.
create or replace function public.system_admin_record_auth_event(
  p_event_type text,
  p_action text,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_log_id uuid;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_action text := nullif(btrim(p_action), '');
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required';
  end if;

  if p_event_type is null or p_event_type not in (
    'LOGIN_SUCCESS',
    'LOGOUT',
    'ACCESS_DENIED'
  ) then
    raise exception 'Invalid authentication event type';
  end if;

  if v_action is null or length(v_action) > 120 then
    raise exception 'Invalid authentication event action';
  end if;

  if jsonb_typeof(v_details) <> 'object' then
    raise exception 'Authentication event details must be a JSON object';
  end if;

  if octet_length(v_details::text) > 4096 then
    raise exception 'Authentication event details are too large';
  end if;

  insert into public.system_admin_audit_logs (
    admin_user_id, restaurant_id, event_type, action,
    entity_type, entity_id, details
  )
  values (
    auth.uid(), null, p_event_type, v_action,
    'authentication', null, v_details
  )
  returning id into v_log_id;

  return v_log_id;
end;
$function$;

revoke all on function public.system_admin_record_auth_event(text, text, jsonb) from public, anon;
grant execute on function public.system_admin_record_auth_event(text, text, jsonb) to authenticated;
comment on function public.system_admin_record_auth_event(text, text, jsonb) is
  'Records allowlisted authentication event types for the current user; validates action and bounded JSON object details.';
