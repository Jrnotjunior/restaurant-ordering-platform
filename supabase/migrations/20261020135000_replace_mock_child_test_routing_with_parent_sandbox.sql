-- Roll back the mock PayMongo child-ID experiment.
-- Test checkouts may use the platform's parent test key only when the tenant has
-- an explicit test_parent_account marker. No fake child Account-ID is stored or sent.
alter table public.restaurant_paymongo_accounts
  drop constraint if exists restaurant_paymongo_accounts_account_id_format;

alter table public.restaurant_paymongo_accounts
  add constraint restaurant_paymongo_accounts_account_id_format
  check (
    paymongo_account_id is null
    or paymongo_account_id ~ '^org_[A-Za-z0-9]+$'
  );

update public.restaurant_paymongo_accounts
set
  onboarding_step = 'test_parent_account',
  activation_status = 'mock',
  identity_verification_status = 'simulated',
  paymongo_account_id = null,
  webhook_id = null,
  webhook_secret_id = null,
  last_error = 'Sandbox-only parent checkout uses the platform test key without an Account-ID header. No real child account is linked; child routing is not verified.',
  updated_at = now()
where environment = 'test'
  and onboarding_step = 'test_simulation'
  and paymongo_account_id is null
  and webhook_id is null
  and webhook_secret_id is null;

notify pgrst, 'reload schema';
