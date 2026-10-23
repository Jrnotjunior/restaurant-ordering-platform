-- Internal POS X/Z-style reading previews for implementation/testing.
-- These are explicitly NOT official BIR readings. No business-day lock or official
-- invoice issuance is enabled by this migration.

create table if not exists public.pos_sales_reading_previews (
  reading_id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  business_date date not null,
  reading_type text not null check (reading_type in ('x_preview','z_preview')),
  generated_at timestamptz not null default clock_timestamp(),
  generated_by uuid,
  order_count integer not null default 0,
  completed_order_count integer not null default 0,
  cancelled_order_count integer not null default 0,
  paid_order_count integer not null default 0,
  pending_payment_count integer not null default 0,
  refunded_order_count integer not null default 0,
  discounts_total numeric(14,2) not null default 0,
  delivery_fee_total numeric(14,2) not null default 0,
  completed_sales_total numeric(14,2) not null default 0,
  cumulative_completed_sales_total numeric(16,2) not null default 0,
  tax_review_order_count integer not null default 0,
  unclassified_line_count integer not null default 0,
  tax_summary_complete boolean not null default false,
  vatable_sales numeric(14,2),
  vat_amount numeric(14,2),
  vat_exempt_sales numeric(14,2),
  zero_rated_sales numeric(14,2),
  is_official boolean not null default false check (is_official = false),
  snapshot jsonb not null default '{}'::jsonb
);

create index if not exists pos_sales_reading_previews_restaurant_date_idx
  on public.pos_sales_reading_previews (restaurant_id, business_date desc, generated_at desc);

comment on table public.pos_sales_reading_previews is
  'Internal X/Z-style audit previews only. is_official is constrained false. These rows are not represented as BIR readings or a permit/accreditation artifact.';
comment on column public.pos_sales_reading_previews.cumulative_completed_sales_total is
  'Platform-calculated cumulative total of completed order totals through the report date. It is not a validated BIR grand-total counter.';
comment on column public.pos_sales_reading_previews.tax_summary_complete is
  'True only if the current platform completeness checks pass for completed sales. This does not independently establish tax correctness.';

alter table public.pos_sales_reading_previews enable row level security;
revoke all on table public.pos_sales_reading_previews from public, anon, authenticated, service_role;

drop policy if exists "Owner and system admin can read POS reading previews" on public.pos_sales_reading_previews;
create policy "Owner and system admin can read POS reading previews"
on public.pos_sales_reading_previews
for select
to authenticated
using (
  public.is_system_admin()
  or exists (
    select 1 from public.restaurants r
    where r.id = pos_sales_reading_previews.restaurant_id
      and r.owner_id = auth.uid()
  )
);

create or replace function public.prevent_pos_sales_reading_preview_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Sales reading previews are immutable; generate a new preview to preserve history.';
end;
$$;

revoke all on function public.prevent_pos_sales_reading_preview_mutation() from public, anon, authenticated, service_role;
drop trigger if exists prevent_pos_sales_reading_preview_mutation on public.pos_sales_reading_previews;
create trigger prevent_pos_sales_reading_preview_mutation
before update or delete on public.pos_sales_reading_previews
for each row execute function public.prevent_pos_sales_reading_preview_mutation();

