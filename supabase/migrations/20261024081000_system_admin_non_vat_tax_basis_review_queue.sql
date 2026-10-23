-- System Admin queue for non-VAT tax-basis evidence review.
-- Only manager-level System Admins with required MFA can enumerate pending requests.
CREATE OR REPLACE FUNCTION public.system_admin_list_pending_non_vat_tax_basis_reviews()
RETURNS TABLE (
  restaurant_id uuid,
  restaurant_name text,
  non_vat_tax_basis text,
  non_vat_tax_basis_reference text,
  non_vat_tax_basis_verified_at timestamptz,
  non_vat_tax_basis_review_note text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT public.is_system_admin_manager() THEN
    RAISE EXCEPTION 'System Admin manager access with required MFA is required.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.name,
    p.non_vat_tax_basis,
    p.non_vat_tax_basis_reference,
    p.non_vat_tax_basis_verified_at,
    p.non_vat_tax_basis_review_note,
    p.updated_at
  FROM public.restaurant_taxpayer_profiles p
  JOIN public.restaurants r ON r.id = p.restaurant_id
  WHERE r.tax_vat_registered = false
    AND p.non_vat_tax_basis IN ('subject_to_percentage_tax','not_subject_to_percentage_tax')
    AND p.non_vat_tax_basis_verified_at IS NULL
    AND nullif(trim(p.non_vat_tax_basis_reference), '') IS NOT NULL
  ORDER BY p.updated_at ASC, r.name ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.system_admin_list_pending_non_vat_tax_basis_reviews() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.system_admin_list_pending_non_vat_tax_basis_reviews() TO authenticated;

COMMENT ON FUNCTION public.system_admin_list_pending_non_vat_tax_basis_reviews() IS
  'Lists only pending non-VAT tax-basis evidence references for manager-level System Admin review. Does not return TIN, buyer data, or customer identity.';
