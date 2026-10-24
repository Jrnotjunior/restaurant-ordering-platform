# Change report — ESP route review for multi-tenant POS platform

**Date:** 24 October 2026  
**Repository:** `Jrnotjunior/restaurant-ordering-platform`  
**Branch:** `main`  
**Commit:** `66c5c17331c37a63ade59ee3d9d13508662ef644`  
**Type:** Compliance route documentation only.

## What changed

Updated `docs/compliance/BIR_POS_REGULATORY_ROUTE_DECISION_BRIEF_2026-10-20.md` to call out RMC No. 110-2026 and the significance of a multi-tenant restaurant SaaS serving separate restaurant businesses. Added a route-decision gate requiring written confirmation of whether the service is subject to Sales Machine/Software supplier accreditation, ESP accreditation, both, or another applicable route.

The note distinguishes BIR's official index listing from the secondary KPMG summary and clearly says the signed circular and annexes still need verification. It also highlights that the BIR's advertised 16–30 October 2026 ESP application window is time-sensitive and requires direct confirmation of the cutoff and eligibility.

## Guardrails

- Official invoice issuance and BIR transmission remain disabled.
- No application was submitted and no accreditation is claimed.
- No production database, sales transaction, tax snapshot, serial configuration, or application code was changed.
- No technical implementation is claimed complete based on a secondary summary.

## Sources to verify

- BIR official What's New index: https://www.bir.gov.ph/whats-new
- KPMG summary of RMC No. 110-2026, dated 16 October 2026: https://kpmg.com/us/en/taxnewsflash/news/2026/10/philippines-accreditation-framework-e-invoicing-service-providers.html

## Next gate

Obtain signed official RMC Nos. 110-2026 and 112-2026, all annexes/current checklist, and written route advice from BIR/qualified Philippine tax counsel. Then decide whether an ESP application is appropriate and feasible before adding route-specific invoice/transmission features.
