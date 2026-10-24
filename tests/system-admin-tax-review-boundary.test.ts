import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const reviewPage = readFileSync(
  new URL('../src/pages/SystemAdminNonVatTaxReviewPage.tsx', import.meta.url),
  'utf8',
);

describe('System Admin non-VAT tax-basis evidence review boundary', () => {
  it('verifies manager-level System Admin access before loading the review queue', () => {
    const accessCheck = reviewPage.indexOf("supabase.rpc('is_system_admin_manager')");
    const queueLoad = reviewPage.indexOf("supabase.rpc('system_admin_list_pending_non_vat_tax_basis_reviews')");
    expect(accessCheck).toBeGreaterThanOrEqual(0);
    expect(queueLoad).toBeGreaterThan(accessCheck);
    expect(reviewPage).toContain('if (managerAccess !== true)');
    expect(reviewPage).toContain('setAuthorized(false)');
  });

  it('requires a non-empty review note before invoking the evidence-review RPC', () => {
    const noteValidation = reviewPage.indexOf("if (!reviewNote)");
    const reviewCall = reviewPage.indexOf("supabase.rpc('system_admin_confirm_restaurant_non_vat_tax_basis'");
    expect(noteValidation).toBeGreaterThanOrEqual(0);
    expect(reviewCall).toBeGreaterThan(noteValidation);
    expect(reviewPage).toContain("p_review_note: reviewNote");
    expect(reviewPage).toContain(`disabled={Boolean(reviewingId) || !(notes[request.restaurant_id] ?? '').trim()}`);
  });

  it('does not describe internal evidence review as BIR approval', () => {
    expect(reviewPage).toContain('This records internal review only; it is not BIR approval.');
    expect(reviewPage).toContain('It does not calculate percentage-tax liability or mean BIR approval.');
    expect(reviewPage).toContain('Review the cited registration document or written tax advice before confirming a request.');
  });
});
