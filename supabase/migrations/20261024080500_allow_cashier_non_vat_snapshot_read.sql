-- Cashiers can access the same tenant-scoped sales totals used in their report workspace.
-- This RPC returns only non-VAT financial classifications, never beneficiary/customer identity.
CREATE OR REPLACE FUNCTION public.get_restaurant_non_vat_tax_snapshot_amounts(p_restaurant_id uuid)
 RETURNS TABLE(order_id uuid, tax_percentage_taxable_sales numeric, tax_non_vat_exempt_sales numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT (
    public.is_system_admin()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = p_restaurant_id AND r.owner_id = auth.uid() AND r.is_active = true
    )
    OR EXISTS (
      SELECT 1 FROM public.restaurant_staff s
      JOIN public.restaurants r ON r.id = s.restaurant_id
      WHERE s.restaurant_id = p_restaurant_id
        AND s.auth_user_id = auth.uid()
        AND s.role = 'cashier'
        AND s.is_active = true
        AND r.is_active = true
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
