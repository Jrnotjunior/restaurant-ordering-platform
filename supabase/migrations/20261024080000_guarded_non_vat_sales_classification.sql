-- Add a guarded non-VAT sales classification path; never infer the taxpayer's percentage-tax regime.
-- Legacy order and line snapshots remain unchanged. Official invoice issuance remains disabled.

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_tax_category_check;
ALTER TABLE public.products ADD CONSTRAINT products_tax_category_check
  CHECK (tax_category IS NULL OR tax_category IN ('standard_rate','vat_exempt','zero_rated','percentage_taxable','non_vat_exempt'));

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_tax_category_snapshot_check;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_tax_category_snapshot_check
  CHECK (tax_category_snapshot IS NULL OR tax_category_snapshot IN ('standard_rate','vat_exempt','zero_rated','percentage_taxable','non_vat_exempt'));

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_percentage_taxable_sales numeric(12,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_non_vat_exempt_sales numeric(12,2);

ALTER TABLE public.restaurant_taxpayer_profiles
  ADD COLUMN IF NOT EXISTS non_vat_tax_basis text NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN IF NOT EXISTS non_vat_tax_basis_reference text,
  ADD COLUMN IF NOT EXISTS non_vat_tax_basis_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS non_vat_tax_basis_verified_by uuid,
  ADD COLUMN IF NOT EXISTS non_vat_tax_basis_review_note text;

ALTER TABLE public.restaurant_taxpayer_profiles DROP CONSTRAINT IF EXISTS restaurant_taxpayer_profiles_non_vat_tax_basis_check;
ALTER TABLE public.restaurant_taxpayer_profiles ADD CONSTRAINT restaurant_taxpayer_profiles_non_vat_tax_basis_check
  CHECK (non_vat_tax_basis IN ('unconfirmed','subject_to_percentage_tax','not_subject_to_percentage_tax'));

COMMENT ON COLUMN public.products.tax_category IS
  'Reviewed product sales/tax classification. VAT categories apply to the VAT route; percentage_taxable and non_vat_exempt apply only to a reviewed non-VAT route. NULL means unclassified.';
COMMENT ON COLUMN public.order_items.tax_category_snapshot IS
  'Immutable-at-line-creation copy of the product tax/sales classification. Historical NULL values are not inferred.';
COMMENT ON COLUMN public.orders.tax_percentage_taxable_sales IS
  'Non-VAT sale value classified as subject to percentage tax when the taxpayer basis is verified. This is a sales breakdown, not tax liability or an additional buyer charge.';
COMMENT ON COLUMN public.orders.tax_non_vat_exempt_sales IS
  'Non-VAT sale value classified as exempt under the verified non-VAT basis; distinct from VAT-exempt sales.';
COMMENT ON COLUMN public.restaurant_taxpayer_profiles.non_vat_tax_basis IS
  'Owner-provided non-VAT tax-basis request. No calculation is enabled until a privileged reviewer verifies its evidence reference.';
COMMENT ON COLUMN public.restaurant_taxpayer_profiles.non_vat_tax_basis_reference IS
  'Reference to the applicable taxpayer registration document or written accountant/tax advice checked by an authorized reviewer.';
COMMENT ON COLUMN public.restaurant_taxpayer_profiles.non_vat_tax_basis_verified_at IS
  'Timestamp of privileged platform review of the non-VAT tax basis evidence. This is not BIR approval or a substitute for professional advice.';

CREATE OR REPLACE FUNCTION public.set_restaurant_product_tax_category(p_product_id uuid, p_tax_category text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_restaurant_id uuid;
  v_old_tax_category text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_tax_category is not null and p_tax_category not in ('standard_rate','vat_exempt','zero_rated','percentage_taxable','non_vat_exempt') then
    raise exception 'Tax category must be a supported VAT or non-VAT category, or NULL for unclassified.';
  end if;

  select p.restaurant_id, p.tax_category
    into v_restaurant_id, v_old_tax_category
    from public.products p
    join public.restaurants r on r.id = p.restaurant_id
    where p.id = p_product_id
      and r.owner_id = auth.uid()
      and r.is_active = true
    for update of p;

  if not found then
    raise exception 'Product not found or you are not authorized to update it.' using errcode = '42501';
  end if;

  update public.products
     set tax_category = p_tax_category,
         updated_at = now()
   where id = p_product_id
     and restaurant_id = v_restaurant_id;

  return p_tax_category;
end;
$function$;


REVOKE ALL ON FUNCTION public.set_restaurant_product_tax_category(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_restaurant_product_tax_category(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_restaurant_taxpayer_profile(p_restaurant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.restaurant_taxpayer_profiles%rowtype;
begin
  if not (
    public.is_system_admin()
    or exists (
      select 1 from public.restaurants r
      where r.id = p_restaurant_id and r.owner_id = auth.uid()
    )
  ) then
    raise exception 'You are not authorized to view this taxpayer profile.';
  end if;

  select * into v_profile
  from public.restaurant_taxpayer_profiles
  where restaurant_id = p_restaurant_id;

  if not found then
    return jsonb_build_object(
      'restaurant_id', p_restaurant_id,
      'registered_legal_name', null,
      'trade_name', null,
      'tin', null,
      'registered_address', null,
      'branch_code', null,
      'taxpayer_category', 'unknown',
      'profile_status', 'draft',
      'review_note', null,
      'reviewed_at', null,
      'bir_route_status', 'unconfirmed',
      'bir_accreditation_reference', null,
      'bir_permit_to_use_reference', null,
      'bir_permit_to_transmit_reference', null,
      'approved_software_version', null,
      'bir_approval_recorded_at', null,
      'non_vat_tax_basis', 'unconfirmed',
      'non_vat_tax_basis_reference', null,
      'non_vat_tax_basis_verified_at', null,
      'non_vat_tax_basis_verified_by', null,
      'non_vat_tax_basis_review_note', null
    );
  end if;

  return jsonb_build_object(
    'restaurant_id', v_profile.restaurant_id,
    'registered_legal_name', v_profile.registered_legal_name,
    'trade_name', v_profile.trade_name,
    'tin', v_profile.tin,
    'registered_address', v_profile.registered_address,
    'branch_code', v_profile.branch_code,
    'taxpayer_category', v_profile.taxpayer_category,
    'profile_status', v_profile.profile_status,
    'review_note', v_profile.review_note,
    'reviewed_at', v_profile.reviewed_at,
    'bir_route_status', v_profile.bir_route_status,
    'bir_accreditation_reference', v_profile.bir_accreditation_reference,
    'bir_permit_to_use_reference', v_profile.bir_permit_to_use_reference,
    'bir_permit_to_transmit_reference', v_profile.bir_permit_to_transmit_reference,
    'approved_software_version', v_profile.approved_software_version,
    'bir_approval_recorded_at', v_profile.bir_approval_recorded_at,
    'non_vat_tax_basis', v_profile.non_vat_tax_basis,
    'non_vat_tax_basis_reference', v_profile.non_vat_tax_basis_reference,
    'non_vat_tax_basis_verified_at', v_profile.non_vat_tax_basis_verified_at,
    'non_vat_tax_basis_verified_by', v_profile.non_vat_tax_basis_verified_by,
    'non_vat_tax_basis_review_note', v_profile.non_vat_tax_basis_review_note
  );
end;
$function$;


REVOKE ALL ON FUNCTION public.get_restaurant_taxpayer_profile(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_taxpayer_profile(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_restaurant_non_vat_tax_basis(
  p_restaurant_id uuid,
  p_non_vat_tax_basis text,
  p_evidence_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner_id uuid;
  v_is_vat_registered boolean;
  v_result public.restaurant_taxpayer_profiles%ROWTYPE;
  v_basis text := coalesce(nullif(trim(p_non_vat_tax_basis), ''), 'unconfirmed');
  v_reference text := nullif(trim(p_evidence_reference), '');
BEGIN
  SELECT r.owner_id, r.tax_vat_registered
    INTO v_owner_id, v_is_vat_registered
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found.'; END IF;
  IF NOT (public.is_system_admin() OR v_owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the restaurant owner or System Admin may submit a non-VAT tax basis.' USING errcode = '42501';
  END IF;
  IF coalesce(v_is_vat_registered, false) THEN
    RAISE EXCEPTION 'A non-VAT tax basis cannot be set for a VAT-registered restaurant.';
  END IF;
  IF v_basis NOT IN ('unconfirmed','subject_to_percentage_tax','not_subject_to_percentage_tax') THEN
    RAISE EXCEPTION 'Choose a supported non-VAT tax basis.';
  END IF;
  IF v_basis <> 'unconfirmed' AND v_reference IS NULL THEN
    RAISE EXCEPTION 'Add a reference to the taxpayer registration documents or written tax advice.';
  END IF;
  IF v_reference IS NOT NULL AND length(v_reference) > 500 THEN
    RAISE EXCEPTION 'Evidence reference must be 500 characters or fewer.';
  END IF;

  UPDATE public.restaurant_taxpayer_profiles p
     SET non_vat_tax_basis = v_basis,
         non_vat_tax_basis_reference = v_reference,
         non_vat_tax_basis_verified_at = CASE
           WHEN p.non_vat_tax_basis IS DISTINCT FROM v_basis
             OR p.non_vat_tax_basis_reference IS DISTINCT FROM v_reference
             THEN NULL ELSE p.non_vat_tax_basis_verified_at END,
         non_vat_tax_basis_verified_by = CASE
           WHEN p.non_vat_tax_basis IS DISTINCT FROM v_basis
             OR p.non_vat_tax_basis_reference IS DISTINCT FROM v_reference
             THEN NULL ELSE p.non_vat_tax_basis_verified_by END,
         non_vat_tax_basis_review_note = CASE
           WHEN p.non_vat_tax_basis IS DISTINCT FROM v_basis
             OR p.non_vat_tax_basis_reference IS DISTINCT FROM v_reference
             THEN NULL ELSE p.non_vat_tax_basis_review_note END,
         updated_at = now()
   WHERE p.restaurant_id = p_restaurant_id
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Save the taxpayer registration profile before submitting the non-VAT tax basis.';
  END IF;

  RETURN jsonb_build_object(
    'restaurant_id', v_result.restaurant_id,
    'non_vat_tax_basis', v_result.non_vat_tax_basis,
    'non_vat_tax_basis_reference', v_result.non_vat_tax_basis_reference,
    'non_vat_tax_basis_verified_at', v_result.non_vat_tax_basis_verified_at,
    'non_vat_tax_basis_verified_by', v_result.non_vat_tax_basis_verified_by,
    'non_vat_tax_basis_review_note', v_result.non_vat_tax_basis_review_note
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_restaurant_non_vat_tax_basis(uuid,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.save_restaurant_non_vat_tax_basis(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.system_admin_confirm_restaurant_non_vat_tax_basis(
  p_restaurant_id uuid,
  p_review_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result public.restaurant_taxpayer_profiles%ROWTYPE;
  v_is_vat_registered boolean;
  v_review_note text := nullif(trim(p_review_note), '');
BEGIN
  IF NOT public.is_system_admin_manager() THEN
    RAISE EXCEPTION 'System Admin manager access with required MFA is required.' USING errcode = '42501';
  END IF;
  IF v_review_note IS NULL OR length(v_review_note) > 1000 THEN
    RAISE EXCEPTION 'Record a concise note describing the document/evidence reviewed.';
  END IF;

  SELECT r.tax_vat_registered INTO v_is_vat_registered
  FROM public.restaurants r WHERE r.id = p_restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found.'; END IF;
  IF coalesce(v_is_vat_registered, false) THEN
    RAISE EXCEPTION 'This verification function is only for non-VAT taxpayers.';
  END IF;

  UPDATE public.restaurant_taxpayer_profiles p
     SET non_vat_tax_basis_verified_at = now(),
         non_vat_tax_basis_verified_by = auth.uid(),
         non_vat_tax_basis_review_note = v_review_note,
         updated_at = now()
   WHERE p.restaurant_id = p_restaurant_id
     AND p.non_vat_tax_basis IN ('subject_to_percentage_tax','not_subject_to_percentage_tax')
     AND nullif(trim(p.non_vat_tax_basis_reference), '') IS NOT NULL
  RETURNING * INTO v_result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No reviewable non-VAT tax basis/evidence reference is on file.';
  END IF;

  INSERT INTO public.pos_sales_journal (
    restaurant_id, order_id, order_number, event_type, operation,
    actor_user_id, actor_role, old_values, new_values
  ) VALUES (
    p_restaurant_id, NULL, NULL, 'NON_VAT_TAX_BASIS_REVIEWED', 'UPDATE',
    auth.uid(), 'system_admin',
    jsonb_build_object('non_vat_tax_basis_verified_at', NULL),
    jsonb_build_object(
      'non_vat_tax_basis', v_result.non_vat_tax_basis,
      'evidence_reference', v_result.non_vat_tax_basis_reference,
      'verified_at', v_result.non_vat_tax_basis_verified_at,
      'review_note', v_result.non_vat_tax_basis_review_note
    )
  );

  RETURN jsonb_build_object(
    'restaurant_id', v_result.restaurant_id,
    'non_vat_tax_basis', v_result.non_vat_tax_basis,
    'non_vat_tax_basis_reference', v_result.non_vat_tax_basis_reference,
    'non_vat_tax_basis_verified_at', v_result.non_vat_tax_basis_verified_at,
    'non_vat_tax_basis_review_note', v_result.non_vat_tax_basis_review_note
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.system_admin_confirm_restaurant_non_vat_tax_basis(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_confirm_restaurant_non_vat_tax_basis(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.calculate_supported_online_order_tax_snapshot(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_restaurant public.restaurants%ROWTYPE;
  v_item_count integer := 0;
  v_classified_count integer := 0;
  v_standard_count integer := 0;
  v_invalid_item_count integer := 0;
  v_item_total numeric(12,2) := 0;
  v_standard_gross numeric(12,2) := 0;
  v_vat_exempt_sales numeric(12,2) := 0;
  v_zero_rated_sales numeric(12,2) := 0;
  v_vatable_sales numeric(12,2);
  v_vat_amount numeric(12,2);
  v_net_sales numeric(12,2);
  v_non_vat_tax_basis text;
  v_non_vat_tax_basis_reference text;
  v_non_vat_tax_basis_verified_at timestamptz;
  v_non_vat_classified_count integer := 0;
  v_non_vat_percentage_sales numeric(12,2) := 0;
  v_non_vat_exempt_sales numeric(12,2) := 0;
  v_vat_invalid_category_count integer := 0;
BEGIN
  SELECT * INTO v_order FROM public.orders o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'order_not_found'; END IF;
  IF v_order.tax_snapshot_status = 'calculated' THEN RETURN 'already_calculated'; END IF;

  SELECT * INTO v_restaurant FROM public.restaurants r WHERE r.id = v_order.restaurant_id;
  IF NOT FOUND THEN RETURN 'restaurant_not_found'; END IF;

  UPDATE public.orders
     SET tax_vat_registered = v_restaurant.tax_vat_registered,
         tax_prices_vat_inclusive = v_restaurant.tax_prices_vat_inclusive,
         tax_vat_rate = CASE WHEN v_restaurant.tax_vat_registered THEN v_restaurant.tax_vat_rate ELSE 0 END,
         tax_snapshot_status = 'requires_review',
         tax_snapshot_version = NULL,
         updated_at = now()
   WHERE id = v_order.id;

  IF NOT coalesce(v_restaurant.tax_vat_registered, false) THEN
    SELECT p.non_vat_tax_basis, p.non_vat_tax_basis_reference, p.non_vat_tax_basis_verified_at
      INTO v_non_vat_tax_basis, v_non_vat_tax_basis_reference, v_non_vat_tax_basis_verified_at
    FROM public.restaurant_taxpayer_profiles p
    WHERE p.restaurant_id = v_order.restaurant_id;

    -- A non-VAT profile must be verified against the tenant's registration/tax advice
    -- before the system may summarize percentage-taxable versus exempt sales.
    IF v_non_vat_tax_basis NOT IN ('subject_to_percentage_tax','not_subject_to_percentage_tax')
       OR v_non_vat_tax_basis_verified_at IS NULL
       OR nullif(trim(v_non_vat_tax_basis_reference), '') IS NULL
       OR coalesce(v_order.discount_amount, 0) <> 0
       OR coalesce(v_order.discount_beneficiary_count, 0) <> 0
       OR coalesce(v_order.subtotal, 0) <= 0
       OR coalesce(v_order.delivery_fee, 0) <> 0
       OR abs(round(v_order.total - v_order.subtotal, 2)) > 0.01
    THEN
      RETURN 'requires_review';
    END IF;

    SELECT
      count(*),
      count(*) FILTER (WHERE oi.tax_category_snapshot IN ('percentage_taxable','non_vat_exempt')),
      count(*) FILTER (
        WHERE oi.quantity < 1 OR oi.unit_price < 0 OR oi.line_total < 0
           OR oi.line_total IS DISTINCT FROM round(oi.unit_price * oi.quantity, 2)
      ),
      coalesce(round(sum(oi.line_total), 2), 0),
      coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'percentage_taxable'), 2), 0),
      coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'non_vat_exempt'), 2), 0)
    INTO v_item_count, v_non_vat_classified_count, v_invalid_item_count,
         v_item_total, v_non_vat_percentage_sales, v_non_vat_exempt_sales
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id;

    IF v_item_count = 0
       OR v_non_vat_classified_count <> v_item_count
       OR v_invalid_item_count <> 0
       OR abs(v_item_total - v_order.subtotal) > 0.01
       OR (
         v_non_vat_tax_basis = 'not_subject_to_percentage_tax'
         AND v_non_vat_percentage_sales <> 0
       )
    THEN
      RETURN 'requires_review';
    END IF;

    UPDATE public.orders
       SET tax_vat_registered = false,
           tax_prices_vat_inclusive = false,
           tax_vat_rate = 0,
           tax_gross_sales = round(v_order.subtotal, 2),
           tax_vatable_sales = 0,
           tax_vat_amount = 0,
           tax_vat_exempt_sales = 0,
           tax_net_sales = round(v_order.subtotal, 2),
           tax_zero_rated_sales = 0,
           tax_percentage_taxable_sales = v_non_vat_percentage_sales,
           tax_non_vat_exempt_sales = v_non_vat_exempt_sales,
           tax_snapshot_status = 'calculated',
           tax_snapshot_version = 4,
           updated_at = now()
     WHERE id = v_order.id;

    RETURN 'calculated';
  END IF;

  IF NOT coalesce(v_restaurant.tax_prices_vat_inclusive, false)
     OR v_restaurant.tax_vat_rate IS NULL
     OR v_restaurant.tax_vat_rate <= 0
     OR v_restaurant.tax_vat_rate > 100
     OR coalesce(v_order.discount_amount, 0) <> 0
     OR coalesce(v_order.discount_beneficiary_count, 0) <> 0
     OR coalesce(v_order.subtotal, 0) <= 0
     OR abs(round(v_order.total - (v_order.subtotal + v_order.delivery_fee), 2)) > 0.01
  THEN RETURN 'requires_review'; END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE oi.tax_category_snapshot IS NOT NULL),
    count(*) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate'),
    count(*) FILTER (WHERE oi.tax_category_snapshot NOT IN ('standard_rate','vat_exempt','zero_rated')),
    count(*) FILTER (
      WHERE oi.quantity < 1 OR oi.unit_price < 0 OR oi.line_total < 0
         OR oi.line_total IS DISTINCT FROM round(oi.unit_price * oi.quantity, 2)
    ),
    coalesce(round(sum(oi.line_total), 2), 0),
    coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate'), 2), 0),
    coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'vat_exempt'), 2), 0),
    coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'zero_rated'), 2), 0)
  INTO v_item_count, v_classified_count, v_standard_count, v_vat_invalid_category_count, v_invalid_item_count,
       v_item_total, v_standard_gross, v_vat_exempt_sales, v_zero_rated_sales
  FROM public.order_items oi WHERE oi.order_id = v_order.id;

  IF v_item_count = 0 OR v_classified_count <> v_item_count
     OR v_vat_invalid_category_count <> 0
     OR v_invalid_item_count <> 0
     OR abs(v_item_total - v_order.subtotal) > 0.01
  THEN RETURN 'requires_review'; END IF;

  v_vatable_sales := CASE WHEN v_standard_count = 0 THEN 0
    ELSE round(v_standard_gross / (1 + (v_restaurant.tax_vat_rate / 100)), 2) END;
  v_vat_amount := round(v_standard_gross - v_vatable_sales, 2);
  v_net_sales := round(v_vatable_sales + v_vat_exempt_sales + v_zero_rated_sales, 2);

  UPDATE public.orders
     SET tax_vat_registered = true,
         tax_prices_vat_inclusive = true,
         tax_vat_rate = v_restaurant.tax_vat_rate,
         tax_gross_sales = round(v_order.subtotal, 2),
         tax_vatable_sales = v_vatable_sales,
         tax_vat_amount = v_vat_amount,
         tax_vat_exempt_sales = v_vat_exempt_sales,
         tax_net_sales = v_net_sales,
         tax_zero_rated_sales = v_zero_rated_sales,
         tax_percentage_taxable_sales = 0,
         tax_non_vat_exempt_sales = 0,
         tax_snapshot_status = 'calculated',
         tax_snapshot_version = 3,
         updated_at = now()
   WHERE id = v_order.id;

  RETURN 'calculated';
END;
$function$;


-- Preserve the existing internal-only execution grants for the SECURITY DEFINER calculator.
-- The calculator has no user-facing authorization surface; it is invoked only through existing guarded flows.

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

CREATE OR REPLACE FUNCTION public.generate_pos_sales_reading_preview(p_restaurant_id uuid, p_business_date date, p_reading_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_order_count integer := 0;
  v_completed_count integer := 0;
  v_cancelled_count integer := 0;
  v_paid_count integer := 0;
  v_pending_count integer := 0;
  v_refunded_count integer := 0;
  v_completed_discounts numeric(14,2) := 0;
  v_completed_delivery_fee numeric(14,2) := 0;
  v_completed_total numeric(14,2) := 0;
  v_cumulative_completed_total numeric(16,2) := 0;
  v_paid_sales_count integer := 0;
  v_paid_sales numeric(14,2) := 0;
  v_cumulative_paid_sales numeric(16,2) := 0;
  v_paid_discounts numeric(14,2) := 0;
  v_paid_delivery_fee numeric(14,2) := 0;
  v_tax_review_count integer := 0;
  v_unclassified_line_count integer := 0;
  v_tax_complete boolean := false;
  v_vatable numeric(14,2);
  v_vat numeric(14,2);
  v_exempt numeric(14,2);
  v_zero_rated numeric(14,2);
  v_percentage_taxable numeric(14,2);
  v_non_vat_exempt numeric(14,2);
  v_reading_id uuid;
  v_snapshot jsonb;
BEGIN
  IF NOT (
    public.is_system_admin_manager()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = p_restaurant_id AND r.owner_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'You are not authorized to generate a sales reading preview for this restaurant.';
  END IF;

  IF p_business_date IS NULL
     OR p_business_date > timezone('Asia/Manila', now())::date THEN
    RAISE EXCEPTION 'Choose a business date that is not in the future.';
  END IF;

  IF p_reading_type IS NULL OR p_reading_type NOT IN ('x_preview','z_preview') THEN
    RAISE EXCEPTION 'Reading type must be x_preview or z_preview.';
  END IF;

  v_from := p_business_date::timestamp AT TIME ZONE 'Asia/Manila';
  v_to := (p_business_date + 1)::timestamp AT TIME ZONE 'Asia/Manila';

  -- Serialize preview creation per tenant/day; each snapshot is immutable.
  PERFORM pg_advisory_xact_lock(hashtext(p_restaurant_id::text || ':' || p_business_date::text));

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE o.status = 'completed')::integer,
    count(*) FILTER (WHERE o.status = 'cancelled')::integer,
    count(*) FILTER (WHERE o.payment_status = 'paid')::integer,
    count(*) FILTER (WHERE o.payment_status = 'pending')::integer,
    count(*) FILTER (WHERE o.payment_status = 'refunded')::integer,
    coalesce(sum(o.discount_amount) FILTER (WHERE o.status = 'completed'), 0)::numeric(14,2),
    coalesce(sum(o.delivery_fee) FILTER (WHERE o.status = 'completed'), 0)::numeric(14,2),
    coalesce(sum(o.total) FILTER (WHERE o.status = 'completed'), 0)::numeric(14,2),
    count(*) FILTER (
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled','refunded')
    )::integer,
    coalesce(sum(o.discount_amount) FILTER (
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled','refunded')
    ), 0)::numeric(14,2),
    coalesce(sum(o.delivery_fee) FILTER (
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled','refunded')
    ), 0)::numeric(14,2),
    coalesce(sum(o.total) FILTER (
      WHERE o.payment_status = 'paid'
        AND o.status NOT IN ('cancelled','refunded')
    ), 0)::numeric(14,2)
  INTO
    v_order_count, v_completed_count, v_cancelled_count, v_paid_count,
    v_pending_count, v_refunded_count,
    v_completed_discounts, v_completed_delivery_fee, v_completed_total,
    v_paid_sales_count, v_paid_discounts, v_paid_delivery_fee, v_paid_sales
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= v_from AND o.created_at < v_to;

  SELECT coalesce(sum(o.total), 0)::numeric(16,2)
    INTO v_cumulative_completed_total
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.status = 'completed'
    AND o.created_at < v_to;

  SELECT coalesce(sum(o.total), 0)::numeric(16,2)
    INTO v_cumulative_paid_sales
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.payment_status = 'paid'
    AND o.status NOT IN ('cancelled','refunded')
    AND o.created_at < v_to;

  -- Tax completeness follows the same paid-sales population, not kitchen status.
  SELECT count(*)::integer
    INTO v_tax_review_count
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= v_from AND o.created_at < v_to
    AND o.payment_status = 'paid'
    AND o.status NOT IN ('cancelled','refunded')
    AND o.total > 0
    AND (
      o.tax_snapshot_status IS DISTINCT FROM 'calculated'
      OR o.tax_zero_rated_sales IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id)
      OR EXISTS (
        SELECT 1 FROM public.order_items oi
        WHERE oi.order_id = o.id AND oi.tax_category_snapshot IS NULL
      )
    );

  SELECT count(*)::integer
    INTO v_unclassified_line_count
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.restaurant_id = p_restaurant_id
    AND o.created_at >= v_from AND o.created_at < v_to
    AND o.payment_status = 'paid'
    AND o.status NOT IN ('cancelled','refunded')
    AND oi.tax_category_snapshot IS NULL;

  v_tax_complete := v_paid_sales_count > 0
    AND v_tax_review_count = 0
    AND v_unclassified_line_count = 0;

  IF v_tax_complete THEN
    SELECT
      coalesce(sum(o.tax_vatable_sales), 0)::numeric(14,2),
      coalesce(sum(o.tax_vat_amount), 0)::numeric(14,2),
      coalesce(sum(o.tax_vat_exempt_sales), 0)::numeric(14,2),
      coalesce(sum(o.tax_zero_rated_sales), 0)::numeric(14,2),
      coalesce(sum(o.tax_percentage_taxable_sales), 0)::numeric(14,2),
      coalesce(sum(o.tax_non_vat_exempt_sales), 0)::numeric(14,2)
    INTO v_vatable, v_vat, v_exempt, v_zero_rated, v_percentage_taxable, v_non_vat_exempt
    FROM public.orders o
    WHERE o.restaurant_id = p_restaurant_id
      AND o.created_at >= v_from AND o.created_at < v_to
      AND o.payment_status = 'paid'
      AND o.status NOT IN ('cancelled','refunded');
  END IF;

  v_snapshot := jsonb_build_object(
    'is_official', false,
    'notice', 'Internal sales reading preview only. Not a BIR X-Reading, Z-Reading, invoice, tax return, or approval artifact.',
    'reading_type', p_reading_type,
    'business_date', p_business_date,
    'timezone', 'Asia/Manila',
    'generated_at', clock_timestamp(),
    'sales_basis', 'Payment status paid; excludes orders whose workflow status is cancelled or refunded. This is a platform preview basis, not an approved fiscal definition.',
    'order_counts', jsonb_build_object(
      'all_orders', v_order_count,
      'completed', v_completed_count,
      'cancelled', v_cancelled_count,
      'paid', v_paid_count,
      'pending_payment', v_pending_count,
      'refunded', v_refunded_count
    ),
    'platform_totals_php', jsonb_build_object(
      'paid_sales_order_count', v_paid_sales_count,
      'paid_sales_total', v_paid_sales,
      'cumulative_paid_sales_total', v_cumulative_paid_sales,
      'paid_order_discounts', v_paid_discounts,
      'paid_order_delivery_fees', v_paid_delivery_fee,
      'completed_order_totals', v_completed_total,
      'completed_order_discounts', v_completed_discounts,
      'completed_order_delivery_fees', v_completed_delivery_fee,
      'cumulative_completed_order_totals_through_date', v_cumulative_completed_total
    ),
    'tax_summary', jsonb_build_object(
      'complete', v_tax_complete,
      'orders_needing_review', v_tax_review_count,
      'unclassified_order_lines', v_unclassified_line_count,
      'vatable_sales_php', v_vatable,
      'vat_amount_php', v_vat,
      'vat_exempt_sales_php', v_exempt,
      'zero_rated_sales_php', v_zero_rated,
      'percentage_taxable_sales_php', v_percentage_taxable,
      'non_vat_exempt_sales_php', v_non_vat_exempt,
      'tax_basis_note', 'Non-VAT amounts are sales classifications only; this preview does not calculate percentage-tax liability.'
    )
  );

  INSERT INTO public.pos_sales_reading_previews (
    restaurant_id, business_date, reading_type, generated_by,
    order_count, completed_order_count, cancelled_order_count, paid_order_count,
    pending_payment_count, refunded_order_count, discounts_total, delivery_fee_total,
    completed_sales_total, cumulative_completed_sales_total, tax_review_order_count,
    unclassified_line_count, tax_summary_complete, vatable_sales, vat_amount,
    vat_exempt_sales, zero_rated_sales, snapshot
  ) VALUES (
    p_restaurant_id, p_business_date, p_reading_type, auth.uid(),
    v_order_count, v_completed_count, v_cancelled_count, v_paid_count,
    v_pending_count, v_refunded_count,
    v_completed_discounts, v_completed_delivery_fee,
    v_completed_total, v_cumulative_completed_total, v_tax_review_count,
    v_unclassified_line_count, v_tax_complete, v_vatable, v_vat,
    v_exempt, v_zero_rated, v_snapshot
  ) RETURNING reading_id INTO v_reading_id;

  RETURN v_snapshot || jsonb_build_object(
    'reading_id', v_reading_id,
    'generated_by', auth.uid()
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.generate_pos_sales_reading_preview(uuid,date,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.generate_pos_sales_reading_preview(uuid,date,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_restaurant_non_vat_tax_snapshot_amounts(p_restaurant_id uuid)
RETURNS TABLE (
  order_id uuid,
  tax_percentage_taxable_sales numeric,
  tax_non_vat_exempt_sales numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT (
    public.is_system_admin()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = p_restaurant_id AND r.owner_id = auth.uid() AND r.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'You are not authorized to view non-VAT tax support for this restaurant.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT o.id, o.tax_percentage_taxable_sales, o.tax_non_vat_exempt_sales
  FROM public.orders o
  WHERE o.restaurant_id = p_restaurant_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_restaurant_non_vat_tax_snapshot_amounts(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_non_vat_tax_snapshot_amounts(uuid) TO authenticated;
