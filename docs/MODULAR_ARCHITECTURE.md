# Modular Architecture

## Goal

The restaurant ordering platform is being migrated from page-centered orchestration to module-centered business boundaries. Existing behavior stays intact while responsibilities are extracted incrementally.

## Module boundaries

- auth — Supabase session restoration, account classification, sign-in/sign-out, auth callback handling.
- customer — customer authentication, customer profile, account state, saved addresses, customer order history.
- location — map/geocoding infrastructure shared by customer delivery and restaurant location workflows.
- ordering — menu, cart, order creation, order status.
- payments — cash/online payment state and PayMongo integration.
- loyalty — points configuration, earning, redemption, and ledger.
- pos — cashier workflows, discounts, tax calculations, receipts.
- kitchen — kitchen queue, sold-out availability, ready status.
- dispatch — delivery zones, shipping fees, dispatch workflow.
- products — restaurant products and categories.
- employees — staff invitations, employee roles, rider-as-employee behavior.
- sales — sales views and reporting.

## Dependency rule

UI components may call module services.

Module services may call repositories/API clients.

Repositories own database access.

Business rules must not be duplicated inside page components.

Protected access is enforced both by route guards and by backend/RLS policies.

## Current migration

The extracted boundaries now include:

- auth — account context, invitation callback resolution, and protected route guards
- customer — customer authentication, profile, saved addresses, and exact delivery locations
- location — Mapbox search/reverse geocoding and delivery location mapping
- ordering — cart state, persistence, and cart lifecycle
- sales — owner sales statistics and business-date calculations
- products — product/category CRUD, availability, and product images
- employees — employee CRUD, staff roles, invitation creation, and rider-as-employee behavior
- invitations — tenant-owner and employee invitation type resolution

The following compatibility adapters remain intentionally where legacy consumers still depend on them:

- RestaurantOwnerAuthProvider
- existing order repository for order creation/tracking

Feature migrations are being completed one module at a time with build and user regression testing after each boundary.

## Next migrations

1. Complete the payments boundary for online payment staging and PayMongo checkout.
2. Extract order creation/tracking into the ordering module without changing order behavior.
3. Extract loyalty points, redemption, and ledger access into the loyalty module.
4. Extract POS discounts, tax calculations, cash handling, and receipt workflows.
5. Extract kitchen queue and sold-out behavior.
6. Extract dispatch, delivery zones, and shipping-fee workflows.
7. Add build/test checks before each migration is merged.

## Safety rule

Do not combine an architectural refactor with unrelated UI or business-rule changes in the same change. Each migration should preserve the current behavior and be independently testable.


## Customer address location boundary

Customer saved addresses store both human-readable address text and an exact map location:

- latitude
- longitude
- Mapbox place ID when available

The map location is the authoritative delivery point. Address text remains editable for unit, building, house number, landmark, and other delivery instructions.

Map/geocoding code lives in `src/modules/location/locationService.ts`, while the reusable map UI remains in `MapboxDeliveryLocationPicker`.

Legacy saved addresses without coordinates can still be viewed, but new/edited saved addresses require an exact confirmed map location.


## Invitation boundary

Authentication invitations are treated as a dedicated module boundary. The application distinguishes:

- `tenant_owner`: System Admin → Tenant Owner
- `employee_staff`: Restaurant Owner → Employee

Invitation type resolution lives in `src/modules/invitations/`. Individual invitation flows must not infer their type from generic Supabase callback parameters such as `token_hash` or `confirmation_url`.

The hosted Supabase Invite User email template uses a generic callback based on `{{ .SiteURL }}` and `?invitation=1`. The application resolves the authenticated user's `invitation_type` metadata to route either to tenant onboarding or employee invitation setup. The email template must not hard-code a tenant-specific URL.
