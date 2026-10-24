-- Keep System Admin authenticated users out of restaurant-owned support, audit,
-- and usage records in the Restaurant Ordering Platform project.
DROP POLICY IF EXISTS "System admins can read support requests" ON public.restaurant_support_requests;
DROP POLICY IF EXISTS "System admins can update support requests" ON public.restaurant_support_requests;
DROP POLICY IF EXISTS "Ticket attachment owners and admins can delete metadata" ON public.support_ticket_attachments;
DROP POLICY IF EXISTS "Ticket participants can register attachments" ON public.support_ticket_attachments;
DROP POLICY IF EXISTS "Support admins can send support messages" ON public.support_ticket_messages;
DROP POLICY IF EXISTS "System admins can read support messages" ON public.support_ticket_messages;
DROP POLICY IF EXISTS "System admins can view audit logs" ON public.system_admin_audit_logs;
DROP POLICY IF EXISTS "System admins can view API usage events" ON public.system_api_usage_events;

-- Remove broad direct grants that are not needed for browser clients.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.system_admin_audit_logs, public.system_api_usage_events
FROM anon, authenticated;

-- Anonymous clients must not enumerate the restaurant registry.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.restaurants
FROM anon;

-- Authenticated support access is governed by remaining non-admin RLS policies.
