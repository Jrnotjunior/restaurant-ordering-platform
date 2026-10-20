-- Use an explicit short RPC name: PostgreSQL identifiers are limited to 63 bytes.
-- The previous 73-character name was silently truncated by PostgreSQL, so PostgREST
-- could not resolve the full name requested by the storefront.
drop function if exists public.create_pending_online_payment_from_delivery_quote_with_guest_ca(
  uuid, text, text, text, text, text, text, jsonb, boolean,
  text, text, text, double precision, double precision, text, uuid, text
);

create or replace function public.create_pending_delivery_payment_with_cancel_token(
  p_restaurant_id uuid,
  p_customer_name text,
  p_mobile_number text,
  p_delivery_city text,
  p_delivery_barangay text,
  p_delivery_address text,
  p_notes text,
  p_items jsonb,
  p_redeem_loyalty boolean,
  p_customer_delivery_address text,
  p_customer_delivery_city text,
  p_customer_delivery_barangay text,
  p_customer_delivery_latitude double precision,
  p_customer_delivery_longitude double precision,
  p_customer_delivery_place_id text,
  p_delivery_quote_id uuid,
  p_guest_cancel_token_hash text
)
returns table(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_created record;
begin
  if p_guest_cancel_token_hash is null or p_guest_cancel_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid guest cancellation token hash is required';
  end if;

  select * into v_created
  from public.create_pending_online_payment_from_delivery_quote(
    p_restaurant_id, p_customer_name, p_mobile_number,
    p_delivery_city, p_delivery_barangay, p_delivery_address, p_notes,
    p_items, p_redeem_loyalty, p_customer_delivery_address,
    p_customer_delivery_city, p_customer_delivery_barangay,
    p_customer_delivery_latitude, p_customer_delivery_longitude,
    p_customer_delivery_place_id, p_delivery_quote_id
  );

  update public.pending_online_payments
     set guest_cancel_token_hash = p_guest_cancel_token_hash
   where id = v_created.payment_id
     and customer_id is null;

  return query select v_created.payment_id, v_created.reference_number,
                       v_created.subtotal, v_created.delivery_fee, v_created.total;
end;
$function$;

revoke all on function public.create_pending_delivery_payment_with_cancel_token(
  uuid, text, text, text, text, text, text, jsonb, boolean,
  text, text, text, double precision, double precision, text, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.create_pending_delivery_payment_with_cancel_token(
  uuid, text, text, text, text, text, text, jsonb, boolean,
  text, text, text, double precision, double precision, text, uuid, text
) to anon, authenticated;

notify pgrst, 'reload schema';
