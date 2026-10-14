-- Private support-ticket attachments stored outside PostgreSQL row data.
-- Files are scoped to a ticket UUID folder and only ticket owners/support admins can access them.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain']
)
on conflict (id) do update
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain'];

create table if not exists public.support_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.restaurant_support_requests(id) on delete cascade,
  message_id uuid references public.support_ticket_messages(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  visibility text not null default 'public' check (visibility in ('public','internal')),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_attachments_ticket_created_idx
  on public.support_ticket_attachments(ticket_id, created_at desc);
create index if not exists support_ticket_attachments_message_idx
  on public.support_ticket_attachments(message_id);

alter table public.support_ticket_attachments enable row level security;
revoke all on public.support_ticket_attachments from anon, authenticated;
grant select, insert, delete on public.support_ticket_attachments to authenticated;

create or replace function public.can_access_support_ticket_attachment(p_ticket_id uuid, p_visibility text default 'public')
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.restaurant_support_requests t
    join public.restaurants r on r.id = t.restaurant_id
    where t.id = p_ticket_id
      and (
        (r.owner_id = (select auth.uid()) and p_visibility = 'public')
        or exists (
          select 1 from public.system_admin_get_my_access_level() a
          where a.is_active = true and a.status = 'active'
            and (
              p_visibility = 'public'
              or a.access_level = any (array['owner','administrator'])
            )
        )
      )
  );
$$;

revoke all on function public.can_access_support_ticket_attachment(uuid, text) from public, anon;
grant execute on function public.can_access_support_ticket_attachment(uuid, text) to authenticated;

drop policy if exists "Ticket participants can read attachment metadata" on public.support_ticket_attachments;
create policy "Ticket participants can read attachment metadata"
on public.support_ticket_attachments for select to authenticated
using (public.can_access_support_ticket_attachment(ticket_id, visibility));

drop policy if exists "Ticket participants can register attachments" on public.support_ticket_attachments;
create policy "Ticket participants can register attachments"
on public.support_ticket_attachments for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and public.can_access_support_ticket_attachment(ticket_id, visibility)
  and exists (
    select 1 from public.restaurant_support_requests t
    where t.id = ticket_id and t.status not in ('resolved','closed','cancelled')
  )
);

drop policy if exists "Ticket attachment owners and admins can delete metadata" on public.support_ticket_attachments;
create policy "Ticket attachment owners and admins can delete metadata"
on public.support_ticket_attachments for delete to authenticated
using (
  uploaded_by = (select auth.uid())
  or exists (
    select 1 from public.system_admin_get_my_access_level() a
    where a.is_active = true and a.status = 'active'
      and a.access_level = any (array['owner','administrator'])
  )
);

drop policy if exists "Authorized users can upload support attachments" on storage.objects;
create policy "Authorized users can upload support attachments"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.restaurant_support_requests t
    where t.id::text = (storage.foldername(name))[1]
      and public.can_access_support_ticket_attachment(t.id, 'public')
      and t.status not in ('resolved','closed','cancelled')
  )
);

drop policy if exists "Authorized users can read support attachments" on storage.objects;
create policy "Authorized users can read support attachments"
on storage.objects for select to authenticated
using (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.support_ticket_attachments a
    where a.storage_path = name
      and public.can_access_support_ticket_attachment(a.ticket_id, a.visibility)
  )
);

drop policy if exists "Authorized users can delete support attachments" on storage.objects;
create policy "Authorized users can delete support attachments"
on storage.objects for delete to authenticated
using (
  bucket_id = 'support-attachments'
  and exists (
    select 1 from public.support_ticket_attachments a
    where a.storage_path = name
      and (
        a.uploaded_by = (select auth.uid())
        or exists (
          select 1 from public.system_admin_get_my_access_level() x
          where x.is_active = true and x.status = 'active'
            and x.access_level = any (array['owner','administrator'])
        )
      )
  )
);