create or replace function public.generate_pos_sales_reading_preview(
  p_restaurant_id uuid,
  p_business_date date,
  p_reading_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_order_count integer := 0;
  v_completed_count integer := 0;
  v_cancelled_count integer := 0;
  v_paid_count integer := 0;
  v_pending_count integer := 0;
  v_refunded_count integer := 0;
  v_discounts numeric(14,2) := 0;
  v_delivery_fee numeric(14,2) := 0;
  v_completed_total numeric(14,2) := 0;
  v_cumulative_total numeric(16,2) := 0;
  v_tax_review_count integer := 0;
  v_unclassified_line_count integer := 0;
  v_tax_complete boolean := false;
  v_vatable numeric(14,2);
  v_vat numeric(14,2);
  v_exempt numeric(14,2);
  v_zero_rated numeric(14,2);
  v_reading_id uuid;
  v_snapshot jsonb;
begin
  if not (
    public.is_system_admin()
    or exists (
      select 1 from public.restaurants r
      where r.id = p_restaurant_id and r.owner_id = auth.uid()
    )
  ) then
    raise exception 'You are not authorized to generate a sales reading preview for this restaurant.';
  end if;

  if p_business_date is null or p_business_date > timezone('Asia/Manila', now())::date then
    raise exception 'Choose a business date that is not in the future.';
  end if;

  if p_reading_type is null or p_reading_type not in ('x_preview','z_preview') then
    raise exception 'Reading type must be x_preview or z_preview.';
  end if;

  v_from := p_business_date::timestamp AT TIME ZONE 'Asia/Manila';
  v_to := (p_business_date + 1)::timestamp AT TIME ZONE 'Asia/Manila';

  -- Serialize preview creation per tenant/day; each generated snapshot is preserved.
  perform pg_advisory_xact_lock(hashtext(p_restaurant_id::text || ':' || p_business_date::text));

  select
    count(*)::integer,
    count(*) filter (where o.status = 'completed')::integer,
    count(*) filter (where o.status = 'cancelled')::integer,
    count(*) filter (where o.payment_status = 'paid')::integer,
    count(*) filter (where o.payment_status = 'pending')::integer,
    count(*) filter (where o.payment_status = 'refunded')::integer,
    coalesce(sum(o.discount_amount) filter (where o.status = 'completed'), 0)::numeric(14,2),
    coalesce(sum(o.delivery_fee) filter (where o.status = 'completed'), 0)::numeric(14,2),
    coalesce(sum(o.total) filter (where o.status = 'completed'), 0)::numeric(14,2)
  into
    v_order_count, v_completed_count, v_cancelled_count, v_paid_count,
    v_pending_count, v_refunded_count, v_discounts, v_delivery_fee, v_completed_total
  from public.orders o
  where o.restaurant_id = p_restaurant_id
    and o.created_at >= v_from and o.created_at < v_to;

  select coalesce(sum(o.total), 0)::numeric(16,2)
  into v_cumulative_total
  from public.orders o
  where o.restaurant_id = p_restaurant_id
    and o.status = 'completed'
    and o.created_at < v_to;

  select count(*)::integer
  into v_tax_review_count
  from public.orders o
  where o.restaurant_id = p_restaurant_id
    and o.created_at >= v_from and o.created_at < v_to
    and o.status = 'completed'
    and o.total > 0
    and (
      o.tax_snapshot_status is distinct from 'calculated'
      or o.tax_zero_rated_sales is null
      or not exists (select 1 from public.order_items oi where oi.order_id = o.id)
      or exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.tax_category_snapshot is null)
    );

  select count(*)::integer
  into v_unclassified_line_count
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.restaurant_id = p_restaurant_id
    and o.created_at >= v_from and o.created_at < v_to
    and o.status = 'completed'
    and oi.tax_category_snapshot is null;

  v_tax_complete := v_tax_review_count = 0 and v_unclassified_line_count = 0;

  if v_tax_complete then
    select
      coalesce(sum(o.tax_vatable_sales), 0)::numeric(14,2),
      coalesce(sum(o.tax_vat_amount), 0)::numeric(14,2),
      coalesce(sum(o.tax_vat_exempt_sales), 0)::numeric(14,2),
      coalesce(sum(o.tax_zero_rated_sales), 0)::numeric(14,2)
    into v_vatable, v_vat, v_exempt, v_zero_rated
    from public.orders o
    where o.restaurant_id = p_restaurant_id
      and o.created_at >= v_from and o.created_at < v_to
      and o.status = 'completed';
  end if;

  v_snapshot := jsonb_build_object(
    'is_official', false,
    'notice', 'Internal sales reading preview only. Not a BIR X-Reading, Z-Reading, invoice, tax return, or approval artifact.',
    'reading_type', p_reading_type,
    'business_date', p_business_date,
    'timezone', 'Asia/Manila',
    'generated_at', clock_timestamp(),
    'order_counts', jsonb_build_object(
      'all_orders', v_order_count,
      'completed', v_completed_count,
      'cancelled', v_cancelled_count,
      'paid', v_paid_count,
      'pending_payment', v_pending_count,
      'refunded', v_refunded_count
    ),
    'platform_totals_php', jsonb_build_object(
      'completed_order_totals', v_completed_total,
      'completed_order_discounts', v_discounts,
      'completed_order_delivery_fees', v_delivery_fee,
      'cumulative_completed_order_totals_through_date', v_cumulative_total
    ),
    'tax_summary', jsonb_build_object(
      'complete', v_tax_complete,
      'orders_needing_review', v_tax_review_count,
      'unclassified_order_lines', v_unclassified_line_count,
      'vatable_sales_php', v_vatable,
      'vat_amount_php', v_vat,
      'vat_exempt_sales_php', v_exempt,
      'zero_rated_sales_php', v_zero_rated
    )
  );

  insert into public.pos_sales_reading_previews (
    restaurant_id, business_date, reading_type, generated_by,
    order_count, completed_order_count, cancelled_order_count, paid_order_count,
    pending_payment_count, refunded_order_count, discounts_total, delivery_fee_total,
    completed_sales_total, cumulative_completed_sales_total, tax_review_order_count,
    unclassified_line_count, tax_summary_complete, vatable_sales, vat_amount,
    vat_exempt_sales, zero_rated_sales, snapshot
  ) values (
    p_restaurant_id, p_business_date, p_reading_type, auth.uid(),
    v_order_count, v_completed_count, v_cancelled_count, v_paid_count,
    v_pending_count, v_refunded_count, v_discounts, v_delivery_fee,
    v_completed_total, v_cumulative_total, v_tax_review_count,
    v_unclassified_line_count, v_tax_complete, v_vatable, v_vat,
    v_exempt, v_zero_rated, v_snapshot
  ) returning reading_id into v_reading_id;

  return v_snapshot || jsonb_build_object(
    'reading_id', v_reading_id,
    'generated_by', auth.uid()
  );
