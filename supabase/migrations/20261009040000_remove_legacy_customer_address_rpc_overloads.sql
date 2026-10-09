-- Remove obsolete address RPC overloads that do not persist map coordinates.
-- The current frontend passes the coordinate-aware signatures from
-- 20261009010000_customer_saved_address_locations.sql.
-- Keep one canonical signature per RPC to avoid ambiguous/stale call paths.

drop function if exists public.save_my_customer_address(
  uuid, text, text, text, text, boolean
);

drop function if exists public.save_my_default_delivery_address(
  uuid, text, text, text
);

drop function if exists public.update_my_customer_address(
  uuid, uuid, text, text, text, text
);
