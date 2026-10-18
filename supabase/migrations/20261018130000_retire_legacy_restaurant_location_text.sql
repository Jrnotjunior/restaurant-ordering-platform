-- Retire restaurants.location_text after preserving its remaining customer-facing data.
-- restaurant_address is the public/profile address; store_address remains the delivery origin.
update public.restaurants
set restaurant_address = nullif(trim(location_text), '')
where nullif(trim(restaurant_address), '') is null
  and nullif(trim(location_text), '') is not null;

do $migration$
declare v_def text;
begin
  -- The custom-domain RPC changes its returned field from location_text to restaurant_address.
  v_def := pg_get_functiondef('public.resolve_restaurant_by_domain(text)'::regprocedure);
  v_def := replace(v_def, 'location_text text', 'restaurant_address text');
  v_def := replace(v_def, 'r.location_text', 'r.restaurant_address');
  drop function public.resolve_restaurant_by_domain(text);
  execute v_def;
  revoke all on function public.resolve_restaurant_by_domain(text) from public;
  grant execute on function public.resolve_restaurant_by_domain(text) to anon, authenticated;

  -- Auth context exposes the canonical customer-facing address.
  v_def := pg_get_functiondef('public.resolve_my_account_context()'::regprocedure);
  v_def := replace(v_def, '''location_text'', r.location_text', '''restaurant_address'', r.restaurant_address');
  execute v_def;

  -- Keep the existing onboarding RPC argument name for backward compatibility,
  -- but store the supplied value in the canonical column.
  v_def := pg_get_functiondef('public.create_restaurant_from_tenant_invitation(uuid,text,text,text,text,text,text,text)'::regprocedure);
  v_def := replace(v_def, '    location_text,', '    restaurant_address,');
  execute v_def;

  -- Delivery/courier pickup origins and order tracking remain tied to store_address.
  v_def := pg_get_functiondef('public.create_order(uuid,text,text,text,text,text,text,text,text,boolean,jsonb)'::regprocedure);
  v_def := replace(v_def, 'location_text', 'store_address');
  execute v_def;

  v_def := pg_get_functiondef('public.create_pending_online_payment(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean)'::regprocedure);
  v_def := replace(v_def, 'location_text', 'store_address');
  execute v_def;

  v_def := pg_get_functiondef('public.create_pending_online_payment(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean,text,text,text,double precision,double precision,text)'::regprocedure);
  v_def := replace(v_def, 'location_text', 'store_address');
  execute v_def;

  v_def := pg_get_functiondef('public.get_order_status(text)'::regprocedure);
  v_def := replace(v_def, 'r.location_text', 'r.store_address');
  execute v_def;

  v_def := pg_get_functiondef('public.get_order_status_by_id(uuid)'::regprocedure);
  v_def := replace(v_def, 'r.location_text', 'r.store_address');
  execute v_def;
end
$migration$;

alter table public.restaurants drop column location_text;
