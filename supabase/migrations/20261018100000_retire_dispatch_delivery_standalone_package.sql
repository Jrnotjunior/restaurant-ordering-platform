-- Retire standalone Dispatch + Delivery package (Package 5).
-- Keep the package row and ID for existing subscription referential integrity,
-- but prevent new assignments and remove its standalone module combination.
update public.system_packages
set is_active = false,
    description = 'Retired: delivery requires a supported order source such as Self Ordering or POS.',
    updated_at = now()
where id = 5
  and package_key = 'dispatch_delivery';

-- Keep the existing package-module mappings so restaurants already assigned
-- Package 5 continue working until an administrator migrates them deliberately.

-- Existing restaurants assigned to Package 5 are intentionally not reassigned
-- automatically. Their subscriptions remain referentially valid, but inactive
-- package status prevents future assignment. Review existing tenants manually
-- before applying a replacement package.
