-- Allow take-out through customer online-payment checkout validation.
do $migration$
declare v_function record; v_definition text; v_updated text;
begin
 for v_function in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_order','create_pending_online_payment') and pg_get_functiondef(p.oid) like '%p_order_type%' loop
  v_definition := pg_get_functiondef(v_function.oid);
  v_updated := v_definition;
  v_updated := replace(v_updated, '(''delivery'',''pickup'',''dine_in'')', '(''delivery'',''take_out'',''pickup'',''dine_in'')');
  v_updated := replace(v_updated, '(''delivery'', ''pickup'', ''dine_in'')', '(''delivery'', ''take_out'', ''pickup'', ''dine_in'')');
  v_updated := replace(v_updated, '(''pickup'',''dine_in'')', '(''take_out'',''pickup'',''dine_in'')');
  v_updated := replace(v_updated, '(''pickup'', ''dine_in'')', '(''take_out'', ''pickup'', ''dine_in'')');
  if v_updated is distinct from v_definition then execute v_updated; end if;
 end loop;
end;
$migration$;