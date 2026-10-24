import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readingMigration = readFileSync(
  new URL('../supabase/migrations/20261024262000_include_beneficiary_gaps_in_reading_preview.sql', import.meta.url),
  'utf8',
);

describe('POS sales reading compliance gates', () => {
  it('does not mark a paid-sale tax summary complete when statutory discount beneficiary details are missing', () => {
    expect(readingMigration).toContain('o.discount_beneficiary_count > 0');
    expect(readingMigration).toContain('public.order_discount_beneficiaries b');
    expect(readingMigration).toContain("NULLIF(trim(b.beneficiary_name), '') IS NULL");
    expect(readingMigration).toContain("NULLIF(trim(b.beneficiary_address), '') IS NULL");
    expect(readingMigration).toContain('v_tax_complete := v_paid_sales_count > 0');
    expect(readingMigration).toContain('v_tax_review_count = 0');
    expect(readingMigration).toContain("'percentage_taxable_sales_php', v_percentage_taxable");
    expect(readingMigration).toContain("'non_vat_exempt_sales_php', v_non_vat_exempt");
  });

  it('keeps readings as immutable internal previews rather than official BIR readings', () => {
    expect(readingMigration).toContain("'is_official', false");
    expect(readingMigration).toContain('Internal sales reading preview only. Not a BIR X-Reading, Z-Reading, invoice, tax return, or approval artifact.');
    expect(readingMigration).toContain('REVOKE ALL ON FUNCTION public.generate_pos_sales_reading_preview(uuid,date,text) FROM PUBLIC, anon');
    expect(readingMigration).toContain('GRANT EXECUTE ON FUNCTION public.generate_pos_sales_reading_preview(uuid,date,text) TO authenticated');
  });
});
