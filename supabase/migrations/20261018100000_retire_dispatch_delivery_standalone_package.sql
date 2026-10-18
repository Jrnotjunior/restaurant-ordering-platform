-- Permanently remove only the standalone Dispatch + Delivery package (legacy ID 5).
-- Keep existing restaurant subscriptions and all delivery module functionality unchanged.
delete from public.system_package_modules
where package_id = 5;

delete from public.system_packages
where id = 5
  and package_key = 'dispatch_delivery';
