import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const routeResolver = readFileSync(new URL('../src/app/routing/routeResolver.ts', import.meta.url), 'utf8');
const isolationMigration = readFileSync(
  new URL('../supabase/migrations/20261024100000_isolate_system_admin_from_restaurant_data.sql', import.meta.url),
  'utf8',
);

describe('System Admin tax-review separation', () => {
  it('does not expose the tax-review page or route in the restaurant application', () => {
    expect(appSource).not.toContain('SystemAdminNonVatTaxReviewPage');
    expect(appSource).not.toContain('system-admin/non-vat-tax-review');
    expect(routeResolver).not.toContain('system-admin/non-vat-tax-review');
  });

  it('revokes client access to System Admin tax-review RPCs', () => {
    expect(isolationMigration).toContain("'system_admin_confirm_restaurant_non_vat_tax_basis'");
    expect(isolationMigration).toContain("'system_admin_list_pending_non_vat_tax_basis_reviews'");
    expect(isolationMigration).toContain('FROM PUBLIC, anon, authenticated');
  });

  it('keeps restaurant tax-review access owner-scoped and does not enable invoice issuance', () => {
    expect(isolationMigration).toContain('DROP POLICY IF EXISTS "Owner and system admin can read taxpayer profiles"');
    expect(isolationMigration).toContain('Restaurant owners can read their taxpayer profiles');
    expect(isolationMigration).not.toMatch(/UPDATE\\s+public\\.restaurant_invoice_issuance_configs\\s+SET\\s+enabled\\s*=\\s*true/i);
  });
});
