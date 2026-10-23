-- Detect historical product category / current VAT-registration mismatches in BIR readiness.
CREATE OR REPLACE FUNCTION public.get_restaurant_bir_issuance_readiness(p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.restaurant_taxpayer_profiles%rowtype;
  v_profile_exists boolean := false;
  v_configured_series_count integer := 0;
  v_enabled_series_count integer := 0;
  v_issued_document_count bigint := 0;
  v_unclassified_product_count bigint := 0;
  v_mismatched_product_tax_category_count bigint := 0;
  v_paid_tax_review_order_count bigint := 0;
  v_completed_tax_review_order_count bigint := 0;
  v_restaurant_vat_registered boolean := false;
  v_non_vat_tax_basis_verified boolean := false;
  v_serial_series jsonb := '[]'::jsonb;
  v_profile_identity_complete boolean := false;
  v_route_evidence_recorded boolean := false;
  v_blockers jsonb := '[]'::jsonb;
begin
  if not (
    public.is_system_admin()
    or exists (
      select 1 from public.restaurants r
      where r.id = p_restaurant_id and r.owner_id = auth.uid()
    )
  ) then
    raise exception 'You are not authorized to view BIR readiness for this restaurant.';
  end if;

  select * into v_profile
  from public.restaurant_taxpayer_profiles
  where restaurant_id = p_restaurant_id;
  v_profile_exists := found;

  SELECT r.tax_vat_registered INTO v_restaurant_vat_registered
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  v_non_vat_tax_basis_verified := v_profile_exists
    AND v_profile.non_vat_tax_basis IN ('subject_to_percentage_tax','not_subject_to_percentage_tax')
    AND v_profile.non_vat_tax_basis_verified_at IS NOT NULL
    AND nullif(trim(v_profile.non_vat_tax_basis_reference), '') IS NOT NULL;

  if v_profile_exists then
    v_profile_identity_complete :=
      nullif(trim(v_profile.registered_legal_name), '') is not null
      and nullif(trim(v_profile.tin), '') is not null
      and nullif(trim(v_profile.registered_address), '') is not null;

    v_route_evidence_recorded :=
      v_profile.bir_approval_recorded_at is not null
      and (
        (v_profile.bir_route_status = 'software_supplier'
          and nullif(trim(v_profile.bir_accreditation_reference), '') is not null
          and nullif(trim(v_profile.bir_permit_to_use_reference), '') is not null)
        or (v_profile.bir_route_status = 'esp'
          and nullif(trim(v_profile.bir_accreditation_reference), '') is not null
          and nullif(trim(v_profile.bir_permit_to_transmit_reference), '') is not null)
        or (v_profile.bir_route_status = 'both'
          and nullif(trim(v_profile.bir_accreditation_reference), '') is not null
          and nullif(trim(v_profile.bir_permit_to_use_reference), '') is not null
          and nullif(trim(v_profile.bir_permit_to_transmit_reference), '') is not null)
      );
  end if;

  select count(*)::integer,
         count(*) filter (where issuance_enabled)::integer
    into v_configured_series_count, v_enabled_series_count
  from public.restaurant_invoice_issuance_configs
  where restaurant_id = p_restaurant_id;

  select count(*) into v_issued_document_count
  from public.issued_sales_documents
  where restaurant_id = p_restaurant_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'branch_code', c.branch_code,
        'document_type', c.document_type,
        'initial_serial', c.initial_serial::text,
        'next_serial', c.next_serial::text,
        'regulatory_route', c.regulatory_route,
        'issuance_enabled', c.issuance_enabled,
        'configured_at', c.configured_at
      )
      order by c.branch_code, c.document_type
    ),
    '[]'::jsonb
  )
  into v_serial_series
  from public.restaurant_invoice_issuance_configs c
  where c.restaurant_id = p_restaurant_id;

  select count(*) into v_unclassified_product_count
  from public.products p
  where p.restaurant_id = p_restaurant_id
    and p.tax_category is null;

  select count(*) into v_mismatched_product_tax_category_count
  from public.products p
  join public.restaurants r on r.id = p.restaurant_id
  where p.restaurant_id = p_restaurant_id
    and p.tax_category is not null
    and (
      (coalesce(r.tax_vat_registered, false)
        and p.tax_category not in ('standard_rate','vat_exempt','zero_rated'))
      or
      (not coalesce(r.tax_vat_registered, false)
        and p.tax_category not in ('percentage_taxable','non_vat_exempt'))
    );

  select count(*) into v_paid_tax_review_order_count
  from public.orders o
  where o.restaurant_id = p_restaurant_id
    and o.total > 0
    and o.payment_status = 'paid'
    and o.status not in ('cancelled', 'refunded')
    and (
      o.tax_snapshot_status is distinct from 'calculated'
      or o.tax_zero_rated_sales is null
      or not exists (
        select 1 from public.order_items oi where oi.order_id = o.id
      )
      or exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id and oi.tax_category_snapshot is null
      )
      or (
        o.discount_beneficiary_count > 0
        and exists (
          select 1 from public.order_discount_beneficiaries b
          where b.order_id = o.id
            and (
              nullif(trim(b.beneficiary_name), '') is null
              or nullif(trim(b.beneficiary_address), '') is null
            )
        )
      )
    );

  -- Preserve the original completed-order diagnostic for existing consumers.
  select count(*) into v_completed_tax_review_order_count
  from public.orders o
  where o.restaurant_id = p_restaurant_id
    and o.total > 0
    and o.status = 'completed'
    and (
      o.tax_snapshot_status is distinct from 'calculated'
      or o.tax_zero_rated_sales is null
      or not exists (
        select 1 from public.order_items oi where oi.order_id = o.id
      )
      or exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id and oi.tax_category_snapshot is null
      )
      or (
        o.discount_beneficiary_count > 0
        and exists (
          select 1 from public.order_discount_beneficiaries b
          where b.order_id = o.id
            and (
              nullif(trim(b.beneficiary_name), '') is null
              or nullif(trim(b.beneficiary_address), '') is null
            )
        )
      )
    );

  if not v_profile_exists then
    v_blockers := v_blockers || jsonb_build_array('Taxpayer registration profile has not been submitted.');
  else
    if not v_profile_identity_complete then
      v_blockers := v_blockers || jsonb_build_array('Registered legal name, TIN, and registered address must be completed from official registration documents.');
    end if;
    if v_profile.profile_status <> 'reviewed' then
      v_blockers := v_blockers || jsonb_build_array('System Admin platform review is not complete.');
    end if;
    if v_profile.bir_route_status not in ('software_supplier','esp','both') then
      v_blockers := v_blockers || jsonb_build_array('The applicable BIR regulatory route is not confirmed.');
    end if;
    if not v_route_evidence_recorded then
      v_blockers := v_blockers || jsonb_build_array('Route-specific BIR approval/permit references and the recorded approval date are incomplete.');
    end if;
  end if;

  if v_configured_series_count = 0 then
    v_blockers := v_blockers || jsonb_build_array('No branch/document invoice serial series has been configured from an authorized starting number.');
  end if;

  if v_unclassified_product_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(format('%s menu product(s) still have no reviewed tax classification.', v_unclassified_product_count));
  end if;

  if v_mismatched_product_tax_category_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(format('%s menu product(s) have a tax category incompatible with the restaurant''s current VAT registration setting.', v_mismatched_product_tax_category_count));
  end if;

  if not coalesce(v_restaurant_vat_registered, false) and not v_non_vat_tax_basis_verified then
    v_blockers := v_blockers || jsonb_build_array('Non-VAT tax basis has not been verified against the taxpayer registration documents and documented tax advice; non-VAT tax calculations remain gated.');
  end if;

  if v_paid_tax_review_order_count > 0 then
    v_blockers := v_blockers || jsonb_build_array(format('%s paid sale(s) have missing, legacy, uncalculated or review-required tax snapshots.', v_paid_tax_review_order_count));
  end if;

  -- Until the approved invoice rendering, full financial truth tables, required
  -- reports/readings, and route-specific transmission/issuance path have passed
  -- acceptance, the application deliberately exposes no official issue API.
  v_blockers := v_blockers || jsonb_build_array('Official invoice issuance remains disabled in the application; the immutable ledger is storage groundwork only.');

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'taxpayer_profile_exists', v_profile_exists,
    'taxpayer_identity_complete', v_profile_identity_complete,
    'taxpayer_profile_status', case when v_profile_exists then v_profile.profile_status else 'missing' end,
    'regulatory_route', case when v_profile_exists then v_profile.bir_route_status else 'unconfirmed' end,
    'route_evidence_recorded', v_route_evidence_recorded,
    'configured_series_count', v_configured_series_count,
    'enabled_series_count', v_enabled_series_count,
    'serial_series', v_serial_series,
    'issued_document_count', v_issued_document_count,
    'unclassified_product_count', v_unclassified_product_count,
    'mismatched_product_tax_category_count', v_mismatched_product_tax_category_count,
    'completed_orders_needing_tax_review', v_completed_tax_review_order_count,
    'paid_orders_needing_tax_review', v_paid_tax_review_order_count,
    'non_vat_tax_basis', case when v_profile_exists then v_profile.non_vat_tax_basis else 'unconfirmed' end,
    'non_vat_tax_basis_verified', v_non_vat_tax_basis_verified,
    'official_invoice_issuance_api_enabled', false,
    'is_bir_accredited', false,
    'blockers', v_blockers,
    'notice', 'Readiness status is a platform checklist only. It is not BIR accreditation, a permit, or tax advice.'
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_restaurant_bir_issuance_readiness(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_bir_issuance_readiness(uuid) TO authenticated;
