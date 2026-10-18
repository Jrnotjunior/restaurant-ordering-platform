-- Package 2 includes website customization and the optional loyalty module.
-- Loyalty remains off until the restaurant owner enables the loyalty program in its settings.
update public.system_packages
set name = 'Self Ordering + POS + Website',
    description = 'Self Ordering, POS, Sales, and Website customization. Loyalty is available and optional; the restaurant owner controls whether the loyalty program is enabled.',
    updated_at = now()
where id = 2
  and package_key = 'self_ordering_pos';

insert into public.system_package_modules (package_id, module_key)
select 2, module_key
from public.system_modules
where module_key in ('website', 'loyalty')
on conflict (package_id, module_key) do nothing;
