-- Online Payments is included in both Full System and Self Ordering + POS + Kitchen.
begin;

insert into public.system_modules (module_key, name, description, sort_order, is_active)
values (
  'online_payments',
  'Online Payments',
  'PayMongo online payment configuration and checkout',
  70,
  true
)
on conflict (module_key) do update
set is_active = true;

insert into public.system_package_modules (package_id, module_key)
values (1, 'online_payments')
on conflict (package_id, module_key) do nothing;

commit;
