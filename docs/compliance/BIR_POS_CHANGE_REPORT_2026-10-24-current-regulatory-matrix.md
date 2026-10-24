# BIR invoice matrix update — 24 October 2026

**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Branch:** `main`  
**Commit:** `8cfb2fc666b78c0186c6176e5b98c7d668623200`  
**Scope:** Documentation/traceability only; no application code or production database changed.

## Change made

Updated `docs/compliance/BIR_INVOICE_REQUIREMENTS_MATRIX_2026-10-24.md` with a dated regulatory update covering the current BIR index entries for RR No. 6-2026, RMC No. 112-2026 and RMC No. 110-2026, alongside the existing RMO No. 24-2023 POS/Sales Machine/Software route.

The update makes the engineering implications explicit:

- CWT is a separate invoice element when applicable, not a generic discount and not an amount to infer from order/payment type.
- Gross sales must remain distinct from CWT and net amount due.
- CWT decisions and later changes need provenance and auditability.
- The exact limited-versus-material system-change and transition provisions must be checked against signed official text.
- ESP accreditation is a separate route and must not be represented as achieved or assumed to replace tenant-level obligations.
- Official invoice issuance stays disabled until route, tenant evidence, serial controls and applicable reporting/transmission requirements are verified.

## Verification and limits

- Rechecked the official BIR 2026 Revenue Regulations index and official BIR What's New/homepage entries on 24 October 2026.
- RMO No. 24-2023 official PDF is linked in the matrix.
- The signed full text and annexes of RMC Nos. 110-2026 and 112-2026 were not independently verified end-to-end in this pass; the document explicitly records this limitation and does not hard-code an unverified compliance deadline.
- This is a documentation update, so no application test was added. No production data, historical tax snapshots, transactions, or issuance settings were modified.

## Next gate

Obtain signed official copies/checklists and written route guidance; then implement only the CWT and other fiscal controls applicable to the confirmed route, behind the existing official-issuance gate.
