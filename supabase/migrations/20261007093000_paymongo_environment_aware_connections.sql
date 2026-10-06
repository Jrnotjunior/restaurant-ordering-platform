alter table public.restaurant_paymongo_accounts
  add column if not exists environment text not null default 'test';

alter table public.restaurant_paymongo_accounts
  drop constraint if exists restaurant_paymongo_accounts_pkey;

alter table public.restaurant_paymongo_accounts
  add constraint restaurant_paymongo_accounts_environment_check
  check (environment in ('test','live'));

alter table public.restaurant_paymongo_accounts
  add constraint restaurant_paymongo_accounts_pkey
  primary key (restaurant_id, environment);

create index if not exists restaurant_paymongo_accounts_status_idx
  on public.restaurant_paymongo_accounts (environment, connection_status);

create unique index if not exists restaurant_paymongo_accounts_account_id_uidx
  on public.restaurant_paymongo_accounts (paymongo_account_id)
  where paymongo_account_id is not null;

create unique index if not exists restaurant_paymongo_accounts_invitation_id_uidx
  on public.restaurant_paymongo_accounts (invitation_id)
  where invitation_id is not null;

create unique index if not exists restaurant_paymongo_accounts_webhook_id_uidx
  on public.restaurant_paymongo_accounts (webhook_id)
  where webhook_id is not null;

create or replace function public.set_paymongo_webhook_secret(
  p_restaurant_id uuid,
  p_secret text,
  p_environment text default 'test'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
  v_name text := 'paymongo_webhook_' || p_environment || '_' || p_restaurant_id::text;
begin
  if p_environment not in ('test','live') then
    raise exception 'Invalid PayMongo environment';
  end if;
  if p_secret is null or btrim(p_secret) = '' then
    raise exception 'Webhook secret is required';
  end if;

  select webhook_secret_id into v_secret_id
  from public.restaurant_paymongo_accounts
  where restaurant_id = p_restaurant_id and environment = p_environment
  for update;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_secret, v_name,
      'PayMongo ' || p_environment || ' webhook signing secret for restaurant ' || p_restaurant_id::text);
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;

  update public.restaurant_paymongo_accounts
  set webhook_secret_id = v_secret_id, updated_at = now()
  where restaurant_id = p_restaurant_id and environment = p_environment;

  return v_secret_id;
end;
$$;

create or replace function public.get_paymongo_webhook_secret(
  p_restaurant_id uuid,
  p_environment text default 'test'
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
    where restaurant_id = p_restaurant_id and environment = p_environment
  )
  limit 1;
$$;

revoke execute on function public.set_paymongo_webhook_secret(uuid, text) from public, anon, authenticated;
revoke execute on function public.set_paymongo_webhook_secret(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.get_paymongo_webhook_secret(uuid) from public, anon, authenticated;
revoke execute on function public.get_paymongo_webhook_secret(uuid, text) from public, anon, authenticated;

grant execute on function public.set_paymongo_webhook_secret(uuid, text) to service_role;
grant execute on function public.set_paymongo_webhook_secret(uuid, text, text) to service_role;
grant execute on function public.get_paymongo_webhook_secret(uuid) to service_role;
grant execute on function public.get_paymongo_webhook_secret(uuid, text) to service_role;
