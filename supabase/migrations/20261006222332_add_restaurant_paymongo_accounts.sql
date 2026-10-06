create table if not exists public.restaurant_paymongo_accounts (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  paymongo_account_id text unique,
  connection_status text not null default 'not_connected'
    check (connection_status in ('not_connected','pending','linked','active','revoked','error')),
  invitation_id text unique,
  invitation_email text,
  activation_status text,
  webhook_id text unique,
  webhook_secret_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_paymongo_accounts_account_id_format
    check (paymongo_account_id is null or paymongo_account_id ~ '^org_[A-Za-z0-9]+$')
);

create index if not exists restaurant_paymongo_accounts_status_idx
  on public.restaurant_paymongo_accounts (connection_status);

alter table public.restaurant_paymongo_accounts enable row level security;

grant select on public.restaurant_paymongo_accounts to authenticated;
grant select, insert, update, delete on public.restaurant_paymongo_accounts to service_role;

drop policy if exists "Restaurant owners can view their PayMongo connection" on public.restaurant_paymongo_accounts;
create policy "Restaurant owners can view their PayMongo connection"
  on public.restaurant_paymongo_accounts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.restaurants r
      where r.id = restaurant_paymongo_accounts.restaurant_id
        and r.owner_id = auth.uid()
    )
  );

create or replace function public.set_paymongo_webhook_secret(
  p_restaurant_id uuid,
  p_secret text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_name text := 'paymongo_webhook_' || p_restaurant_id::text;
begin
  if p_secret is null or btrim(p_secret) = '' then
    raise exception 'Webhook secret is required';
  end if;

  select webhook_secret_id
  into v_secret_id
  from public.restaurant_paymongo_accounts
  where restaurant_id = p_restaurant_id
  for update;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret,
      v_name,
      'PayMongo webhook signing secret for restaurant ' || p_restaurant_id::text
    );
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;

  update public.restaurant_paymongo_accounts
  set webhook_secret_id = v_secret_id,
      updated_at = now()
  where restaurant_id = p_restaurant_id;

  return v_secret_id;
end;
$$;

create or replace function public.get_paymongo_webhook_secret(
  p_restaurant_id uuid
)
returns text
language sql
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.id = (
    select webhook_secret_id
    from public.restaurant_paymongo_accounts
    where restaurant_id = p_restaurant_id
  )
  limit 1;
$$;

revoke execute on function public.set_paymongo_webhook_secret(uuid, text) from public, anon, authenticated;
revoke execute on function public.get_paymongo_webhook_secret(uuid) from public, anon, authenticated;
grant execute on function public.set_paymongo_webhook_secret(uuid, text) to service_role;
grant execute on function public.get_paymongo_webhook_secret(uuid) to service_role;

create or replace function public.set_restaurant_paymongo_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists restaurant_paymongo_accounts_updated_at
  on public.restaurant_paymongo_accounts;

create trigger restaurant_paymongo_accounts_updated_at
  before update on public.restaurant_paymongo_accounts
  for each row execute function public.set_restaurant_paymongo_updated_at();
