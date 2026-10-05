-- Allow the trusted create-staff Edge Function to manage employee records.
-- service_role is never exposed to the browser; tenant authorization is enforced
-- inside the Edge Function before these privileges are used.
grant select, insert, update, delete on table public.restaurant_staff to service_role;
