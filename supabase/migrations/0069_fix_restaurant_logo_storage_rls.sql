-- Fix restaurant logo storage RLS.
-- Storage policies query restaurants through a SECURITY DEFINER helper so
-- restaurant table RLS cannot block a valid owner from uploading their logo.

create or replace function public.is_restaurant_owner(p_restaurant_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.owner_id = auth.uid()
      and r.is_active = true
  );
$$;

revoke all on function public.is_restaurant_owner(uuid) from public, anon, authenticated;

drop policy if exists "Restaurant owners can upload logos" on storage.objects;
create policy "Restaurant owners can upload logos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'restaurant-logos'
  and public.is_restaurant_owner((storage.foldername(name))[1]::uuid)
);

drop policy if exists "Restaurant owners can update logos" on storage.objects;
create policy "Restaurant owners can update logos"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'restaurant-logos'
  and public.is_restaurant_owner((storage.foldername(name))[1]::uuid)
)
with check (
  bucket_id = 'restaurant-logos'
  and public.is_restaurant_owner((storage.foldername(name))[1]::uuid)
);

drop policy if exists "Restaurant owners can delete logos" on storage.objects;
create policy "Restaurant owners can delete logos"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'restaurant-logos'
  and public.is_restaurant_owner((storage.foldername(name))[1]::uuid)
);
