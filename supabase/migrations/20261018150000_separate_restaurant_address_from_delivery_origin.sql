-- Keep the customer-facing restaurant address separate from the delivery map origin.
alter table public.restaurants
  add column if not exists restaurant_address text;
