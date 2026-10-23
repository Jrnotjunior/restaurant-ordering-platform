-- View-only System Admin accounts may inspect profile/readiness and read previews,
-- but may not submit taxpayer profile changes or generate new immutable reading records.

create or replace function public.save_restaurant_taxpayer_profile(
  p_restaurant_id uuid,
  p_registered_legal_name text,
  p_trade_name text,
  p_tin text,
  p_registered_address text,
  p_branch_code text,
  p_taxpayer_category text,
  p_submit_for_review boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_status text;
  v_result public.restaurant_taxpayer_profiles%rowtype;
  v_category text := coalesce(nullif(trim(p_taxpayer_category), ''), 'unknown');
  v_legal_name text := nullif(trim(p_registered_legal_name), '');
  v_trade_name text := nullif(trim(p_trade_name), '');
  v_tin text := nullif(trim(p_tin), '');
  v_address text := nullif(trim(p_registered_address), '');
  v_branch_code text := nullif(trim(p_branch_code), '');
begin
  select owner_id into v_owner_id
  from public.restaurants
  where id = p_restaurant_id;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  if not (public.is_system_admin_manager() or v_owner_id = auth.uid()) then
    raise exception 'Only this restaurant owner or the System Administrator can save taxpayer registration details.';
  end if;

  if v_category not in ('micro','small','medium','large','large_taxpayer','unknown') then
    raise exception 'Choose a valid taxpayer category.';
  end if;

  if p_submit_for_review is true then
    if v_legal_name is null or v_tin is null or v_address is null then
      raise exception 'Enter the registered legal name, TIN and registered address before submitting for review.';
    end if;
    v_status := 'submitted_for_review';
  else
    v_status := 'draft';
  end if;

  insert into public.restaurant_taxpayer_profiles (
    restaurant_id, registered_legal_name, trade_name, tin, registered_address,
    branch_code, taxpayer_category, profile_status, review_note, reviewed_by, reviewed_at, updated_at
  ) values (
    p_restaurant_id, v_legal_name, v_trade_name, v_tin, v_address,
    v_branch_code, v_category, v_status, null, null, null, now()
  )
  on conflict (restaurant_id) do update set
    registered_legal_name = excluded.registered_legal_name,
    trade_name = excluded.trade_name,
    tin = excluded.tin,
    registered_address = excluded.registered_address,
    branch_code = excluded.branch_code,
    taxpayer_category = excluded.taxpayer_category,
    profile_status = excluded.profile_status,
    review_note = null,
    reviewed_by = null,
    reviewed_at = null,
    updated_at = now()
  returning * into v_result;

  return jsonb_build_object(
    'restaurant_id', v_result.restaurant_id,
    'registered_legal_name', v_result.registered_legal_name,
    'trade_name', v_result.trade_name,
    'tin', v_result.tin,
    'registered_address', v_result.registered_address,
    'branch_code', v_result.branch_code,
    'taxpayer_category', v_result.taxpayer_category,
    'profile_status', v_result.profile_status,
    'review_note', v_result.review_note,
    'reviewed_at', v_result.reviewed_at,
    'bir_route_status', v_result.bir_route_status,
    'bir_accreditation_reference', v_result.bir_accreditation_reference,
    'bir_permit_to_use_reference', v_result.bir_permit_to_use_reference,
    'bir_permit_to_transmit_reference', v_result.bir_permit_to_transmit_reference,
    'approved_software_version', v_result.approved_software_version,
    'bir_approval_recorded_at', v_result.bir_approval_recorded_at
  );
end;
$$;
revoke all on function public.save_restaurant_taxpayer_profile(uuid,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.save_restaurant_taxpayer_profile(uuid,text,text,text,text,text,text,boolean) to authenticated;

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
    public.is_system_admin_manager()
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
