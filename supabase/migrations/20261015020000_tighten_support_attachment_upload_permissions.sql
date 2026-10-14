-- Restrict attachment writes to restaurant owners and support owner/administrator roles.
-- Public reads remain available to active support staff according to can_access_support_ticket_attachment.
drop policy if exists "Ticket participants can register attachments" on public.support_ticket_attachments;
create policy "Ticket participants can register attachments"
on public.support_ticket_attachments
for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1
    from public.restaurant_support_requests t
    join public.restaurants r on r.id = t.restaurant_id
    where t.id = support_ticket_attachments.ticket_id
      and t.status not in ('resolved','closed','cancelled')
      and (
        (r.owner_id = (select auth.uid()) and visibility = 'public')
        or exists (
          select 1 from public.system_admin_get_my_access_level() a
          where a.is_active = true and a.status = 'active'
            and a.access_level in ('owner','administrator')
        )
      )
  )
);
drop policy if exists "Authorized users can upload support attachments" on storage.objects;
create policy "Authorized users can upload support attachments"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.restaurant_support_requests t
    join public.restaurants r on r.id = t.restaurant_id
    where t.id::text = (storage.foldername(objects.name))[1]
      and t.status not in ('resolved','closed','cancelled')
      and (
        r.owner_id = (select auth.uid())
        or exists (
          select 1 from public.system_admin_get_my_access_level() a
          where a.is_active = true and a.status = 'active'
            and a.access_level in ('owner','administrator')
        )
      )
  )
);
