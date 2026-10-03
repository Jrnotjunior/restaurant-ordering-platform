-- Route-aware automatic rider assignment.
-- Riders may receive another ready delivery when it is in a zone they cover.
-- Riders already handling an active delivery in the same barangay are
-- prioritized over riders with no active delivery.
-- Riders with active deliveries in other barangays are not selected.

create or replace function public.auto_assign_ready_delivery_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_rider_id uuid;
  v_order_id uuid;
  v_today_start timestamptz;
begin
  if new.order_type <> 'delivery'
     or new.status <> 'ready'
     or coalesce(new.delivery_status, 'unassigned') <> 'unassigned'
     or new.rider_id is not null
     or nullif(trim(coalesce(new.delivery_barangay, '')), '') is null then
    return new;
  end if;

  select r.id
    into v_restaurant_id
  from public.restaurants r
  where r.id = new.restaurant_id
    and r.is_active = true
    and r.automatic_rider_assignment_enabled = true
  for update;

  if v_restaurant_id is null then
    return new;
  end if;

  v_today_start := date_trunc('day', now());

  select s.id
    into v_rider_id
  from public.restaurant_staff s
  where s.restaurant_id = new.restaurant_id
    and s.role = 'rider'
    and s.is_active = true

    -- Rider must be assigned to the new order's delivery zone.
    and exists (
      select 1
      from public.rider_delivery_zones rdz
      join public.restaurant_delivery_zones z
        on z.id = rdz.delivery_zone_id
      where rdz.restaurant_id = new.restaurant_id
        and rdz.rider_id = s.id
        and z.restaurant_id = new.restaurant_id
        and z.is_supported = true
        and lower(trim(z.barangay))
            = lower(trim(new.delivery_barangay))
    )

    -- A rider with an active delivery may only receive another order
    -- when at least one active delivery is in the same barangay.
    and not exists (
      select 1
      from public.delivery_assignments active_da
      join public.orders active_order
        on active_order.id = active_da.order_id
      where active_da.restaurant_id = new.restaurant_id
        and active_da.rider_id = s.id
        and active_da.status in ('assigned', 'delivering')
        and lower(trim(coalesce(active_order.delivery_barangay, '')))
            <> lower(trim(new.delivery_barangay))
    )

  order by
    -- First: riders already carrying an active order in this same zone.
    case when exists (
      select 1
      from public.delivery_assignments same_zone_da
      join public.orders same_zone_order
        on same_zone_order.id = same_zone_da.order_id
      where same_zone_da.restaurant_id = new.restaurant_id
        and same_zone_da.rider_id = s.id
        and same_zone_da.status in ('assigned', 'delivering')
        and lower(trim(coalesce(same_zone_order.delivery_barangay, '')))
            = lower(trim(new.delivery_barangay))
    ) then 0 else 1 end asc,

    -- Second: among otherwise equivalent riders, prefer fewer completed
    -- deliveries today.
    (
      select count(*)
      from public.delivery_assignments da
      where da.restaurant_id = new.restaurant_id
        and da.rider_id = s.id
        and da.status = 'delivered'
        and da.delivered_at >= v_today_start
    ) asc,

    s.created_at asc,
    s.id asc
  limit 1;

  if v_rider_id is null then
    return new;
  end if;

  insert into public.delivery_assignments (
    order_id,
    rider_id,
    restaurant_id,
    status
  )
  values (
    new.id,
    v_rider_id,
    new.restaurant_id,
    'assigned'
  )
  on conflict (order_id) where status in ('assigned', 'delivering')
  do nothing
  returning order_id into v_order_id;

  if v_order_id is not null then
    update public.orders
    set rider_id = v_rider_id,
        delivery_status = 'assigned',
        rider_assigned_at = now()
    where id = new.id
      and rider_id is null
      and coalesce(delivery_status, 'unassigned') = 'unassigned';
  end if;

  return new;
end;
$$;

revoke all on function public.auto_assign_ready_delivery_order()
from public, anon, authenticated;

drop trigger if exists orders_auto_assign_ready_delivery
on public.orders;

create trigger orders_auto_assign_ready_delivery
after insert or update of status, delivery_status, rider_id
on public.orders
for each row
when (
  new.order_type = 'delivery'
  and new.status = 'ready'
  and coalesce(new.delivery_status, 'unassigned') = 'unassigned'
  and new.rider_id is null
)
execute function public.auto_assign_ready_delivery_order();
