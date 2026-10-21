-- Website customization is part of the Self Ordering storefront.
-- Keep the Website module active and include it in every package that enables
-- Self Ordering, without relying on hard-coded package IDs.
update public.system_modules
set is_active = true,
    updated_at = now()
where module_key = 'website';

insert into public.system_package_modules (package_id, module_key)
select spm.package_id, 'website'
from public.system_package_modules spm
where spm.module_key = 'self_ordering'
  and not exists (
    select 1
    from public.system_package_modules existing
    where existing.package_id = spm.package_id
      and existing.module_key = 'website'
  );
