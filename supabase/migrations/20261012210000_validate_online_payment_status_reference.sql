-- Bound and validate guest payment-status lookup input before querying.
-- The payment reference is a bearer credential; new references contain 128 bits
-- of random UUID material after the timestamp prefix. Invalid inputs return no rows.
create or replace function public.get_online_payment_status(p_reference_number text)
returns table (
  status text,
  order_number text,
  order_id uuid,
  total numeric
)
language sql
security definer
set search_path = public, pg_temp
as $function$
  select
    p.status,
    o.order_number,
    o.id,
    p.total
  from public.pending_online_payments p
  left join public.orders o on o.id = p.order_id
  where p_reference_number is not null
    and length(p_reference_number) <= 64
    and trim(p_reference_number) ~ '^PAY-[0-9]{8}-[0-9]{6}-[A-Fa-f0-9]{32}$'
    and p.reference_number = trim(p_reference_number);
$function$;

revoke all on function public.get_online_payment_status(text) from public, anon;
grant execute on function public.get_online_payment_status(text) to anon, authenticated;

comment on function public.get_online_payment_status(text) is
  'Returns limited guest payment status only for a syntactically valid high-entropy payment reference.';
