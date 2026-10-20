# Web2Table — SOC 2 Readiness and Database Security Assessment

**Prepared:** 2026-10-21  
**System:** Web2Table / Restaurant Ordering Platform  
**Connected Supabase project reviewed read-only:** `xaihajwrsvcdjisezmmc` (PostgreSQL 17.6, ap-northeast-1)  
**Status:** Technical gap assessment and control backlog. Not an audit opinion, penetration test, certification or SOC 2 report.

## 1. How SOC 2 applies

SOC 2 is an independent CPA examination/reporting engagement based on the AICPA Trust Services Criteria. It is not a badge created by adding software controls. Security is the common criterion; Availability, Processing Integrity, Confidentiality and Privacy should be included when relevant to the committed service and customer requirements. Scope the service, legal entity, people, systems, suppliers and commitments before selecting criteria and engaging an appropriately licensed, independent CPA firm.

Official criteria: https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022  
AICPA SOC services overview: https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services

## 2. Scope and evidence limits

Read-only checks covered table/function/view/trigger metadata, RLS policies, grants, several security-sensitive function bodies, Supabase security/performance advisors, targeted GitHub application paths, and the existing BIR code/schema audit. No writes were made to the connected project. No live exploit was performed, and project production-vs-staging status was not independently established.

The database project list now contains:
- `Restaurant Ordering Platform` — connected project under review.
- `Web2Table Security Test` — separate $0/month test project with a minimal synthetic schema. It is not yet a full replay of all application migrations or production data; do not rely on it for complete integration claims.

## 3. Confirmed database findings

### Baseline strengths
- **45/45 public tables have RLS enabled.** RLS must still be reviewed per table/action/role and in conjunction with SQL grants.
- The visible public view `support_ticket_dashboard_counts` has `security_invoker=true` and no anon SELECT privilege.
- Most sensitive system-administration functions checked have internal authorization guards and explicit authenticated execution grants.
- Tenant-scoped RLS and MFA policies exist for key restaurant staff/order/dispatch paths.

### High-priority gaps
1. **Broad direct update rights on `public.orders`.** Read-only privilege checks show `anon` and `authenticated` table-level UPDATE rights, including UPDATE ability for protected fields such as `total`, `subtotal`, `discount_amount`, `tax_vat_amount`, `tax_vatable_sales`, `tax_net_sales`, `payment_status`, `order_number`, `restaurant_id`, `status` and rider/delivery fields. Anonymous users do not have an applicable order UPDATE policy in the inspected policy set, so the anon grant by itself is not evidence of an anonymous exploit. Authenticated owner/dispatcher row policies do permit updates within their tenant, so column-level financial integrity is a material risk until legitimate direct writes are removed or constrained.
2. **Direct mutation rights on `delivery_assignments`.** Authenticated dispatcher INSERT/UPDATE/DELETE policies exist; the INSERT policy checks dispatcher/restaurant scope but does not itself prove the referenced order and rider belong to the same tenant. PR #143 moves the two known browser-side dispatch write paths to narrow RPCs, but remains draft and is not deployed.
3. **Broad TRUNCATE ACLs.** Effective privilege checks report TRUNCATE privilege on many public tables for `anon` and/or `authenticated`, including orders, order items, delivery assignments, restaurants, payroll, inventory and audit-related tables. TRUNCATE is not protected by RLS. PostgREST’s browser API does not expose an arbitrary SQL/TRUNCATE endpoint, so this is not proof that a browser-key holder can directly truncate these tables via REST. It is nevertheless an unnecessary least-privilege exposure and default-privilege/configuration issue that should be removed and regression-tested.
4. **System-admin RPC ACL drift.** The latest database definitions for `system_admin_get_restaurant_settings(uuid)` and two older `system_admin_update_restaurant_settings(...)` overloads have default/public execution ACLs, which gives `anon` effective EXECUTE privilege. The bodies call `is_system_admin()`, so this has not been demonstrated as a bypass; the grants should still be narrowed to authenticated callers, preserving the in-function authorization checks.
5. **Default PUBLIC execution on non-user-facing routines.** `send_order_to_kitchen(uuid)` is a SECURITY DEFINER function with an explicit authenticated grant but also inherits PUBLIC EXECUTE. Its body rejects missing `auth.uid()` and checks staff/tenant/paid status, so an unauthenticated operation was not demonstrated. The PUBLIC ACL should be removed. The trigger function `restaurant_record_salary_profile_history()` has default PUBLIC execute; as a trigger-only function, its execute grant should be restricted without disabling its installed trigger.
6. **Leaked-password protection disabled.** Supabase’s security advisor returns a warning that compromised-password checking is disabled. Enabling this is a project Auth configuration action, not a database migration. Verify current Auth/MFA/session/password configuration in the dashboard and record evidence.
7. **Security advisor review backlog.** Supabase reports 10 RLS-enabled tables without direct policies (likely internal tables, but their grants and callers must be reviewed), 28 SECURITY DEFINER functions executable by anon, and 124 executable by authenticated. Many guest-checkout RPCs intentionally permit anon calls; do not blanket-revoke them. Classify each function as public guest API, authenticated tenant API, internal trigger/helper, or system-admin API and verify signature-specific ACL, input validation, tenant/MFA/ownership guard and fixed search_path.
8. **Database auditability gaps for fiscal records.** The reviewed schema has system-admin audit logs but no inspected append-only POS document issuance/adjustment journal that covers each sale, tax result, issue/reprint/void, payment, refund and transmission acknowledgement.
9. **Operational controls are not established by schema alone.** This read-only database audit does not verify backup restore, RTO/RPO, change approvals, on-call incident response, vulnerability management, security training, access-review cadence, vendor contracts, breach notification process, or an independent test/CPA engagement.

