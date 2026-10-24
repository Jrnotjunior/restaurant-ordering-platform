-- Isolate restaurant operations from the System Admin identity.
-- System Admin platform functions remain separate; tenant operational data is owner/staff scoped.
-- This migration changes authorization only. It does not delete or rewrite restaurant/user data.

-- Remove direct cross-tenant access to restaurant records. Existing owner-scoped policies remain.
DROP POLICY IF EXISTS "System admins can view all restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "System admins can insert restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "System admins can update restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "System admins can delete restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "Require MFA for System Admin restaurant access" ON public.restaurants;
DROP POLICY IF EXISTS "System Admin management access guard - update" ON public.restaurants;
DROP POLICY IF EXISTS "System Admin management access guard - delete" ON public.restaurants;

-- Sensitive restaurant records are readable by their own tenant owner only.
DROP POLICY IF EXISTS "Owner and system admin can read taxpayer profiles" ON public.restaurant_taxpayer_profiles;
CREATE POLICY "Restaurant owners can read their taxpayer profiles"
ON public.restaurant_taxpayer_profiles FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.restaurants r
  WHERE r.id = restaurant_taxpayer_profiles.restaurant_id AND r.owner_id = auth.uid()
));

DROP POLICY IF EXISTS "System admins and restaurant owners can read POS sales journal" ON public.pos_sales_journal;
CREATE POLICY "Restaurant owners can read POS sales journal"
ON public.pos_sales_journal FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.restaurants r
  WHERE r.id = pos_sales_journal.restaurant_id AND r.owner_id = auth.uid()
));

DROP POLICY IF EXISTS "Owner and system admin can read POS reading previews" ON public.pos_sales_reading_previews;
CREATE POLICY "Restaurant owners can read POS reading previews"
ON public.pos_sales_reading_previews FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.restaurants r
  WHERE r.id = pos_sales_reading_previews.restaurant_id AND r.owner_id = auth.uid()
));

DROP POLICY IF EXISTS "Owner and system admin can read invoice issuance config" ON public.restaurant_invoice_issuance_configs;
CREATE POLICY "Restaurant owners can read invoice issuance config"
ON public.restaurant_invoice_issuance_configs FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.restaurants r
  WHERE r.id = restaurant_invoice_issuance_configs.restaurant_id AND r.owner_id = auth.uid()
));

DROP POLICY IF EXISTS "Owner and system admin can read issued sales documents" ON public.issued_sales_documents;
CREATE POLICY "Restaurant owners can read issued sales documents"
ON public.issued_sales_documents FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.restaurants r
  WHERE r.id = issued_sales_documents.restaurant_id AND r.owner_id = auth.uid()
));

DROP POLICY IF EXISTS "Owner and system admin can read issued document events" ON public.issued_sales_document_events;
CREATE POLICY "Restaurant owners can read issued document events"
ON public.issued_sales_document_events FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.restaurants r
  WHERE r.id = issued_sales_document_events.restaurant_id AND r.owner_id = auth.uid()
));

-- Remove System Admin bypasses from tenant-owner RPCs without replacing the
-- underlying calculation/validation logic. Fail the migration if the expected
-- guard text changes, so no function is silently left with a bypass.
DO $isolation$
DECLARE
  v_name text;
  v_args text;
  v_oid oid;
  v_definition text;
  v_updated text;
  v_old text;
  v_new text;
  v_changed boolean;
  v_targets text[] := ARRAY[
    'generate_pos_sales_reading_preview',
    'get_pos_sales_reading_previews',
    'get_restaurant_bir_issuance_readiness',
    'get_restaurant_non_vat_tax_snapshot_amounts',
    'get_restaurant_pos_sales_journal',
    'get_restaurant_tax_snapshot_statuses',
    'get_restaurant_taxpayer_profile',
    'save_restaurant_non_vat_tax_basis',
    'save_restaurant_taxpayer_profile'
  ];
