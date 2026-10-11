-- Atomically claim PayMongo webhook events so concurrent deliveries cannot
-- both execute payment side effects. Failed events can retry immediately;
-- abandoned processing claims can be recovered after five minutes.
create or replace function public.claim_paymongo_webhook_event(
  p_event_id text,
  p_restaurant_id uuid,
  p_environment text,
  p_event_type text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claimed boolean := false;
begin
  if nullif(trim(p_event_id), '') is null then
    raise exception 'Webhook event ID is required';
  end if;
  if p_environment not in ('test', 'live') then
    raise exception 'Invalid webhook environment';
  end if;

  insert into public.paymongo_webhook_events (
    event_id, restaurant_id, environment, event_type, status, attempts,
    last_error, received_at
  ) values (
    trim(p_event_id), p_restaurant_id, p_environment,
    coalesce(nullif(trim(p_event_type), ''), 'unknown'),
    'processing', 1, null, now()
  )
  on conflict (event_id) do update
    set restaurant_id = coalesce(excluded.restaurant_id, paymongo_webhook_events.restaurant_id),
        environment = excluded.environment,
        event_type = excluded.event_type,
        status = 'processing',
        attempts = paymongo_webhook_events.attempts + 1,
        last_error = null,
        received_at = now()
    where paymongo_webhook_events.status = 'failed'
       or (
         paymongo_webhook_events.status = 'processing'
         and paymongo_webhook_events.received_at < now() - interval '5 minutes'
       )
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_paymongo_webhook_event(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_paymongo_webhook_event(text, uuid, text, text) to service_role;
