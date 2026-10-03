-- 0089_system_admin_staff_view.sql
--
-- System Admin can inspect restaurant staff without changing the owner-managed
-- staff invitation/account workflow.

create or replace function public.system_admin_get_restaurant_staff(
  p_restaurant_id uuid
)
returns table (
  id uuid,
  name text,
  mobile_number text,
  email text,
  role text,
  is_active boolean,
  auth_user_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    s.id,
    s.name,
    s.mobile_number,
    s.email,
    s.role,
    s.is_active,
    s.auth_user_id,
    s.created_at,
    s.updated_at
  from public.restaurant_staff s
  where s.restaurant_id = p_restaurant_id
    and public.is_system_admin()
  order by
    s.is_active desc,
    case s.role
      when 'cashier' then 1
      when 'kitchen' then 2
      when 'dispatcher' then 3
      else 99
    end,
    lower(s.name);
$$;

revoke all on function public.system_admin_get_restaurant_staff(uuid)
from public, anon;

grant execute on function public.system_admin_get_restaurant_staff(uuid)
to authenticated;
