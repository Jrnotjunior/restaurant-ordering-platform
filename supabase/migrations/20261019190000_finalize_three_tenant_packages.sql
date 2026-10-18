-- Keep only the three packages Web2Table offers to tenants.
-- The retired packages were test-only and have been removed from live data as well.
begin;

delete from public.restaurant_subscriptions
where package_id in (
  select id from public.system_packages
  where package_key in ('self_ordering_pos', 'self_ordering_kitchen', 'pos_delivery', 'pos_kitchen_delivery')
     or id in (2, 5, 6)
);

delete from public.system_package_modules
where package_id in (
  select id from public.system_packages
  where package_key in ('self_ordering_pos', 'self_ordering_kitchen', 'pos_delivery', 'pos_kitchen_delivery')
     or id in (2, 5, 6)
);

delete from public.system_packages
where package_key in ('self_ordering_pos', 'self_ordering_kitchen', 'pos_delivery', 'pos_kitchen_delivery')
   or id in (2, 5, 6);

update public.system_packages
set package_key = 'full_system',
    name = 'Full System',
    description = 'Full system: Self Ordering, POS, Sales, Kitchen, Dispatch, Delivery, Loyalty, and Website.',
    is_active = true,
    updated_at = now()
where id = 1;

update public.system_packages
set package_key = 'pos',
    name = 'POS',
    description = 'POS and Sales.',
    is_active = true,
    updated_at = now()
where id = 3;

update public.system_packages
set package_key = 'self_ordering_pos_kitchen',
    name = 'Self Ordering + POS + Kitchen',
    description = 'Self Ordering, POS, Sales, and Kitchen.',
    is_active = true,
    updated_at = now()
where id = 4;

commit;
