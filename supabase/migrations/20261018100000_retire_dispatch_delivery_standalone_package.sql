-- Permanently remove the standalone Dispatch + Delivery package (legacy ID 5).
-- Move any existing subscriptions to Full System first so deletion cannot break
-- their foreign key or unexpectedly remove delivery capabilities.
update public.restaurant_subscriptions
set package_id = 1,
    updated_at = now()
where package_id = 5;

-- Remove the package mappings explicitly, then delete the package row.
delete from public.system_package_modules
where package_id = 5;

delete from public.system_packages
where id = 5
  and package_key = 'dispatch_delivery';