BEGIN
  FOR v_name IN SELECT unnest(v_targets) LOOP
    FOR v_oid, v_args IN
      SELECT p.oid, pg_get_function_identity_arguments(p.oid)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      v_definition := pg_get_functiondef(v_oid);
      v_updated := v_definition;

      IF v_name = 'generate_pos_sales_reading_preview' THEN
        v_old := E'public.is_system_admin_manager()\n    OR EXISTS (';
        v_new := E'EXISTS (';
      ELSIF v_name IN ('get_pos_sales_reading_previews','get_restaurant_bir_issuance_readiness',
                       'get_restaurant_pos_sales_journal','get_restaurant_taxpayer_profile') THEN
        v_old := E'public.is_system_admin()\n    or exists (';
        v_new := E'exists (';
      ELSIF v_name IN ('get_restaurant_non_vat_tax_snapshot_amounts') THEN
        v_old := E'public.is_system_admin()\n    OR EXISTS (';
        v_new := E'EXISTS (';
      ELSIF v_name = 'get_restaurant_tax_snapshot_statuses' THEN
        v_old := E'public.is_system_admin()\n    or exists (';
        v_new := E'exists (';
      ELSIF v_name = 'save_restaurant_non_vat_tax_basis' THEN
        v_old := 'IF NOT (public.is_system_admin() OR v_owner_id = auth.uid()) THEN';
        v_new := 'IF NOT (v_owner_id = auth.uid()) THEN';
      ELSIF v_name = 'save_restaurant_taxpayer_profile' THEN
        v_old := 'if not (public.is_system_admin_manager() or v_owner_id = auth.uid()) then';
        v_new := 'if not (v_owner_id = auth.uid()) then';
      END IF;

      v_updated := replace(v_updated, v_old, v_new);
      v_changed := v_updated <> v_definition;
      IF NOT v_changed THEN
        RAISE EXCEPTION 'Could not isolate System Admin access in public.%(%) - expected guard not found', v_name, v_args;
      END IF;
      EXECUTE v_updated;
    END LOOP;
  END LOOP;
END
$isolation$;

-- Retire RPCs that exist specifically to let System Admin inspect or change
-- tenant operational settings, staff identities, tax evidence, or serial setup.
DO $revoke$
DECLARE
  v_proc record;
BEGIN
  FOR v_proc IN
    SELECT p.proname, oidvectortypes(p.proargtypes) AS arg_types
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'system_admin_get_restaurant_owner',
        'system_admin_get_restaurant_staff',
        'system_admin_get_restaurant_settings',
        'system_admin_update_restaurant_settings',
        'system_admin_get_online_payments_enabled',
        'system_admin_set_online_payments_enabled',
        'system_admin_configure_disabled_invoice_series',
        'system_admin_confirm_restaurant_non_vat_tax_basis',
        'system_admin_list_pending_non_vat_tax_basis_reviews',
        'system_admin_review_restaurant_taxpayer_profile',
        'system_admin_get_mapbox_usage_by_restaurant',
        'system_admin_delete_restaurant',
        'system_admin_delete_restaurant_with_auth_cleanup'
      ])
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      v_proc.proname, v_proc.arg_types
    );
  END LOOP;
END
$revoke$;

-- Restaurant owners, not System Admin, control their restaurant workflow settings.
CREATE OR REPLACE FUNCTION public.protect_system_workflow_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.cash_on_delivery_enabled IS DISTINCT FROM OLD.cash_on_delivery_enabled
     OR NEW.automatic_rider_assignment_enabled IS DISTINCT FROM OLD.automatic_rider_assignment_enabled THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = OLD.id AND r.owner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Only the restaurant owner may change restaurant workflow settings.';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_system_workflow_settings() FROM PUBLIC, anon, authenticated;

COMMENT ON POLICY "Restaurant owners can read POS sales journal" ON public.pos_sales_journal IS
  'Restaurant operational journal is tenant-scoped; System Admin has no cross-tenant read path.';
