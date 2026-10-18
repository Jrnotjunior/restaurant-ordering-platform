-- Package 5 was retired; reuse its ID for POS + Delivery.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.system_packages WHERE id = 5) THEN
    RAISE EXCEPTION 'Package ID 5 is occupied; refusing to renumber POS + Delivery.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.system_packages WHERE id = 6 AND package_key = 'pos_delivery') THEN
    RAISE EXCEPTION 'Expected POS + Delivery package at ID 6 was not found.';
  END IF;
END $$;

ALTER TABLE public.restaurant_subscriptions DROP CONSTRAINT restaurant_subscriptions_package_id_fkey;
ALTER TABLE public.system_package_modules DROP CONSTRAINT system_package_modules_package_id_fkey;

UPDATE public.system_package_modules SET package_id = 5 WHERE package_id = 6;
UPDATE public.restaurant_subscriptions SET package_id = 5 WHERE package_id = 6;
UPDATE public.system_packages SET id = 5, updated_at = now() WHERE id = 6 AND package_key = 'pos_delivery';

ALTER TABLE public.system_package_modules
  ADD CONSTRAINT system_package_modules_package_id_fkey
  FOREIGN KEY (package_id) REFERENCES public.system_packages(id) ON DELETE CASCADE;
ALTER TABLE public.restaurant_subscriptions
  ADD CONSTRAINT restaurant_subscriptions_package_id_fkey
  FOREIGN KEY (package_id) REFERENCES public.system_packages(id);

DO $$
DECLARE seq_name text;
BEGIN
  seq_name := pg_get_serial_sequence('public.system_packages', 'id');
  IF seq_name IS NOT NULL THEN
    PERFORM setval(seq_name, (SELECT COALESCE(MAX(id), 1) FROM public.system_packages), true);
  END IF;
END $$;