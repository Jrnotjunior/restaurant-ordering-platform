alter table public.restaurant_paymongo_accounts
  add column if not exists onboarding_method text not null default 'invite'
    check (onboarding_method in ('invite','create_account')),
  add column if not exists verification_url text,
  add column if not exists identity_verification_status text,
  add column if not exists onboarding_step text,
  add column if not exists last_error text;

create index if not exists restaurant_paymongo_accounts_onboarding_idx
  on public.restaurant_paymongo_accounts (environment, onboarding_method, onboarding_step);