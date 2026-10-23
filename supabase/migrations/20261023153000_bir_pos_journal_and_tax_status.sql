-- Add explicit tax snapshot provenance and append-only POS sales activity journal.
-- Historical rows are never silently promoted to calculated; existing amounts are preserved.

alter table public.orders
  add column if not exists tax_snapshot_status text,
  add column if not exists tax_snapshot_version smallint;

update public.orders
set tax_snapshot_status = 'legacy_unknown'
where tax_snapshot_status is null;

alter table public.orders
  alter column tax_snapshot_status set default 'not_calculated',
  alter column tax_snapshot_status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_tax_snapshot_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_tax_snapshot_status_check
      check (tax_snapshot_status in ('legacy_unknown', 'not_calculated', 'calculated', 'requires_review'));
  end if;
end $$;

comment on column public.orders.tax_snapshot_status is
  'Provenance state for tax snapshot values. Legacy rows are not backfilled or inferred; calculated means the current server-side POS calculation routine wrote the snapshot.';
comment on column public.orders.tax_snapshot_version is
  'Version of the server-side tax snapshot calculation used for this order, NULL when unknown or not calculated.';

create or replace function public.flag_order_tax_snapshot_review()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.tax_snapshot_status = 'calculated'
    and (
      new.subtotal is distinct from old.subtotal
      or new.delivery_fee is distinct from old.delivery_fee
      or new.discount_amount is distinct from old.discount_amount
      or new.total is distinct from old.total
    )
    and new.tax_vat_registered is not distinct from old.tax_vat_registered
    and new.tax_prices_vat_inclusive is not distinct from old.tax_prices_vat_inclusive
    and new.tax_vat_rate is not distinct from old.tax_vat_rate
    and new.tax_gross_sales is not distinct from old.tax_gross_sales
    and new.tax_vatable_sales is not distinct from old.tax_vatable_sales
    and new.tax_vat_amount is not distinct from old.tax_vat_amount
    and new.tax_vat_exempt_sales is not distinct from old.tax_vat_exempt_sales
    and new.tax_net_sales is not distinct from old.tax_net_sales
  then
    new.tax_snapshot_status := 'requires_review';
    new.tax_snapshot_version := null;
  end if;
  return new;
end;
$$;

revoke all on function public.flag_order_tax_snapshot_review() from public, anon, authenticated;

drop trigger if exists flag_order_tax_snapshot_review on public.orders;
create trigger flag_order_tax_snapshot_review
before update on public.orders
for each row execute function public.flag_order_tax_snapshot_review();

