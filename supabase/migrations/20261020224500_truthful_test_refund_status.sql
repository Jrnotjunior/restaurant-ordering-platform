-- A test refund is only a local simulation; the underlying PayMongo payment remains PAID.
-- Repair previously simulated test payments that were incorrectly labeled as refunded.
update public.orders
set payment_status = 'paid',
    updated_at = now()
where cancellation_refund_status = 'simulated'
  and payment_status = 'refunded'
  and paymongo_refund_id is null
  and cancellation_refund_error like 'TEST MODE ONLY:%';

-- Expose only the cancellation/refund state needed for guest tracking, separately
-- from the original provider payment status.
create or replace function public.get_order_cancellation_refund_status(p_order_id uuid)
returns table(cancellation_refund_status text)
language sql
stable
security definer
set search_path to ''
as $function$
  select o.cancellation_refund_status::text
  from public.orders o
  where o.id = p_order_id
    and (
      auth.uid() is null
      or exists (
        select 1
        from public.customer_profiles cp
        where cp.id = o.customer_id
          and cp.restaurant_id = o.restaurant_id
          and cp.auth_user_id = auth.uid()
      )
    )
  limit 1;
$function$;

revoke all on function public.get_order_cancellation_refund_status(uuid) from public;
grant execute on function public.get_order_cancellation_refund_status(uuid) to anon, authenticated;

notify pgrst, 'reload schema';