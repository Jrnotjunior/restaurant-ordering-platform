-- PayMongo's test Accounts API returns the mock child ID org_test_merchant.
-- Allow that exact ID only in test mode; live child IDs must still match the
-- normal org_<alphanumeric> format.
alter table public.restaurant_paymongo_accounts
  drop constraint if exists restaurant_paymongo_accounts_account_id_format;

alter table public.restaurant_paymongo_accounts
  add constraint restaurant_paymongo_accounts_account_id_format
  check (
    paymongo_account_id is null
    or paymongo_account_id ~ '^org_[A-Za-z0-9]+$'
    or (
      environment = 'test'
      and paymongo_account_id = 'org_test_merchant'
    )
  );

notify pgrst, 'reload schema';
