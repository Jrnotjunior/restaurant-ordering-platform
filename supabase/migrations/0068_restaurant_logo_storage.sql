-- Restaurant logo storage.
-- Logos are public storefront assets; only the restaurant owner may upload/update/delete
-- files inside that restaurant's folder.

insert into storage.buckets (id, name, public)
values ('restaurant-logos', 'restaurant-logos', true)
on conflict (id) do update set public = true;

drop policy if exists "Public can view restaurant logos" on storage.objects;
create policy "Public can view restaurant logos"
on storage.objects
for select
to public
using (bucket_id = 'restaurant-logos');

drop policy if exists "Restaurant owners can upload logos" on storage.objects;
create policy "Restaurant owners can upload logos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'restaurant-logos'
  and exists (
    select 1
    from public.restaurants r
    where r.id::text = (storage.foldername(name))[1]
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop policy if exists "Restaurant owners can update logos" on storage.objects;
create policy "Restaurant owners can update logos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'restaurant-logos'
  and exists (
    select 1
    from public.restaurants r
    where r.id::text = (storage.foldername(name))[1]
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
)
with check (
  bucket_id = 'restaurant-logos'
  and exists (
    select 1
    from public.restaurants r
    where r.id::text = (storage.foldername(name))[1]
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);

drop policy if exists "Restaurant owners can delete logos" on storage.objects;
create policy "Restaurant owners can delete logos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'restaurant-logos'
  and exists (
    select 1
    from public.restaurants r
    where r.id::text = (storage.foldername(name))[1]
      and r.owner_id = auth.uid()
      and r.is_active = true
  )
);
