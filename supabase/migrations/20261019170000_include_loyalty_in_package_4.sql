-- Package 4 (Self Ordering + POS + Kitchen) includes Loyalty.
-- Keep this additive and idempotent so existing package modules are preserved.
INSERT INTO public.system_package_modules (package_id, module_key)
SELECT p.id, 'loyalty'
FROM public.system_packages p
JOIN public.system_modules m
  ON m.module_key = 'loyalty'
 AND m.is_active = true
WHERE p.package_key = 'self_ordering_pos_kitchen'
ON CONFLICT (package_id, module_key) DO NOTHING;
