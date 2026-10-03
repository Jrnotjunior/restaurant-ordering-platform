-- Retry waiting ready delivery orders when a rider becomes available
-- or when a rider's delivery scope becomes eligible.
--
-- This complements the ready-order trigger. If no eligible rider was free
-- when an order became ready, the order remains unassigned and is retried
-- when a rider becomes available.

create or replace function public.retry_waiting_delivery_order_for_rider(
  p_restaurant_id uuid,
  p_rider_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_barangay text;
begin
  if p_restaurant_id is null or p_rider_id is null then
    return false;
  end if;

  -- Auto Dispatch must still be enabled.
  if not exists (
    select 1
    from public.restaurants r
    where r.id = p_restaurant_id
      and r.is_active = true
      and r.automatic_rider_assignment_enabled = true
  ) then
    return false;
  end if;

  -- Only an active rider can receive an automatic retry.
  if not exists (
    select 1
    from public.restaurant_staff s
    where s.id = p_rider_id
      and s.restaurant_id = p_restaurant_id
      and s.role = 'rider'
      and s.is_active = true
  ) then
    return false;
  end if;

  -- Do not give the rider another order while they still have
  -- an active assignment.
  if exists (
    select 1
    from public.delivery_assignments da
    where da.restaurant_id = p_restaurant_id
      and da.rider_id = p_rider_id
      and da.status in ('assigned', 'delivering')
  ) then
    return false;
  end if;

  -- Pick the oldest ready order in one of this rider's supported zones.
  select o.id, o.delivery_barangay
    into v_order_id, v_order_barangay
  from public.orders o
  where o.restaurant_id = p_restaurant_id
    and o.order_type = 'delivery'
    and o.status = 'ready'
    and coalesce(o.delivery_status, 'unassigned') = 'unassigned'
    and o.rider_id is null
    and nullif(trim(coalesce(o.delivery_barangay, '')), '') is not null
    and exists (
      select 1
      from public.rider_delivery_zones rdz
      join public.restaurant_delivery_zones z
        on z.id = rdz.delivery_zone_id
      where rdz.restaurant_id = p_restaurant_id
        and rdz.rider_id = p_rider_id
        and z.restaurant_id = p_restaurant_id
        and z.is_supported = true
        and lower(trim(z.barangay))
            = lower(trim(o.delivery_barangay))
    )
  order by o.created_at asc, o.id asc
  limit 1
  for update skip locked;

  if v_order_id is null then
    return false;
  end if;

  insert into public.delivery_assignments (
    order_id,
    rider_id,
    restaurant_id,
    status
  )
  values (
    v_order_id,
    p_rider_id,
    p_restaurant_id,
    'assigned'
  )
  on conflict (order_id) where status in ('assigned', 'delivering')
  do nothing;

  if not found then
    return false;
  end if;

  update public.orders
  set rider_id = p_rider_id,
      delivery_status = 'assigned',
      rider_assigned_at = now()
  where id = v_order_id
    and rider_id is null
    and coalesce(delivery_status, 'unassigned') = 'unassigned';

  return found;
end;
$$;

revoke all on function public.retry_waiting_delivery_order_for_rider(uuid, uuid)
from public, anon, authenticated;

-- Retry when an assignment becomes inactive.
drop trigger if exists delivery_assignments_retry_waiting_order
on public.delivery_assignments;

create trigger delivery_assignments_retry_waiting_order
after update of status
on public.delivery_assignments
for each row
when (
  old.status in ('assigned', 'delivering')
  and new.status not in ('assigned', 'delivering')
)
execute function public.retry_waiting_delivery_order_for_rider();

-- Retry when an owner gives a rider a new delivery zone.
create or replace function public.retry_waiting_delivery_order_after_scope_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.retry_waiting_delivery_order_for_rider(
    new.restaurant_id,
    new.rider_id
  );
  return new;
end;
$$;

revoke all on function public.retry_waiting_delivery_order_after_scope_change()
from public, anon, authenticated;

drop trigger if exists rider_delivery_zones_retry_waiting_order
on public.rider_delivery_zones;

create trigger rider_delivery_zones_retry_waiting_order
after insert
on public.rider_delivery_zones
for each row
execute function public.retry_waiting_delivery_order_after_scope_change();

-- Retry when a rider is activated.
create or replace function public.retry_waiting_delivery_order_after_rider_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'rider'
     and new.is_active = true
     and (
       tg_op = 'INSERT'
       or old.is_active is distinct from new.is_active
     ) then
    perform public.retry_waiting_delivery_order_for_rider(
      new.restaurant_id,
      new.id
    );
  end if;

  return new;
end;
$$;

revoke all on function public.retry_waiting_delivery_order_after_rider_activation()
from public, anon, authenticated;

drop trigger if exists restaurant_staff_retry_waiting_order
on public.restaurant_staff;

create trigger restaurant_staff_retry_waiting_order
after insert or update of is_active
on public.restaurant_staff
for each row
execute function public.retry_waiting_delivery_order_after_rider_activation();
