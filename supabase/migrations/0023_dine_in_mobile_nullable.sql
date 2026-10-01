-- Mobile number is optional for dine-in orders.
-- Delivery and pickup still validate mobile number in create_order.

ALTER TABLE public.orders
  ALTER COLUMN mobile_number DROP NOT NULL;