### Performance/maintainability observations
Supabase performance advisors identify 36 unindexed foreign keys, 3 RLS policy init-plan optimization findings, 11 multiple-permissive-policy findings, and 20 unused-index findings. These are a backlog, not all security vulnerabilities; prioritize by query plans, write patterns, and tenant-critical tables before changing indexes or policies.

## 4. SOC 2 control matrix

| Domain / criterion | Current evidence | Required control / artifact | Priority |
|---|---|---|---|
| CC1 — Governance and accountability | No management/control owner evidence reviewed | Named security/control owners, policies, management review and assigned responsibilities | P1 |
| CC2 — Internal/external communication | No complete evidence binder reviewed | Security contact, customer commitments, escalation paths, vendor/customer communications | P1 |
| CC3 — Risk assessment | Code/schema risk audits exist | Recurring risk register with likelihood/impact, owner, target date and residual risk | P0 |
| CC4 — Monitoring | Supabase advisory and system-admin logs exist | Alerting/monitoring coverage, log retention, access anomaly detection, alert response evidence | P0 |
| CC5 — Control activities | RLS/MFA/RPC controls exist but broad grants remain | Least privilege, role matrix, approved exception list, code review and independent change approval | P0 |
| CC6 — Logical and physical access | Tenant RLS and MFA checks exist; Auth leaked-password protection is disabled | User lifecycle, MFA enforcement, compromised-password checks, privileged session review, secret rotation, DB/Data API ACL cleanup | P0 |
| CC7 — System operations | Runtime controls not fully verified | Vulnerability/patch management, dependency scanning, incident process, safe operational changes and investigations | P0 |
| CC8 — Change management | GitHub PR/CI is used | Protected main, required review/checks, linked issue/risk, migration validation, rollback plan and post-deploy verification | P0 |
| CC9 — Risk mitigation / vendors | Supabase and payment-provider dependencies exist | Vendor inventory, due diligence, contracts, subservice coverage, renewal/incident monitoring | P1 |
| Availability | Supabase-hosted PostgreSQL; restore evidence not reviewed | Backups and restore drills, RTO/RPO, monitoring, contingency runbook, dependency outage process | P0 |
| Processing integrity | Financial/tax snapshots may be uncomputed on online sales; direct order updates remain | Atomic/idempotent finalization, immutable financial snapshots, reconciliations, exception handling and journal | P0 |
| Confidentiality / Privacy | Tenant policies and scoped storage policies exist; all paths not independently tested | Data inventory/classification, retention/deletion schedule, data-subject process, access logs, PII minimization and incident handling | P1 |

Priorities: **P0** blocks production fiscal-readiness/security sign-off; **P1** required for a mature control environment and independent examination. This is an engineering estimate, not a CPA determination.

## 5. Specific safe remediation program

