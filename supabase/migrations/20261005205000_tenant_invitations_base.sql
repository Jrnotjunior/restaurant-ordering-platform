-- Base schema for tenant invitations.
-- This table is required by the tenant onboarding RPCs introduced in
-- 20261005210000_system_admin_create_restaurant_with_package_onboarding.sql.
-- Keep this migration ordered before those RPC definitions.

create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  auth_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    constraint tenant_invitations_status_check
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  accepted_at timestamptz,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_invitations_restaurant_id
  on public.tenant_invitations (restaurant_id);
create index if not exists tenant_invitations_auth_user_idx
  on public.tenant_invitations (auth_user_id);
create index if not exists tenant_invitations_invited_by_idx
  on public.tenant_invitations (invited_by);
create unique index if not exists tenant_invitations_one_pending_email
  on public.tenant_invitations (lower(email))
  where status = 'pending';

alter table public.tenant_invitations enable row level security;

drop policy if exists tenant_invitations_no_direct_access
  on public.tenant_invitations;
create policy tenant_invitations_no_direct_access
  on public.tenant_invitations
  for all
  to authenticated
  using (false)
  with check (false);

revoke all on table public.tenant_invitations from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_invitations to service_role;
