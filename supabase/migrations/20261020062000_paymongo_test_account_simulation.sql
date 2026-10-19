-- PayMongo test keys return mock account objects (for example org_test_merchant),
-- not real linked children. Preserve these as a clearly labeled simulation instead
-- of treating them as live child accounts or repeatedly trying child webhooks.
update public.restaurant_paymongo_accounts
set
  paymongo_account_id = null,
  connection_status = 'pending',
  activation_status = 'mock',
  identity_verification_status = 'simulated',
  onboarding_step = 'test_simulation',
  webhook_id = null,
  webhook_secret_id = null,
  last_error = 'Sandbox-only simulation. PayMongo test keys return mock accounts and do not establish a real child relationship. Checkout/refunds use the parent test account; child routing is not verified.',
  updated_at = now()
where environment = 'test'
  and paymongo_account_id = 'org_test_merchant'
  and connection_status = 'pending'
  and webhook_id is null
  and webhook_secret_id is null;

notify pgrst, 'reload schema';
