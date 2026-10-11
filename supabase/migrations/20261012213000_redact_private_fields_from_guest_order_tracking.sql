-- Minimize personal information returned by anonymous guest order tracking.
-- Until guest tracking is migrated to a dedicated high-entropy token, do not
-- disclose the rider's phone number or internal delivery-failure detail to anon.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.get_order_status_by_id(uuid)'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    '    rs.mobile_number,',
    '    CASE WHEN auth.uid() IS NULL THEN NULL ELSE rs.mobile_number END,'
  );
  v_updated := replace(
    v_updated,
    '    o.delivery_failure_reason,',
    '    CASE WHEN auth.uid() IS NULL THEN NULL ELSE o.delivery_failure_reason END,'
  );

  if v_updated = v_definition
     or position('CASE WHEN auth.uid() IS NULL THEN NULL ELSE rs.mobile_number END' in v_updated) = 0
     or position('CASE WHEN auth.uid() IS NULL THEN NULL ELSE o.delivery_failure_reason END' in v_updated) = 0 then
    raise exception 'Could not safely redact private fields from guest order tracking';
  end if;

  execute v_updated;
end;
$migration$;

revoke all on function public.get_order_status_by_id(uuid) from public;
grant execute on function public.get_order_status_by_id(uuid) to anon, authenticated;
