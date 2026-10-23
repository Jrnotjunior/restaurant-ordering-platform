# Guest tracking token integration plan

## Current state

The guest cancellation capability is already separate from order tracking. Do not reuse it for tracking.

- `orders.guest_cancel_token_hash` is populated by the cash checkout wrappers.
- `pending_online_payments.guest_cancel_token_hash` is populated by online checkout wrappers.
- `sync_guest_cancel_token_to_finalized_order()` copies the cancellation hash to a finalized guest order after payment succeeds.
- `get_order_status_by_id(uuid)` still authorizes anonymous tracking by order UUID alone.
- The frontend currently calls `get_order_status_by_id` without a tracking credential and subscribes to a Realtime channel derived from the order UUID.

## Implementation order

1. Add `guest_tracking_token_hash` to `orders` and `pending_online_payments`, with a strict lowercase 64-hex constraint.
2. Extend the four current guest checkout wrappers to accept and store the tracking hash independently of `guest_cancel_token_hash`:
   - `create_order_with_guest_cancel_token`
   - `create_order_from_delivery_quote_with_guest_cancel_token`
   - `create_pending_online_payment_with_guest_cancel_token`
   - `create_pending_online_payment_from_delivery_quote_with_guest_cancel_token`
3. Update the payment-finalization synchronization trigger to copy the tracking hash only to the matching finalized guest order. Preserve cancellation-token behavior.
4. Introduce tracking-token generation and browser storage separately from cancellation-token storage. Pass only the SHA-256 hash to database writes.
5. Add a token-authorized anonymous tracking RPC. Keep signed-in tracking owner-bound and return only customer-facing fields.
6. Change polling and refresh behavior to use the token-authorized RPC. Audit Realtime authorization; never place the raw token in topic names and do not treat a UUID-derived topic as authorization.
7. Recover the raw tracking token only through a URL fragment (or equivalent non-server-logged channel), then immediately strip the fragment from browser history.
8. Test cash checkout, delivery-quote checkout, online payment return, invalid/missing tokens, cross-restaurant access, response minimization, Realtime, and browser storage failures.
9. Keep the existing UUID tracking RPC available until the replacement path passes end-to-end validation; only then propose its revocation.

## Migration review notes

- Review the latest deployed definitions of the checkout wrappers and `finalize_online_payment` before replacing functions. Preserve existing payment, loyalty, tax, and order-item behavior.
- The current finalizer is service-role-only; retain that boundary.
- Do not use client-provided tenant headers, URL values, or Origin as authorization.
- Do not log raw tracking tokens or put them in query parameters, analytics, or Realtime topic names.
- No production migration or merge without explicit approval.
