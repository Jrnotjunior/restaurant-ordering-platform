import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

type ReviewRequest = {
  restaurant_id: string;
  restaurant_name: string;
  non_vat_tax_basis: 'subject_to_percentage_tax' | 'not_subject_to_percentage_tax';
  non_vat_tax_basis_reference: string;
  non_vat_tax_basis_verified_at: string | null;
  non_vat_tax_basis_review_note: string | null;
  updated_at: string;
};

export function SystemAdminNonVatTaxReviewPage() {
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function loadRequests() {
    if (!supabase) {
      setError('Supabase is not configured.');
      setCheckingAccess(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data: managerAccess, error: accessError } = await supabase.rpc('is_system_admin_manager');
      if (accessError) throw accessError;
      if (managerAccess !== true) {
        setAuthorized(false);
        setRequests([]);
        return;
      }
      setAuthorized(true);
      const { data, error: queueError } = await supabase.rpc('system_admin_list_pending_non_vat_tax_basis_reviews');
      if (queueError) throw queueError;
      setRequests((data ?? []) as ReviewRequest[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load pending review requests.');
    } finally {
      setLoading(false);
      setCheckingAccess(false);
    }
  }

  useEffect(() => { void loadRequests(); }, []);

  async function confirmReview(request: ReviewRequest) {
    if (!supabase || !authorized) return;
    const reviewNote = notes[request.restaurant_id]?.trim() ?? '';
    if (!reviewNote) {
      setError('Enter a review note describing the document/reference checked.');
      return;
    }
    setReviewingId(request.restaurant_id);
    setError('');
    setMessage('');
    try {
      const { error: reviewError } = await supabase.rpc('system_admin_confirm_restaurant_non_vat_tax_basis', {
        p_restaurant_id: request.restaurant_id,
        p_review_note: reviewNote,
      });
      if (reviewError) throw reviewError;
      setMessage(`Evidence review recorded for ${request.restaurant_name}. This records internal review only; it is not BIR approval.`);
      setNotes((current) => ({ ...current, [request.restaurant_id]: '' }));
      await loadRequests();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Unable to record evidence review.');
    } finally {
      setReviewingId(null);
    }
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 18px' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>System Admin · Tax Review</p>
          <h1 style={{ margin: 0, fontSize: 28 }}>Pending non-VAT tax-basis reviews</h1>
        </div>
        <button type="button" className="button button-secondary" onClick={() => void loadRequests()} disabled={loading}>Refresh queue</button>
      </header>
      <p style={{ maxWidth: 800, lineHeight: 1.6 }}>
        Review the cited registration document or written tax advice before confirming a request. Confirmation only unlocks a narrow sales-classification calculation when order-line categories and totals also pass validation. It does not calculate percentage-tax liability or mean BIR approval.
      </p>
      {error && <p role="alert" style={{ padding: 12, borderRadius: 8, background: '#fff1f2', color: '#9f1239' }}>{error}</p>}
      {message && <p role="status" style={{ padding: 12, borderRadius: 8, background: '#f0fdf4', color: '#166534' }}>{message}</p>}
      {checkingAccess ? <p>Verifying System Admin manager access…</p>
        : !authorized ? <section><h2>Access restricted</h2><p>This queue requires an active, manager-level System Admin account with the required MFA assurance.</p><a href="#account">Return to account</a></section>
          : loading ? <p>Loading pending requests…</p>
            : requests.length === 0 ? <section><h2>No pending requests</h2><p>There are no non-VAT tax-basis requests awaiting evidence review.</p></section>
              : <section style={{ display: 'grid', gap: 16 }}>
                {requests.map((request) => (
                  <article key={request.restaurant_id} style={{ border: '1px solid var(--color-border, #d1d5db)', borderRadius: 12, padding: 18 }}>
                    <h2 style={{ margin: '0 0 10px', fontSize: 19 }}>{request.restaurant_name}</h2>
                    <p><strong>Requested basis:</strong> {request.non_vat_tax_basis === 'subject_to_percentage_tax' ? 'Subject to percentage tax' : 'Not subject to percentage tax'}</p>
                    <p><strong>Evidence reference:</strong> {request.non_vat_tax_basis_reference}</p>
                    <p><strong>Last updated:</strong> {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(request.updated_at))}</p>
                    <label style={{ display: 'grid', gap: 6, marginTop: 14, fontWeight: 600 }}>
                      Review note (required)
                      <textarea rows={3} maxLength={1000} value={notes[request.restaurant_id] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [request.restaurant_id]: event.target.value }))} placeholder="Describe the source document/reference you verified." disabled={Boolean(reviewingId)} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8 }} />
                    </label>
                    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                      <button type="button" className="button button-primary" onClick={() => void confirmReview(request)} disabled={Boolean(reviewingId) || !(notes[request.restaurant_id] ?? '').trim()}>
                        {reviewingId === request.restaurant_id ? 'Recording review…' : 'Confirm evidence reviewed'}
                      </button>
                    </div>
                  </article>
                ))}
              </section>}
    </main>
  );
}
