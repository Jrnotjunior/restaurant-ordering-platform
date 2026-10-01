-- Riders need table-level SELECT privilege in addition to the RLS policy
-- so the Rider Delivery detail page can read items from assigned orders.

GRANT SELECT ON TABLE public.order_items TO authenticated;
