-- Website customization must be included wherever Self Ordering is included.
-- Package 1 and 2 already include Website; add it to Package 4.
INSERT INTO public.system_package_modules (package_id, module_key)
SELECT 4, 'website'
WHERE EXISTS (
  SELECT 1 FROM public.system_package_modules
  WHERE package_id = 4 AND module_key = 'self_ordering'
)
AND NOT EXISTS (
  SELECT 1 FROM public.system_package_modules
  WHERE package_id = 4 AND module_key = 'website'
);
