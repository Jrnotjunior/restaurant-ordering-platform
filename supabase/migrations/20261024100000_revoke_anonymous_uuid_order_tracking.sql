-- Anonymous guest tracking must use the dedicated high-entropy token RPC.
-- Keep UUID-based tracking only for signed-in customers; the function retains
-- its customer-profile ownership predicate for authenticated callers.
BEGIN;

REVOKE EXECUTE ON FUNCTION public.get_order_status_by_id(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_order_status_by_id(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
