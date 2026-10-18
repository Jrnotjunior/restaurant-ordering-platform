do $migration$
declare
  v_signature regprocedure := 'public.create_order_from_delivery_quote(uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid)'::regprocedure;
  v_definition text;
  v_old text := $old$v_order_number := 'ORD-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));$old$;
  v_new text := 'v_order_number := public.next_restaurant_order_number(p_restaurant_id);';
begin
  v_definition := pg_get_functiondef(v_signature);
  if position(v_old in v_definition) = 0 then
    if position(v_new in v_definition) > 0 then
      raise notice 'Delivery quote order creation already uses the shared numbering function.';
      return;
    end if;
    raise exception 'Expected legacy delivery order-number generator was not found; refusing to modify function.';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end
$migration$;