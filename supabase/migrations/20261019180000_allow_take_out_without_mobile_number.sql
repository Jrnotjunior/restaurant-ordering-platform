-- Take-out checkout does not collect a mobile number. Keep phone required for
-- delivery and pickup, while allowing dine-in and take-out orders without it.
do $migration$
declare
  v_function record;
  v_definition text;
  v_updated text;
begin
  for v_function in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_order'
      and pg_get_functiondef(p.oid) like '%Mobile number is required%'
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated := replace(
      v_definition,
      'if p_order_type<>'dine_in' and length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;',
      'if p_order_type not in ('dine_in','take_out') and length(trim(coalesce(p_mobile_number,'')))=0 then raise exception 'Mobile number is required'; end if;'
    );
    v_updated := replace(
      v_definition,
      'if p_order_type <> 'dine_in' and length(trim(coalesce(p_mobile_number, ''))) = 0 then raise exception 'Mobile number is required'; end if;',
      'if p_order_type not in ('dine_in', 'take_out') and length(trim(coalesce(p_mobile_number, ''))) = 0 then raise exception 'Mobile number is required'; end if;'
    );
    if v_updated is distinct from v_definition then
      execute v_updated;
    end if;
  end loop;
end;
$migration$;
