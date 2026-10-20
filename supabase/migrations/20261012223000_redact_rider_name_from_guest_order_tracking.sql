-- Guest tracking is a bearer-token-like public endpoint today. Minimize
-- disclosure while the dedicated high-entropy guest tracking token redesign
-- is pending: anonymous callers must not receive rider identity or phone.
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.get_order_status_by_id(uuid)'::regprocedure)
    into v_definition;
  v_updated := replace(
    v_definition,
    '    o.delivery_status,\n    rs.name,',
    '    o.delivery_status,\n    CASE WHEN auth.uid() IS NULL THEN NULL ELSE rs.name END,'
  );
  if v_updated = v_definition then
    if position('CASE WHEN auth.uid() IS NULL THEN NULL ELSE rs.name END' in v_definition) > 0 then
      return;
    end if;
    raise exception 'Expected rider-name projection not found; no change made';
  end if;
  execute v_updated;
end;
$migration$;
