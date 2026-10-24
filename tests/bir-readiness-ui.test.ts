import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const reportsPage = readFileSync(new URL('../src/pages/RestaurantBusinessReportsPage.tsx', import.meta.url), 'utf8');
const readinessMigration = readFileSync(
  new URL('../supabase/migrations/20261024084000_surface_cwt_invoice_template_blocker.sql', import.meta.url),
  'utf8',
);

describe('BIR invoice readiness indicators', () => {
  it('exposes statutory invoice template and CWT field readiness returned by the database', () => {
    expect(reportsPage).toContain('statutory_invoice_template_ready: boolean;');
    expect(reportsPage).toContain('cwt_invoice_field_ready: boolean;');
    expect(reportsPage).toContain('<small>Statutory invoice template</small>');
    expect(reportsPage).toContain('<small>CWT invoice field</small>');
    expect(reportsPage).toContain("birReadiness.statutory_invoice_template_ready ? 'Ready for review' : 'Not ready'");
    expect(reportsPage).toContain("birReadiness.cwt_invoice_field_ready ? 'Ready for review' : 'Not ready'");
  });

  it('keeps both issuance prerequisites blocked until the approved implementation exists', () => {
    expect(readinessMigration).toContain("'statutory_invoice_template_ready', false");
    expect(readinessMigration).toContain("'cwt_invoice_field_ready', false");
    expect(readinessMigration).toContain('The statutory invoice rendering/field map has not passed acceptance.');
    expect(readinessMigration).toContain('do not infer CWT applicability, ATC, tax base, rate, or amount');
    expect(readinessMigration).toContain("'official_invoice_issuance_api_enabled', false");
  });

  it('keeps official issuance blocked when taxpayer route evidence or tax data is incomplete', () => {
    const readinessGate = readFileSync(
      new URL('../supabase/migrations/20261024082000_bir_readiness_category_mismatch.sql', import.meta.url),
      'utf8',
    );
    const paidSalesGate = readFileSync(
      new URL('../supabase/migrations/20261024070000_bir_readiness_paid_sales_tax_review.sql', import.meta.url),
      'utf8',
    );
    expect(readinessGate).toContain('Route-specific BIR approval/permit references and the recorded approval date are incomplete.');
    expect(readinessGate).toContain('Non-VAT tax basis has not been verified');
    expect(readinessGate).toContain('mismatched_product_tax_category_count');
    expect(readinessGate).toContain("'is_bir_accredited', false");
    expect(readinessGate).toContain('Official invoice issuance remains disabled in the application');
    expect(paidSalesGate).toContain('paid_orders_needing_tax_review');
    expect(paidSalesGate).toContain('tax_snapshot_status is distinct from \'calculated\'');
    expect(paidSalesGate).toContain('tax_category_snapshot is null');
  });
});
