# Modular Architecture

## Goal

The restaurant ordering platform is being migrated from page-centered orchestration to module-centered business boundaries. Existing behavior stays intact while responsibilities are extracted incrementally.

## Module boundaries

- auth — Supabase session restoration, account classification, sign-in/sign-out, auth callback handling.
- customer — customer profile, account UI, saved addresses, order history.
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

The first extracted boundary is src/modules/auth/authService.ts.

It owns:

1. account-context resolution (owner/staff/customer)
2. invitation callback initialization
3. the distinction between invitation callbacks and customer confirmation callbacks

RestaurantOwnerAuthProvider remains the compatibility adapter for existing consumers during migration.

## Next migrations

1. Replace page-level authentication checks with the auth module.
2. Separate customer authentication UI from restaurant owner/staff authentication UI.
3. Extract customer account state.
4. Extract ordering/cart state from App.tsx.
5. Extract route guards from App.tsx.
6. Move feature pages behind module services.
7. Add build/test checks before each migration is merged.

## Safety rule

Do not combine an architectural refactor with unrelated UI or business-rule changes in the same change. Each migration should preserve the current behavior and be independently testable.
