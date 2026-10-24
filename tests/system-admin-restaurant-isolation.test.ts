import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const isolationMigration = readFileSync(
  new URL('../supabase/migrations/20261024100000_isolate_system_admin_from_restaurant_data.sql', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

describe('System Admin / restaurant platform isolation', () => {
  it('removes System Admin policies from restaurant and tenant financial records', () => {
    expect(isolationMigration).toContain('DROP POLICY IF EXISTS "System admins can view all restaurants"');
    expect(isolationMigration).toContain('DROP POLICY IF EXISTS "System admins can update restaurants"');
    expect(isolationMigration).toContain('DROP POLICY IF EXISTS "Owner and system admin can read taxpayer profiles"');
    expect(isolationMigration).toContain('DROP POLICY IF EXISTS "System admins and restaurant owners can read POS sales journal"');
    expect(isolationMigration).toContain('DROP POLICY IF EXISTS "Owner and system admin can read POS reading previews"');
    expect(isolationMigration).toContain('DROP POLICY IF EXISTS "Owner and system admin can read invoice issuance config"');
    expect(isolationMigration).toContain('DROP POLICY IF EXISTS "Owner and system admin can read issued sales documents"');
    expect(isolationMigration).toContain('DROP POLICY IF EXISTS "Owner and system admin can read issued document events"');
  });

  it('removes cross-tenant System Admin branches from owner-facing sensitive RPCs', () => {
    expect(isolationMigration).toContain("'generate_pos_sales_reading_preview'");
    expect(isolationMigration).toContain("'get_restaurant_bir_issuance_readiness'");
    expect(isolationMigration).toContain("'get_restaurant_taxpayer_profile'");
    expect(isolationMigration).toContain("'save_restaurant_non_vat_tax_basis'");
    expect(isolationMigration).toContain("'save_restaurant_taxpayer_profile'");
    expect(isolationMigration).toContain("Could not isolate System Admin access");
    expect(isolationMigration).toContain('REVOKE ALL ON FUNCTION public.protect_system_workflow_settings()');
  });

  it('revokes execution on System Admin tenant inspection and mutation RPCs', () => {
    expect(isolationMigration).toContain("'system_admin_get_restaurant_owner'");
    expect(isolationMigration).toContain("'system_admin_get_restaurant_staff'");
    expect(isolationMigration).toContain("'system_admin_update_restaurant_settings'");
    expect(isolationMigration).toContain("'system_admin_set_online_payments_enabled'");
    expect(isolationMigration).toContain("'system_admin_review_restaurant_taxpayer_profile'");
    expect(isolationMigration).toContain("'system_admin_configure_disabled_invoice_series'");
    expect(isolationMigration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('keeps the System Admin tax-review screen out of the restaurant app', () => {
    expect(appSource).not.toContain("import { SystemAdminNonVatTaxReviewPage }");
    expect(appSource).toContain('This System Admin feature is not available in the Restaurant Ordering Platform.');
    expect(appSource).toContain('Use the separate platform administration workspace.');
  });

  it('does not delete users or tenant data', () => {
    expect(isolationMigration).not.toMatch(/\bDELETE\s+FROM\s+(auth\.users|public\.restaurants|public\.orders)\b/i);
    expect(isolationMigration).toContain('This migration changes authorization only.');
  });
});
