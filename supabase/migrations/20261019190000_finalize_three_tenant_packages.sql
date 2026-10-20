-- Finalize the three tenant packages without relying on package IDs.
-- Never delete subscription history. Refuse to retire a package while any
-- subscription (active or historical) still references it.
begin;

DO $$
BEGIN
  IF
    (SELECT count(*) FROM public.system_packages WHERE package_key = 'full_system') <> 1
    OR (SELECT count(*) FROM public.system_packages WHERE package_key = 'pos') <> 1
    OR (SELECT count(*) FROM public.system_packages WHERE package_key = 'self_ordering_pos_kitchen') <> 1
  THEN
    RAISE EXCEPTION
      'Cannot finalize tenant packages: expected exactly one Full System, POS, and Self Ordering + POS + Kitchen package keyed by full_system, pos, and self_ordering_pos_kitchen.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.restaurant_subscriptions s
    JOIN public.system_packages p ON p.id = s.package_id
    WHERE p.package_key IN (
      'self_ordering_pos',
      'self_ordering_kitchen',
      'pos_delivery',
      'pos_kitchen_delivery'
    )
  ) THEN
    RAISE EXCEPTION
      'Cannot retire legacy packages: restaurant_subscriptions still reference one or more retired package keys. Review/reassign those subscriptions explicitly first.';
  END IF;
END $$;

-- Remove only retired package catalog entries, after the subscription guard.
-- Do not delete restaurant_subscriptions rows.
DELETE FROM public.system_package_modules
WHERE package_id IN (
  SELECT id
  FROM public.system_packages
  WHERE package_key IN (
    'self_ordering_pos',
    'self_ordering_kitchen',
    'pos_delivery',
    'pos_kitchen_delivery'
  )
);

DELETE FROM public.system_packages
WHERE package_key IN (
  'self_ordering_pos',
  'self_ordering_kitchen',
  'pos_delivery',
  'pos_kitchen_delivery'
);

UPDATE public.system_packages
SET name = 'Full System',
    description = 'Full system: Self Ordering, POS, Sales, Kitchen, Dispatch, Delivery, Loyalty, and Website.',
    is_active = true,
    updated_at = now()
WHERE package_key = 'full_system';

UPDATE public.system_packages
SET name = 'POS',
    description = 'POS and Sales.',
    is_active = true,
    updated_at = now()
WHERE package_key = 'pos';

UPDATE public.system_packages
SET name = 'Self Ordering + POS + Kitchen',
    description = 'Self Ordering, POS, Sales, and Kitchen.',
    is_active = true,
    updated_at = now()
WHERE package_key = 'self_ordering_pos_kitchen';

-- The entitlement set below includes online_payments. Seed that module here
-- because its separate later migration runs after this one in a clean replay.
INSERT INTO public.system_modules (module_key, name, description, sort_order, is_active)
VALUES (
  'online_payments',
  'Online Payments',
  'PayMongo online payment configuration and checkout',
  70,
  true
)
ON CONFLICT (module_key) DO UPDATE
SET is_active = true;

-- Ensure the intended module entitlements exist for the three packages.
-- Existing rows are preserved; missing rows are added idempotently.
INSERT INTO public.system_package_modules (package_id, module_key)
SELECT p.id, required.module_key
FROM public.system_packages p
CROSS JOIN (
  VALUES
    ('full_system', 'self_ordering'),
    ('full_system', 'pos'),
    ('full_system', 'sales'),
    ('full_system', 'kitchen'),
    ('full_system', 'dispatch_delivery'),
    ('full_system', 'loyalty'),
    ('full_system', 'website'),
    ('full_system', 'online_payments'),
    ('pos', 'pos'),
    ('pos', 'sales'),
    ('self_ordering_pos_kitchen', 'self_ordering'),
    ('self_ordering_pos_kitchen', 'pos'),
    ('self_ordering_pos_kitchen', 'sales'),
    ('self_ordering_pos_kitchen', 'kitchen'),
    ('self_ordering_pos_kitchen', 'loyalty'),
    ('self_ordering_pos_kitchen', 'website'),
    ('self_ordering_pos_kitchen', 'online_payments')
) AS required(package_key, module_key)
WHERE p.package_key = required.package_key
ON CONFLICT (package_id, module_key) DO NOTHING;

commit;
