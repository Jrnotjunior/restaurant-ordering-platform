-- Rider availability/status is not part of the rider account model.
-- Rider records are managed by the restaurant through their account details
-- and delivery scopes. Remove the unused status column if it exists.

alter table if exists public.restaurant_riders
  drop column if exists status;
