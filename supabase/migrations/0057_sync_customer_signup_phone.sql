-- Sync customer signup phone numbers into customer_profiles.
-- The signup form stores the phone in Auth user_metadata.phone.
-- This keeps phone data in the customer profile instead of Auth's dedicated
-- phone identity field, because customer authentication uses email/password.

update public.customer_profiles cp
set
  phone = nullif(trim(coalesce(u.raw_user_meta_data ->> 'phone', '')), ''),
  updated_at = now()
from auth.users u
where cp.auth_user_id = u.id
  and coalesce(u.raw_user_meta_data ->> 'role', '') = 'customer'
  and nullif(trim(coalesce(u.raw_user_meta_data ->> 'phone', '')), '') is not null
  and cp.phone is distinct from nullif(trim(coalesce(u.raw_user_meta_data ->> 'phone', '')), '');
