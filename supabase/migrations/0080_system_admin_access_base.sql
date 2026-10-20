-- Base schema for system administrator access control.
-- Earlier System Admin authorization and onboarding functions assume this table
-- exists, but the prior repository migration chain did not create it.

create table if not exists public.system_admin_access (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null unique
    references auth.users(id) on delete cascade,
  access_level text not null
    constraint system_admin_access_access_level_check
    check (access_level in ('owner', 'administrator', 'view_only')),
  is_active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'active'
    constraint system_admin_access_status_check
    check (status in ('pending', 'active', 'revoked'))
);

create index if not exists idx_system_admin_access_active
  on public.system_admin_access (is_active);
create index if not exists idx_system_admin_access_granted_by
  on public.system_admin_access (granted_by);
create index if not exists idx_system_admin_access_user
  on public.system_admin_access (admin_user_id);

alter table public.system_admin_access enable row level security;

revoke all on table public.system_admin_access from public, anon, authenticated;
revoke insert, update, delete on table public.system_admin_access from service_role;
grant select on table public.system_admin_access to service_role;
