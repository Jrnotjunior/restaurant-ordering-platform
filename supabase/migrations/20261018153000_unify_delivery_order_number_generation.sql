DO $migration$
DECLARE
  v_signature regprocedure := 'public.create_order_from_delivery_quote(uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid)'::regprocedure;
  v_definition text;
  v_updated text;
  v_new text := 'v_order_number := public.next_restaurant_order_number(p_restaurant_id);';
BEGIN
  v_definition := pg_get_functiondef(v_signature);

  IF position(v_new in v_definition) > 0 THEN
    RAISE NOTICE 'Delivery quote order creation already uses the shared numbering function.';
    RETURN;
  END IF;

  -- Function source formatting differs across migration versions, so match the
  -- legacy expression with flexible whitespace instead of a literal-only replace.
  v_updated := regexp_replace(
    v_definition,
    $pattern$v_order_number[[:space:]]*:=[[:space:]]*'ORD-'[[:space:]]*\|\|[[:space:]]*to_char\(now\(\),[[:space:]]*'YYYYMMDD-HH24MISS'\)[[:space:]]*\|\|[[:space:]]*'-'[[:space:]]*\|\|[[:space:]]*upper\(substr\(replace\(gen_random_uuid\(\)::text,[[:space:]]*'-',[[:space:]]*''\),[[:space:]]*1,[[:space:]]*6\)\);$pattern$,
    v_new,
    'g'
  );

  IF v_updated = v_definition
     OR position(v_new in v_updated) = 0 THEN
    RAISE EXCEPTION 'Expected legacy delivery order-number generator was not found; refusing to modify function.';
  END IF;

  EXECUTE v_updated;
END;
$migration$;