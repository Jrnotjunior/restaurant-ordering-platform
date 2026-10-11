-- Harden every exposed guest-checkout RPC overload against SQL NULL bypasses.
-- This migration preserves each live function's existing business logic and grants by
-- rewriting only the vulnerable validation predicates in the current definitions.
do $migration$
declare
  v_function record;
  v_definition text;
  v_updated text;
  v_changed boolean;
  v_item_check_count integer := 0;
  v_targets text[] := array[
    'public.create_order(uuid,text,text,text,text,text,text,text,text,boolean,jsonb)',
    'public.create_order(uuid,text,text,text,text,text,text,text,text,boolean,jsonb,text,text,text,double precision,double precision,text)',
    'public.create_order_from_delivery_quote(uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid)',
    'public.create_pending_online_payment(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean)',
    'public.create_pending_online_payment(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean,text,text,text,double precision,double precision,text)',
    'public.create_pending_online_payment_from_delivery_quote(uuid,text,text,text,text,text,text,jsonb,boolean,text,text,text,double precision,double precision,text,uuid)'
  ];
begin
  for v_function in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.oid in (
        'public.create_order(uuid,text,text,text,text,text,text,text,text,boolean,jsonb)'::regprocedure,
        'public.create_order(uuid,text,text,text,text,text,text,text,text,boolean,jsonb,text,text,text,double precision,double precision,text)'::regprocedure,
        'public.create_order_from_delivery_quote(uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid)'::regprocedure,
        'public.create_pending_online_payment(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean)'::regprocedure,
        'public.create_pending_online_payment(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean,text,text,text,double precision,double precision,text)'::regprocedure,
        'public.create_pending_online_payment_from_delivery_quote(uuid,text,text,text,text,text,text,jsonb,boolean,text,text,text,double precision,double precision,text,uuid)'::regprocedure
      )
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated := v_definition;

    -- SQL IF treats NULL as not-true, so explicitly reject NULL/non-array/empty item lists.
    v_updated := regexp_replace(
      v_updated,
      'if[[:space:]]+jsonb_typeof\(p_items\)[[:space:]]*<>[[:space:]]*''array''[[:space:]]+or[[:space:]]+jsonb_array_length\(p_items\)[[:space:]]*=[[:space:]]*0[[:space:]]+then',
      'if p_items is null or jsonb_typeof(p_items) is distinct from ''array'' or jsonb_array_length(p_items) = 0 then',
      'gi'
    );

    -- Explicitly reject NULL order and payment methods in functions that validate them.
    v_updated := regexp_replace(
      v_updated,
      'if[[:space:]]+p_order_type[[:space:]]+not[[:space:]]+in[[:space:]]*\(',
      'if p_order_type is null or p_order_type not in (',
      'gi'
    );
    v_updated := regexp_replace(
      v_updated,
      'if[[:space:]]+p_payment_method[[:space:]]+not[[:space:]]+in[[:space:]]*\(',
      'if p_payment_method is null or p_payment_method not in (',
      'gi'
    );

    if v_updated is distinct from v_definition then
      if position('p_items is null or jsonb_typeof(p_items) is distinct from ''array''' in v_updated) > 0 then
        v_item_check_count := v_item_check_count + 1;
      end if;
      execute v_updated;
    end if;
  end loop;

  if v_item_check_count < 4 then
    raise exception 'Expected to harden at least four checkout item-validation predicates; only % were found. Transaction rolled back.', v_item_check_count;
  end if;
end;
$migration$;
