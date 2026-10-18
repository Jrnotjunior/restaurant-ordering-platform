-- Permanently retire Package 5 (Self Ordering + Kitchen).
-- Preflight verified there are no restaurant subscriptions assigned to package 5.
-- Preserve all other package definitions and shared module functionality.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.restaurant_subscriptions WHERE package_id = 5
  ) THEN
    RAISE EXCEPTION 'Cannot remove Package 5: active or historical subscriptions still reference package_id 5. Reassign/review those subscriptions first.';
  END IF;
END $$;

DELETE FROM public.system_package_modules WHERE package_id = 5;
DELETE FROM public.system_packages WHERE id = 5 AND package_key = 'self_ordering_kitchen';
