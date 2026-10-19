ALTER TABLE public.restaurants
ADD COLUMN IF NOT EXISTS online_payment_methods jsonb NOT NULL
DEFAULT '{"card":false,"gcash":true,"qrph":true,"grab_pay":true,"paymaya":true,"dob":true,"billease":false}'::jsonb;

ALTER TABLE public.restaurants
ADD CONSTRAINT restaurants_online_payment_methods_object
CHECK (jsonb_typeof(online_payment_methods) = 'object');