end;
$$;

revoke all on function public.generate_pos_sales_reading_preview(uuid,date,text) from public, anon;
grant execute on function public.generate_pos_sales_reading_preview(uuid,date,text) to authenticated;

create or replace function public.get_pos_sales_reading_previews(
  p_restaurant_id uuid,
  p_business_date date,
  p_limit integer default 25
)
returns table (
  reading_id uuid,
  business_date date,
  reading_type text,
  generated_at timestamptz,
  generated_by uuid,
  order_count integer,
  completed_order_count integer,
  cancelled_order_count integer,
  paid_order_count integer,
  pending_payment_count integer,
  refunded_order_count integer,
  completed_sales_total numeric,
  cumulative_completed_sales_total numeric,
  discounts_total numeric,
  delivery_fee_total numeric,
  tax_review_order_count integer,
  unclassified_line_count integer,
  tax_summary_complete boolean,
  snapshot jsonb,
  is_official boolean
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
    raise exception 'You are not authorized to read sales reading previews for this restaurant.';
  end if;

  return query
  select p.reading_id, p.business_date, p.reading_type, p.generated_at, p.generated_by,
         p.order_count, p.completed_order_count, p.cancelled_order_count, p.paid_order_count,
         p.pending_payment_count, p.refunded_order_count, p.completed_sales_total,
         p.cumulative_completed_sales_total, p.discounts_total, p.delivery_fee_total,
         p.tax_review_order_count, p.unclassified_line_count, p.tax_summary_complete,
         p.snapshot, p.is_official
  from public.pos_sales_reading_previews p
  where p.restaurant_id = p_restaurant_id
    and p.business_date = p_business_date
  order by p.generated_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100));
end;
$$;

revoke all on function public.get_pos_sales_reading_previews(uuid,date,integer) from public, anon;
grant execute on function public.get_pos_sales_reading_previews(uuid,date,integer) to authenticated;
