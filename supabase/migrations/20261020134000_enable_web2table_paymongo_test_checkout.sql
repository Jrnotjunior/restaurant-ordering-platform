-- Web2Table sandbox-only checkout configuration.
-- This explicitly enables test-mode checkout using the platform's parent PayMongo
-- test key. It does NOT represent a real linked child account, persist an Account-ID,
-- or enable live payments. Production/live connections remain tenant-specific.
insert into public.restaurant_paymongo_accounts (
  restaurant_id,
  paymongo_account_id,
  connection_status,
  activation_status,
  webhook_id,
  webhook_secret_id,
  environment,
  onboarding_method,
  identity_verification_status,
  onboarding_step,
  last_error,
  created_at,
  updated_at
)
select
  r.id,
  null,
  'pending',
  'mock',
  null,
  null,
  'test',
  'create_account',
  'simulated',
  'test_simulation',
  'Sandbox-only checkout uses the platform test key; no real PayMongo child account is linked and child routing is not verified.',
  now(),
  now()
from public.restaurants r
where r.slug = 'solutions'
  and r.is_active = true
on conflict (restaurant_id, environment) do nothing;

notify pgrst, 'reload schema';
