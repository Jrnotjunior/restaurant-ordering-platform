-- Normalize the six remaining package IDs after retiring standalone Dispatch + Delivery.
-- Testing phase: no restaurants should be assigned to legacy package IDs 5, 6, or 7.
-- Shared dispatch_delivery remains available to Full System (1) and POS + Delivery (6).

do $$
begin
  if exists (
    select 1 from public.restaurant_subscriptions
    where package_id in (5, 6, 7)
  ) then
    raise exception 'Cannot renumber packages: subscriptions still reference legacy package IDs 5, 6, or 7. Review those subscriptions before applying this migration.';
  end if;
end $$;

delete from public.system_package_modules where package_id in (5, 6, 7);
delete from public.system_packages where id in (5, 6, 7);

insert into public.system_packages (id, package_key, name, description, is_active)
values
  (5, 'self_ordering_kitchen', 'Self Ordering + Kitchen', 'Self Ordering, Orders, Kitchen, and Sales.', true),
  (6, 'pos_delivery', 'POS + Delivery', 'POS, Sales, Orders, Dispatch, Rider, Delivery, and Shipping Fee.', true)
on conflict (id) do update
set package_key = excluded.package_key,
    name = excluded.name,
    description = excluded.description,
    is_active = true,
    updated_at = now();

insert into public.system_package_modules (package_id, module_key)
values
  (5, 'self_ordering'),
  (5, 'sales'),
  (5, 'kitchen'),
  (6, 'pos'),
  (6, 'sales'),
  (6, 'dispatch_delivery')
on conflict do nothing;
