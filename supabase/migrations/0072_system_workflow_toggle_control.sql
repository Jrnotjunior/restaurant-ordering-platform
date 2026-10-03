-- System-admin control for operational workflow toggles.
-- Store owners can view these settings, but only a System Administrator
-- may change the active workflow.

create or replace function public.protect_system_workflow_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if new.cash_on_delivery_enabled is distinct from old.cash_on_delivery_enabled
     or new.automatic_rider_assignment_enabled is distinct from old.automatic_rider_assignment_enabled then
    v_role := coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');

    if v_role <> 'system_admin' then
      raise exception 'Cash on Delivery and Automatic Rider Assignment are controlled by the System Administrator.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_system_workflow_settings() from public, anon, authenticated;

drop trigger if exists restaurants_protect_system_workflow_settings
on public.restaurants;

create trigger restaurants_protect_system_workflow_settings
before update on public.restaurants
for each row
execute function public.protect_system_workflow_settings();
