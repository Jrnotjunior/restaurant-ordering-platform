-- Two-way support-ticket messaging with strict tenant and admin boundaries.
create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.restaurant_support_requests(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  message text not null check (length(btrim(message)) between 1 and 10000),
  visibility text not null default 'public' check (visibility in ('public','internal')),
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages(ticket_id, created_at);
alter table public.support_ticket_messages enable row level security;
revoke all on public.support_ticket_messages from anon, authenticated;
grant select, insert on public.support_ticket_messages to authenticated;
drop policy if exists "Ticket owners can read public messages" on public.support_ticket_messages;
create policy "Ticket owners can read public messages"
on public.support_ticket_messages for select to authenticated
using (visibility = 'public' and exists (
  select 1 from public.restaurant_support_requests t
  join public.restaurants r on r.id = t.restaurant_id
  where t.id = support_ticket_messages.ticket_id and r.owner_id = (select auth.uid())
));
drop policy if exists "Ticket owners can send public messages" on public.support_ticket_messages;
create policy "Ticket owners can send public messages"
on public.support_ticket_messages for insert to authenticated
with check (
  visibility = 'public' and sender_user_id = (select auth.uid()) and exists (
    select 1 from public.restaurant_support_requests t
    join public.restaurants r on r.id = t.restaurant_id
    where t.id = support_ticket_messages.ticket_id and r.owner_id = (select auth.uid())
      and t.status not in ('resolved','closed','cancelled')
  )
);
drop policy if exists "System admins can read support messages" on public.support_ticket_messages;
create policy "System admins can read support messages"
on public.support_ticket_messages for select to authenticated
using (exists (select 1 from public.system_admin_get_my_access_level() a where a.is_active = true and a.status = 'active'));
drop policy if exists "Support admins can send support messages" on public.support_ticket_messages;
create policy "Support admins can send support messages"
on public.support_ticket_messages for insert to authenticated
with check (
  sender_user_id = (select auth.uid()) and exists (
    select 1 from public.system_admin_get_my_access_level() a
    where a.is_active = true and a.status = 'active'
      and a.access_level = any (array['owner','administrator'])
  )
);
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_ticket_messages'
     ) then
    alter publication supabase_realtime add table public.support_ticket_messages;
  end if;
end $$;