create or replace function public.apply_pos_group_discounts(
  p_order_id uuid,
  p_group_size integer,
  p_beneficiaries jsonb
)
returns table (
  order_id uuid,
  group_size integer,
  beneficiary_count integer,
  discount_amount numeric,
  gross_sales numeric,
  vatable_sales numeric,
  vat_amount numeric,
  vat_exempt_sales numeric,
  net_sales numeric,
  total numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_restaurant public.restaurants%rowtype;
  v_beneficiary jsonb;
  v_type text;
  v_id_type text;
  v_id_number text;
  v_base_net numeric(12,2);
  v_eligible_net_share numeric(12,2);
  v_discount numeric(12,2);
  v_total_discount numeric(12,2) := 0;
  v_vatable_sales numeric(12,2);
  v_vat_amount numeric(12,2);
  v_vat_exempt_sales numeric(12,2);
  v_net_sales numeric(12,2);
  v_total numeric(12,2);
  v_count integer;
begin
  if p_group_size is null or p_group_size < 1 then
    raise exception 'Group size must be at least 1';
  end if;

  if jsonb_typeof(p_beneficiaries) <> 'array' then
    raise exception 'Discount beneficiaries must be an array';
  end if;

  v_count := jsonb_array_length(p_beneficiaries);

  if v_count > p_group_size then
    raise exception 'Discount beneficiaries cannot exceed the group size';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  select * into v_restaurant
  from public.restaurants r
  where r.id = v_order.restaurant_id;

  if not found then
    raise exception 'Restaurant not found';
  end if;

  if not (
    v_restaurant.owner_id = auth.uid()
    or exists (
      select 1
      from public.restaurant_staff s
      where s.restaurant_id = v_order.restaurant_id
        and s.auth_user_id = auth.uid()
        and s.role = 'cashier'
        and s.is_active = true
    )
  ) then
    raise exception 'You are not authorized to finalize POS financials for this order';
  end if;

  if coalesce(v_order.discount_beneficiary_count, 0) > 0
     or coalesce(v_order.discount_amount, 0) > 0
     or v_order.discount_type is not null
     or coalesce(v_order.tax_net_sales, 0) > 0
     or v_order.tax_snapshot_status in ('calculated', 'requires_review') then
    raise exception 'POS financials have already been finalized for this order';
  end if;

  if v_count > 0 then
    for v_beneficiary in select value from jsonb_array_elements(p_beneficiaries) loop
      v_type := lower(trim(coalesce(v_beneficiary->>'discount_type', '')));
      v_id_type := trim(coalesce(v_beneficiary->>'discount_id_type', ''));
      v_id_number := trim(coalesce(v_beneficiary->>'discount_id_number', ''));

      if v_type not in ('senior', 'pwd') then
        raise exception 'Invalid discount type';
      end if;

      if length(v_id_type) = 0 then
        raise exception 'ID type is required for every discount beneficiary';
      end if;

      if length(v_id_number) = 0 then
        raise exception 'ID number is required for every discount beneficiary';
      end if;

      if exists (
        select 1
        from public.order_discount_beneficiaries b
        where b.order_id = p_order_id
          and b.discount_id_number = v_id_number
      ) then
        raise exception 'The same ID number cannot be used twice on one order';
      end if;
    end loop;
  end if;

  -- Normalize the restaurant's configured prices into VAT-exclusive sales.
  v_base_net :=
    case
      when v_restaurant.tax_vat_registered and v_restaurant.tax_prices_vat_inclusive
        then round(v_order.subtotal / (1 + (v_restaurant.tax_vat_rate / 100)), 2)
      else round(v_order.subtotal, 2)
    end;

  v_eligible_net_share :=
    case
      when v_count > 0 then round(v_base_net / p_group_size, 2)
      else 0
    end;

  if v_count > 0 then
    for v_beneficiary in select value from jsonb_array_elements(p_beneficiaries) loop
      v_discount := round(v_eligible_net_share * 0.20, 2);
      v_total_discount := v_total_discount + v_discount;

      insert into public.order_discount_beneficiaries (
        order_id,
        discount_type,
        discount_id_type,
        discount_id_number,
        eligible_amount,
        discount_amount
      ) values (
        p_order_id,
        lower(trim(v_beneficiary->>'discount_type')),
        trim(v_beneficiary->>'discount_id_type'),
        trim(v_beneficiary->>'discount_id_number'),
        v_eligible_net_share,
        v_discount
      );
    end loop;
  end if;

  v_vatable_sales := greatest(
    round(v_base_net - (v_eligible_net_share * v_count), 2),
    0
  );

  v_vat_amount :=
    case
      when v_restaurant.tax_vat_registered
        then round(v_vatable_sales * (v_restaurant.tax_vat_rate / 100), 2)
      else 0
    end;

  v_vat_exempt_sales :=
    case
      when v_count > 0
        then greatest(round((v_eligible_net_share * v_count) - v_total_discount, 2), 0)
      else 0
    end;

  v_net_sales := round(v_vatable_sales + v_vat_exempt_sales, 2);
  v_total := greatest(round(v_net_sales + v_vat_amount + v_order.delivery_fee, 2), 0);

  update public.orders
  set
    tax_vat_registered = v_restaurant.tax_vat_registered,
    tax_prices_vat_inclusive = v_restaurant.tax_prices_vat_inclusive,
    tax_vat_rate = case when v_restaurant.tax_vat_registered then v_restaurant.tax_vat_rate else 0 end,
    tax_gross_sales = round(v_order.subtotal, 2),
    tax_vatable_sales = v_vatable_sales,
    tax_vat_amount = v_vat_amount,
    tax_vat_exempt_sales = v_vat_exempt_sales,
    tax_net_sales = v_net_sales,
    tax_snapshot_status = 'calculated',
    tax_snapshot_version = 1,
    discount_type = case when v_count = 1 then lower(trim(p_beneficiaries->0->>'discount_type')) else null end,
    discount_id_number = case when v_count = 1 then trim(p_beneficiaries->0->>'discount_id_number') else null end,
    discount_amount = v_total_discount,
    discount_group_size = p_group_size,
    discount_beneficiary_count = v_count,
    total = v_total,
    updated_at = now()
  where id = p_order_id;

  return query
  select
    p_order_id,
    p_group_size,
    v_count,
    v_total_discount,
    round(v_order.subtotal, 2),
    v_vatable_sales,
    v_vat_amount,
    v_vat_exempt_sales,
    v_net_sales,
    v_total;
end;
$$;

grant execute on function public.apply_pos_group_discounts(uuid, integer, jsonb) to authenticated;

create table if not exists public.pos_sales_journal (
  journal_id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  transaction_id bigint not null default txid_current(),
  restaurant_id uuid,
  order_id uuid,
  order_number text,
  event_type text not null,
  operation text not null,
  actor_user_id uuid,
  actor_role text,
  old_values jsonb,
  new_values jsonb
);

create index if not exists pos_sales_journal_restaurant_time_idx
  on public.pos_sales_journal (restaurant_id, occurred_at desc);
create index if not exists pos_sales_journal_order_time_idx
  on public.pos_sales_journal (order_id, occurred_at desc);

alter table public.pos_sales_journal enable row level security;
revoke all on table public.pos_sales_journal from public, anon, authenticated, service_role;
grant select on table public.pos_sales_journal to authenticated;

drop policy if exists "System admins and restaurant owners can read POS sales journal" on public.pos_sales_journal;
create policy "System admins and restaurant owners can read POS sales journal"
on public.pos_sales_journal
for select
to authenticated
using (
  public.is_system_admin()
  or exists (
    select 1 from public.restaurants r
    where r.id = pos_sales_journal.restaurant_id
      and r.owner_id = auth.uid()
  )
);

create or replace function public.pos_sales_journal_order_snapshot(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'order_id', p_row -> 'id',
    'order_number', p_row -> 'order_number',
    'order_type', p_row -> 'order_type',
    'payment_method', p_row -> 'payment_method',
    'payment_status', p_row -> 'payment_status',
    'order_status', p_row -> 'status',
    'subtotal', p_row -> 'subtotal',
    'delivery_fee', p_row -> 'delivery_fee',
    'discount_amount', p_row -> 'discount_amount',
    'total', p_row -> 'total',
    'tax_snapshot_status', p_row -> 'tax_snapshot_status',
    'tax_snapshot_version', p_row -> 'tax_snapshot_version',
    'tax_vat_registered', p_row -> 'tax_vat_registered',
    'tax_prices_vat_inclusive', p_row -> 'tax_prices_vat_inclusive',
    'tax_vat_rate', p_row -> 'tax_vat_rate',
    'tax_gross_sales', p_row -> 'tax_gross_sales',
    'tax_vatable_sales', p_row -> 'tax_vatable_sales',
    'tax_vat_amount', p_row -> 'tax_vat_amount',
    'tax_vat_exempt_sales', p_row -> 'tax_vat_exempt_sales',
    'tax_net_sales', p_row -> 'tax_net_sales',
    'paymongo_fee', p_row -> 'paymongo_fee',
    'paymongo_net_amount', p_row -> 'paymongo_net_amount',
    'refund_status', p_row -> 'cancellation_refund_status',
    'created_at', p_row -> 'created_at',
    'updated_at', p_row -> 'updated_at'
  ));