### Phase A — Authorization and database privilege inventory
1. Inventory every browser repository write and every SECURITY DEFINER function. For each record: exact signature, owner, ACL, intended caller, `auth.uid()`/role/MFA checks, tenant check, fixed `search_path`, row-state checks, and tests.
2. Remove browser roles’ TRUNCATE privileges from existing exposed tables and PostgreSQL default privileges; validate in the isolated test project first.
3. Narrow default/public execution ACLs on the identified system-admin settings functions and the kitchen/trigger-only helpers. Preserve the intended authenticated call paths and in-function guards.
4. Finish PR #143: use the assignment/handoff RPCs, then after test/deployment sequencing revoke direct orders UPDATE and delivery-assignment DML grants no longer needed. Do not revoke them before all legitimate paths are migrated.
5. Build tenant/role negative tests for owner, cashier, kitchen, dispatcher, rider, customer, anonymous, system-admin view-only/administrator/owner and MFA `aal1`/ `aal2`.

### Phase B — Auth and application security
- Enable leaked-password protection in Supabase Auth after reviewing user impact and dashboard options.
- Enforce MFA for privileged roles, document recovery/reset flows, keep authorization decisions out of user-editable `user_metadata`, and review token/session lifetime and revocation behavior.
- Keep service-role/secret keys out of frontend builds. Inventory secrets; rotate exposed/overbroad keys based on evidence, not as a blind emergency change.
- Add dependency/SCA scanning, lockfile integrity checks, static analysis, secret scanning, security tests, release approvals and a documented rollback path.

### Phase C — Fiscal processing integrity
- Follow the BIR route decision gate in the companion accreditation plan.
- Implement approved server-side tax calculation and tax/document snapshots, a separate invoice/document issuance ledger, serial allocator, and append-only lifecycle/adjustment journal only after the official fields/numbering/reporting rules and accountant-approved formulas are written down.
- Reconcile online and POS channels. Keep uncomputed historical data visibly marked; do not convert unknown snapshots to zeros or backfill from current tenant configuration.
- Validate failures/retries and adjustments, including inventory, loyalty and refunds.

### Phase D — Operational evidence program
Create and maintain:
- System description, in-scope boundaries and data-flow diagram.
- Asset, data, vendor and subservice inventory.
- Risk register and treatment plan.
- Access request/approval/revocation and quarterly access-review evidence.
- Secure SDLC, PR review, release approval, dependency scanning and migration test artifacts.
- Incident response plan, tabletop exercise, breach escalation/contact tree and post-incident review.
- Backup configuration, restore drill results, continuity/disaster-recovery plan with approved RTO/RPO.
- Vulnerability intake, patch SLAs and remediation evidence.
- Security-awareness training and personnel confidentiality commitments.
- Customer commitments and subservice-provider monitoring.
- Privacy/retention/deletion procedures and evidence of logs/monitoring retention.
- Control evidence index with owners, period, source system and reviewer.

### Phase E — Independent SOC 2 engagement
After the control design is implemented and operating, scope the in-scope system and engage a qualified independent CPA firm. Decide whether a Type 1 design assessment followed by Type 2 operating-effectiveness examination is appropriate. Do not promise a report date, call the product SOC 2 compliant, or use SOC branding before authorization and a valid report.

## 6. Deployment safety rules

- Connected project `xaihajwrsvcdjisezmmc` has not been modified by this audit.
- Validate all DDL and ACL changes in the isolated test project against the full current schema, not merely the minimal dispatch harness.
- Do not run write-based exploit simulations or tax backfills against customer data.
- Apply least-privilege migrations in a reviewed PR, then deploy with backup/rollback and post-change privilege verification.
- Do not combine schema security changes with tax formula changes in one migration.
- Do not close a finding merely because the SQL command succeeded; verify effective privileges, normal app workflows, logs and negative authorization tests.

## 7. Evidence and references
- AICPA Trust Services Criteria: https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022
- AICPA SOC service overview: https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services
- Supabase security guide: https://supabase.com/docs/guides/security/product-security
- Supabase securing the Data API: https://supabase.com/docs/guides/api/securing-your-api
- Supabase security advisor guide: https://supabase.com/docs/guides/database/database-linter
- Companion BIR roadmap: `docs/compliance/BIR_POS_ACCREDITATION_READINESS_PLAN_2026-10-21.md`

**Status:** SOC 2-oriented readiness backlog only. The database has not been declared secure or SOC 2 compliant. Findings require validation by the engineering owner and eventual independent assessor.
