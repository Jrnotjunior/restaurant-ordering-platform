-- Retire the legacy Barangay delivery-zone tables after migrating checkout and rider assignment to distance-based delivery.
drop table if exists public.rider_delivery_zones;
drop table if exists public.restaurant_delivery_zones;