$$;

create or replace function public.pos_sales_journal_item_snapshot(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'order_item_id', p_row -> 'id',
    'order_id', p_row -> 'order_id',
    'product_id', p_row -> 'product_id',
    'product_name', p_row -> 'product_name',
    'unit_price', p_row -> 'unit_price',
    'quantity', p_row -> 'quantity',
    'line_total', p_row -> 'line_total',
    'created_at', p_row -> 'created_at'
  ));
$$;

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

    insert into public.pos_sales_journal (
      restaurant_id, order_id, order_number, event_type, operation,
      actor_user_id, actor_role, old_values, new_values
    ) values (
      v_restaurant_id, v_order_id, v_order_number, v_event_type, tg_op,
      auth.uid(), nullif(current_setting('request.jwt.claim.role', true), ''),
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

  insert into public.pos_sales_journal (
    restaurant_id, order_id, order_number, event_type, operation,
    actor_user_id, actor_role, old_values, new_values
  ) values (
    v_restaurant_id, v_order_id, v_order_number, v_event_type, tg_op,
    auth.uid(), nullif(current_setting('request.jwt.claim.role', true), ''),
    case when v_old is null then null else public.pos_sales_journal_item_snapshot(v_old) end,
    case when v_new is null then null else public.pos_sales_journal_item_snapshot(v_new) end
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

revoke all on function public.capture_pos_sales_journal() from public, anon, authenticated, service_role;
revoke all on function public.pos_sales_journal_order_snapshot(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.pos_sales_journal_item_snapshot(jsonb) from public, anon, authenticated, service_role;

drop trigger if exists capture_pos_sales_journal on public.orders;
create trigger capture_pos_sales_journal
after insert or update or delete on public.orders
for each row execute function public.capture_pos_sales_journal();

drop trigger if exists capture_pos_item_sales_journal on public.order_items;
create trigger capture_pos_item_sales_journal
after insert or update or delete on public.order_items
for each row execute function public.capture_pos_sales_journal();

create or replace function public.prevent_pos_sales_journal_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'POS sales journal is append-only; corrections must be recorded as new events.';
end;
$$;

revoke all on function public.prevent_pos_sales_journal_mutation() from public, anon, authenticated, service_role;
drop trigger if exists prevent_pos_sales_journal_mutation on public.pos_sales_journal;
create trigger prevent_pos_sales_journal_mutation
before update or delete on public.pos_sales_journal
for each row execute function public.prevent_pos_sales_journal_mutation();

create or replace function public.get_restaurant_tax_snapshot_statuses(p_restaurant_id uuid)
returns table(order_id uuid, tax_snapshot_status text, tax_snapshot_version smallint)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not (
    public.is_system_admin()
    or exists (
      select 1 from public.restaurants r
      where r.id = p_restaurant_id and r.owner_id = auth.uid()
    )
  ) then
    raise exception 'You are not authorized to view this restaurant tax status.';
  end if;

  return query
  select o.id, o.tax_snapshot_status, o.tax_snapshot_version
  from public.orders o
  where o.restaurant_id = p_restaurant_id;
end;
$$;

revoke all on function public.get_restaurant_tax_snapshot_statuses(uuid) from public, anon;
grant execute on function public.get_restaurant_tax_snapshot_statuses(uuid) to authenticated;

create or replace function public.get_restaurant_pos_sales_journal(
  p_restaurant_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 1000
)
returns table(
  journal_id bigint,
  occurred_at timestamptz,
  transaction_id bigint,
  order_id uuid,
  order_number text,
  event_type text,
  operation text,
  actor_user_id uuid,
  actor_role text,
  old_values jsonb,
  new_values jsonb
)
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
begin
  if not (
    public.is_system_admin()
    or exists (
      select 1 from public.restaurants r
      where r.id = p_restaurant_id and r.owner_id = auth.uid()
    )
  ) then
    raise exception 'You are not authorized to view this restaurant POS journal.';
  end if;

  if p_from is not null and p_to is not null and p_to <= p_from then
    raise exception 'The journal end time must be after the start time.';
  end if;

  return query
  select j.journal_id, j.occurred_at, j.transaction_id, j.order_id,
         j.order_number, j.event_type, j.operation, j.actor_user_id,
         j.actor_role, j.old_values, j.new_values
  from public.pos_sales_journal j
  where j.restaurant_id = p_restaurant_id
    and (p_from is null or j.occurred_at >= p_from)
    and (p_to is null or j.occurred_at < p_to)
  order by j.occurred_at desc, j.journal_id desc
  limit greatest(1, least(coalesce(p_limit, 1000), 5000));
end;
$$;

revoke all on function public.get_restaurant_pos_sales_journal(uuid, timestamptz, timestamptz, integer) from public, anon;
grant execute on function public.get_restaurant_pos_sales_journal(uuid, timestamptz, timestamptz, integer) to authenticated;
