ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS online_payment_methods jsonb NOT NULL
DEFAULT '{"card":false,"gcash":true,"qrph":true,"grab_pay":true,"paymaya":true,"dob":true,"billease":false}'::jsonb;

ALTER TABLE public.restaurants
ADD CONSTRAINT restaurants_online_payment_methods_object
CHECK (jsonb_typeof(online_payment_methods) = 'object');

ALTER TABLE public.restaurants
ALTER COLUMN online_payment_methods
SET DEFAULT '{"card":false,"gcash":true,"qrph":true,"grab_pay":true,"paymaya":true,"dob":true,"billease":false}'::jsonb;

UPDATE public.restaurants
SET online_payment_methods = jsonb_set(
  COALESCE(online_payment_methods, '{}'::jsonb),
  '{dob}',
  'true'::jsonb,
  true
)
WHERE online_payment_methods->'dob' IS DISTINCT FROM 'true'::jsonb;
