-- Distance-based delivery no longer uses rider delivery-zone scopes.
create or replace function public.auto_assign_ready_delivery_order()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_restaurant_id uuid; v_rider_id uuid; v_order_id uuid; v_today_start timestamptz;
begin
 if new.order_type<>'delivery' or new.status<>'ready' or coalesce(new.delivery_status,'unassigned')<>'unassigned' or new.rider_id is not null then return new; end if;
 select r.id into v_restaurant_id from public.restaurants r where r.id=new.restaurant_id and r.is_active=true and r.automatic_rider_assignment_enabled=true for update;
 if v_restaurant_id is null then return new; end if;
 v_today_start:=date_trunc('day',now());
 select s.id into v_rider_id from public.restaurant_staff s
 where s.restaurant_id=new.restaurant_id and s.role='rider' and s.is_active=true
 and not exists(select 1 from public.delivery_assignments da where da.restaurant_id=new.restaurant_id and da.rider_id=s.id and da.status in('assigned','delivering'))
 order by (select count(*) from public.delivery_assignments da where da.restaurant_id=new.restaurant_id and da.rider_id=s.id and da.status in('assigned','delivering')) asc,
 (select count(*) from public.delivery_assignments da where da.restaurant_id=new.restaurant_id and da.rider_id=s.id and da.status='delivered' and da.delivered_at>=v_today_start) asc,s.created_at asc,s.id asc limit 1;
 if v_rider_id is null then return new; end if;
 insert into public.delivery_assignments(order_id,rider_id,restaurant_id,status) values(new.id,v_rider_id,new.restaurant_id,'assigned') on conflict(order_id) where status in('assigned','delivering') do nothing returning order_id into v_order_id;
 if v_order_id is not null then update public.orders set rider_id=v_rider_id,delivery_status='assigned',rider_assigned_at=now() where id=new.id and rider_id is null and coalesce(delivery_status,'unassigned')='unassigned'; end if;
 return new;
end; $$;

create or replace function public.retry_waiting_delivery_order_for_rider(p_restaurant_id uuid,p_rider_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_order_id uuid;
begin
 if p_restaurant_id is null or p_rider_id is null then return false; end if;
 if not exists(select 1 from public.restaurants r where r.id=p_restaurant_id and r.is_active=true and r.automatic_rider_assignment_enabled=true) then return false; end if;
 if not exists(select 1 from public.restaurant_staff s where s.id=p_rider_id and s.restaurant_id=p_restaurant_id and s.role='rider' and s.is_active=true) then return false; end if;
 if exists(select 1 from public.delivery_assignments da where da.restaurant_id=p_restaurant_id and da.rider_id=p_rider_id and da.status in('assigned','delivering')) then return false; end if;
 select o.id into v_order_id from public.orders o where o.restaurant_id=p_restaurant_id and o.order_type='delivery' and o.status='ready' and coalesce(o.delivery_status,'unassigned')='unassigned' and o.rider_id is null order by o.created_at asc,o.id asc limit 1 for update skip locked;
 if v_order_id is null then return false; end if;
 insert into public.delivery_assignments(order_id,rider_id,restaurant_id,status) values(v_order_id,p_rider_id,p_restaurant_id,'assigned') on conflict(order_id) where status in('assigned','delivering') do nothing;
 if not found then return false; end if;
 update public.orders set rider_id=p_rider_id,delivery_status='assigned',rider_assigned_at=now() where id=v_order_id and rider_id is null and coalesce(delivery_status,'unassigned')='unassigned';
 return found;
end; $$;

drop trigger if exists rider_delivery_zones_retry_waiting_order on public.rider_delivery_zones;
drop trigger if exists orders_auto_assign_ready_delivery on public.orders;
create trigger orders_auto_assign_ready_delivery after insert or update of status,delivery_status,rider_id on public.orders for each row
when (new.order_type='delivery' and new.status='ready' and coalesce(new.delivery_status,'unassigned')='unassigned' and new.rider_id is null)
execute function public.auto_assign_ready_delivery_order();