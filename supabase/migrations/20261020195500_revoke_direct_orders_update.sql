-- Browser clients must mutate orders only through narrow, validated RPCs.
-- Dispatch assignment and handoff now use assign_delivery_order and
-- complete_dispatch_handoff; POS, payment, refund, inventory and loyalty
-- mutations are handled by server-owned SECURITY DEFINER routines.
-- Retain explicit postgres/service_role grants and existing RLS policies.
REVOKE UPDATE ON TABLE public.orders FROM PUBLIC, anon, authenticated;
