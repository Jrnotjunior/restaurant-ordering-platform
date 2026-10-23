-- Improve audit event classification and record application-level actor roles.
-- This still excludes customer contact/address and statutory-discount ID values.
create or replace function public.capture_pos_sales_journal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_event_type text;
  v_restaurant_id uuid;
  v_order_id uuid;
  v_order_number text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_table_name = 'orders' then
    v_row := coalesce(v_new, v_old);
    v_restaurant_id := nullif(v_row ->> 'restaurant_id', '')::uuid;
    v_order_id := nullif(v_row ->> 'id', '')::uuid;
    v_order_number := v_row ->> 'order_number';

    if tg_op = 'INSERT' then
      v_event_type := 'SALE_CREATED';
    elsif tg_op = 'DELETE' then
      v_event_type := 'ORDER_RECORD_DELETED';
    elsif v_old -> 'tax_snapshot_status' is distinct from v_new -> 'tax_snapshot_status'
      or v_old -> 'tax_snapshot_version' is distinct from v_new -> 'tax_snapshot_version' then
      v_event_type := 'TAX_SNAPSHOT_STATUS_CHANGED';
    elsif v_old -> 'payment_status' is distinct from v_new -> 'payment_status' then
      v_event_type := 'PAYMENT_STATUS_CHANGED';
    elsif v_old -> 'status' is distinct from v_new -> 'status' then
      v_event_type := 'ORDER_STATUS_CHANGED';
    elsif v_old -> 'subtotal' is distinct from v_new -> 'subtotal'
      or v_old -> 'delivery_fee' is distinct from v_new -> 'delivery_fee'
      or v_old -> 'discount_amount' is distinct from v_new -> 'discount_amount'
      or v_old -> 'total' is distinct from v_new -> 'total'
      or v_old -> 'tax_vat_registered' is distinct from v_new -> 'tax_vat_registered'
      or v_old -> 'tax_prices_vat_inclusive' is distinct from v_new -> 'tax_prices_vat_inclusive'
      or v_old -> 'tax_vat_rate' is distinct from v_new -> 'tax_vat_rate'
      or v_old -> 'tax_gross_sales' is distinct from v_new -> 'tax_gross_sales'
      or v_old -> 'tax_vatable_sales' is distinct from v_new -> 'tax_vatable_sales'
      or v_old -> 'tax_vat_amount' is distinct from v_new -> 'tax_vat_amount'
      or v_old -> 'tax_vat_exempt_sales' is distinct from v_new -> 'tax_vat_exempt_sales'
      or v_old -> 'tax_net_sales' is distinct from v_new -> 'tax_net_sales'
      or v_old -> 'order_number' is distinct from v_new -> 'order_number' then
      v_event_type := 'FINANCIAL_OR_SERIAL_FIELDS_CHANGED';
    else
      v_event_type := 'ORDER_UPDATED';
    end if;

    v_actor_role := case
      when auth.uid() is null then coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'system')
      when public.is_system_admin() then 'system_admin'
      when exists (select 1 from public.restaurants r where r.id = v_restaurant_id and r.owner_id = auth.uid()) then 'owner'
      else coalesce((
        select s.role from public.restaurant_staff s
        where s.restaurant_id = v_restaurant_id and s.auth_user_id = auth.uid() and s.is_active = true
        order by case s.role when 'cashier' then 1 when 'dispatcher' then 2 when 'kitchen' then 3 when 'rider' then 4 else 5 end
        limit 1
      ), 'authenticated_user')
    end;

    insert into public.pos_sales_journal (
      restaurant_id, order_id, order_number, event_type, operation,
      actor_user_id, actor_role, old_values, new_values
    ) values (
      v_restaurant_id, v_order_id, v_order_number, v_event_type, tg_op,
      auth.uid(), v_actor_role,
      case when v_old is null then null else public.pos_sales_journal_order_snapshot(v_old) end,
      case when v_new is null then null else public.pos_sales_journal_order_snapshot(v_new) end
    );

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_row := coalesce(v_new, v_old);
  v_order_id := nullif(v_row ->> 'order_id', '')::uuid;
  select o.restaurant_id, o.order_number
    into v_restaurant_id, v_order_number
    from public.orders o
    where o.id = v_order_id;

  -- If the parent order has already been deleted during a cascade, its
  -- ORDER_RECORD_DELETED event remains the authoritative record.
  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_event_type := case tg_op
    when 'INSERT' then 'ORDER_ITEM_ADDED'
    when 'UPDATE' then 'ORDER_ITEM_CHANGED'
    else 'ORDER_ITEM_REMOVED'
  end;

  v_actor_role := case
    when auth.uid() is null then coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'system')
    when public.is_system_admin() then 'system_admin'
    when exists (select 1 from public.restaurants r where r.id = v_restaurant_id and r.owner_id = auth.uid()) then 'owner'
    else coalesce((
      select s.role from public.restaurant_staff s
      where s.restaurant_id = v_restaurant_id and s.auth_user_id = auth.uid() and s.is_active = true
      order by case s.role when 'cashier' then 1 when 'dispatcher' then 2 when 'kitchen' then 3 when 'rider' then 4 else 5 end
      limit 1
    ), 'authenticated_user')
  end;

  insert into public.pos_sales_journal (
    restaurant_id, order_id, order_number, event_type, operation,
    actor_user_id, actor_role, old_values, new_values
  ) values (
    v_restaurant_id, v_order_id, v_order_number, v_event_type, tg_op,
    auth.uid(), v_actor_role,
    case when v_old is null then null else public.pos_sales_journal_item_snapshot(v_old) end,
    case when v_new is null then null else public.pos_sales_journal_item_snapshot(v_new) end
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
