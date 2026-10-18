create or replace function public.prevent_orders_when_store_closed()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_ordering_enabled boolean;
  v_operating_hours jsonb;
  v_day_key text;
  v_day jsonb;
  v_open text;
  v_close text;
  v_now_minutes integer;
  v_open_minutes integer;
  v_close_minutes integer;
  v_is_open boolean;
  v_customer_id uuid;
begin
  select r.ordering_enabled, r.operating_hours
    into v_ordering_enabled, v_operating_hours
  from public.restaurants r
  where r.id = new.restaurant_id
    and r.is_active = true;

  if not found then
    raise exception 'Restaurant is not available';
  end if;

  -- A verified PayMongo webhook finalizes an already-paid order using the
  -- service-role client. Do not reject that paid order because store hours
  -- changed after checkout began. This exception is limited to trusted
  -- server-side inserts of already-paid orders; ordinary checkout remains
  -- subject to all store-open checks below.
  if tg_op = 'INSERT'
     and auth.role() = 'service_role'
     and lower(coalesce(new.payment_method, '')) in ('gcash', 'paymaya', 'card', 'grab_pay', 'paymongo')
     and lower(coalesce(new.payment_status, '')) = 'paid' then
    return new;
  end if;

  -- Automatically link signed-in customers to their orders.
  if auth.uid() is not null and new.customer_id is null then
    select cp.id
      into v_customer_id
    from public.customer_profiles cp
    where cp.restaurant_id = new.restaurant_id
      and cp.auth_user_id = auth.uid()
    limit 1;

    if v_customer_id is not null then
      new.customer_id := v_customer_id;
    end if;
  end if;

  -- Manual store closure takes priority for new customer orders.
  if not coalesce(v_ordering_enabled, true) then
    raise exception 'The store is currently closed and is not accepting new orders.';
  end if;

  -- If operating hours are not configured, allow ordering normally.
  if v_operating_hours is null then
    return new;
  end if;

  v_day_key := lower(to_char(now() at time zone 'Asia/Manila', 'FMDay'));
  v_day := v_operating_hours -> v_day_key;

  if v_day is null or coalesce((v_day ->> 'isOpen')::boolean, true) = false then
    raise exception 'The store is currently closed and is not accepting new orders.';
  end if;

  v_open := v_day ->> 'open';
  v_close := v_day ->> 'close';

  if v_open is null or v_close is null then
    raise exception 'The store is currently closed and is not accepting new orders.';
  end if;

  v_now_minutes :=
    extract(hour from (now() at time zone 'Asia/Manila'))::integer * 60
    + extract(minute from (now() at time zone 'Asia/Manila'))::integer;

  v_open_minutes := split_part(v_open, ':', 1)::integer * 60
    + split_part(v_open, ':', 2)::integer;

  v_close_minutes := split_part(v_close, ':', 1)::integer * 60
    + split_part(v_close, ':', 2)::integer;

  v_is_open := case
    when v_open_minutes = v_close_minutes then true
    when v_close_minutes > v_open_minutes then
      v_now_minutes >= v_open_minutes and v_now_minutes < v_close_minutes
    else
      v_now_minutes >= v_open_minutes or v_now_minutes < v_close_minutes
  end;

  if not v_is_open then
    raise exception 'The store is currently closed and is not accepting new orders.';
  end if;

  return new;
end;
$function$;
