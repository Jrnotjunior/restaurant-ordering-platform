-- Capture POS Senior Citizen / PWD beneficiary changes without copying sensitive ID numbers into the journal.
create or replace function public.capture_pos_discount_beneficiary_journal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_order_id uuid;
  v_restaurant_id uuid;
  v_order_number text;
  v_event_type text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);
  v_order_id := nullif(v_row ->> 'order_id', '')::uuid;

  select o.restaurant_id, o.order_number
    into v_restaurant_id, v_order_number
    from public.orders o
    where o.id = v_order_id;

  -- The order-level deletion event is retained when beneficiary rows disappear via cascade.
  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_event_type := case tg_op
    when 'INSERT' then 'DISCOUNT_BENEFICIARY_ADDED'
    when 'UPDATE' then 'DISCOUNT_BENEFICIARY_CHANGED'
    else 'DISCOUNT_BENEFICIARY_REMOVED'
  end;

  insert into public.pos_sales_journal (
    restaurant_id, order_id, order_number, event_type, operation,
    actor_user_id, actor_role, old_values, new_values
  ) values (
    v_restaurant_id, v_order_id, v_order_number, v_event_type, tg_op,
    auth.uid(), nullif(current_setting('request.jwt.claim.role', true), ''),
    case when v_old is null then null else jsonb_strip_nulls(jsonb_build_object(
      'discount_type', v_old -> 'discount_type',
      'discount_id_type', v_old -> 'discount_id_type',
      'eligible_amount', v_old -> 'eligible_amount',
      'discount_amount', v_old -> 'discount_amount',
      'created_at', v_old -> 'created_at'
    )) end,
    case when v_new is null then null else jsonb_strip_nulls(jsonb_build_object(
      'discount_type', v_new -> 'discount_type',
      'discount_id_type', v_new -> 'discount_id_type',
      'eligible_amount', v_new -> 'eligible_amount',
      'discount_amount', v_new -> 'discount_amount',
      'created_at', v_new -> 'created_at'
    )) end
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.capture_pos_discount_beneficiary_journal() from public, anon, authenticated, service_role;

drop trigger if exists capture_pos_discount_beneficiary_journal on public.order_discount_beneficiaries;
create trigger capture_pos_discount_beneficiary_journal
after insert or update or delete on public.order_discount_beneficiaries
for each row execute function public.capture_pos_discount_beneficiary_journal();
