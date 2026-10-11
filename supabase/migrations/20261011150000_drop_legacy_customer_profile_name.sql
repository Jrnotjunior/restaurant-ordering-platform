-- Remove the legacy full-name column after migrating customer profiles to first_name/last_name.
-- Current customer profile RPCs synthesize their compatibility "name" output from the split fields.
-- Signup trigger and upsert RPC write first_name/last_name only.
alter table public.customer_profiles
  drop column if exists name;
