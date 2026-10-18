-- Introduce a distinct take_out order type while preserving historical pickup orders.
-- Update all public checkout RPCs that validate order types without changing their grants.
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
      and p.proname in ('create_order', 'create_pending_online_payment')
      and pg_get_functiondef(p.oid) like '%p_order_type%'
  loop
    v_definition := pg_get_functiondef(v_function.oid);
    v_updated := replace(
      v_definition,
      '(''delivery'', ''pickup'', ''dine_in'')',
      '(''delivery'', ''take_out'', ''pickup'', ''dine_in'')'
    );
    v_updated := replace(
      v_updated,
      '(''delivery'',''pickup'',''dine_in'')',
      '(''delivery'',''take_out'',''pickup'',''dine_in'')'
    );
    if v_updated is distinct from v_definition then
      execute v_updated;
    end if;
  end loop;
end;
$migration$;

alter table public.orders
  drop constraint if exists orders_order_type_check;

alter table public.orders
  add constraint orders_order_type_check
  check (order_type in ('delivery', 'take_out', 'pickup', 'dine_in'));

-- POS cash confirmation accepts the new order type and retains its existing
-- owner/cashier authorization and pending-cash safeguards.
create or replace function public.confirm_dine_in_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.orders o
    join public.restaurants r on r.id = o.restaurant_id
    where o.id = p_order_id
      and r.is_active = true
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1
          from public.restaurant_staff s
          where s.restaurant_id = o.restaurant_id
            and s.auth_user_id = auth.uid()
            and s.role = 'cashier'
            and s.is_active = true
        )
      )
  ) then
    raise exception 'Order not found or you are not authorized to update it';
  end if;

  if not exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.order_type in ('dine_in', 'take_out', 'pickup', 'delivery')
      and o.payment_method = 'cash'
      and o.payment_status = 'pending'
      and o.status = 'pending'
  ) then
    raise exception 'Only unpaid pending POS cash orders can be confirmed';
  end if;

  update public.orders
  set payment_status = 'paid',
      status = 'confirmed',
      updated_at = now()
  where id = p_order_id;
end;
$$;

revoke all on function public.confirm_dine_in_payment(uuid) from public;
grant execute on function public.confirm_dine_in_payment(uuid) to authenticated;
