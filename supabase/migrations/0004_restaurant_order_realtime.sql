-- Realtime invalidation notifications for the restaurant dashboard.
-- The broadcast contains only non-sensitive identifiers; the browser reloads
-- the protected restaurant-order RPC to obtain the actual order data.

create or replace function public.notify_restaurant_order_changed()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_restaurant_id uuid;
  v_order_id uuid;
begin
  v_restaurant_id := coalesce(NEW.restaurant_id, OLD.restaurant_id);
  v_order_id := coalesce(NEW.id, OLD.id);

  perform realtime.send(
    jsonb_build_object(
      'restaurant_id', v_restaurant_id,
      'order_id', v_order_id,
      'operation', TG_OP
    ),
    'restaurant_order_changed',
    'restaurant-orders:' || v_restaurant_id::text,
    false
  );

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists orders_restaurant_realtime_trigger on public.orders;

create trigger orders_restaurant_realtime_trigger
after insert or update or delete on public.orders
for each row
execute function public.notify_restaurant_order_changed();
