-- Enforce order lifecycle transitions at the database boundary.
-- This covers RPCs and direct updates (e.g. dispatch handoff), not only UI buttons.
-- Role/tenant authorization remains the responsibility of the existing RLS policies
-- and SECURITY DEFINER RPCs; this trigger validates the state transition itself.

CREATE OR REPLACE FUNCTION public.enforce_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  -- Allow updates to order details that do not change the lifecycle status.
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Completed and cancelled are terminal states. This also prevents reopening an
  -- order and accidentally re-triggering downstream effects such as loyalty awards.
  IF OLD.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Order status % is terminal and cannot transition to %',
      OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'pending'
     AND NEW.status IN ('confirmed', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- The kitchen board supports both direct confirmation-to-ready and the
  -- confirmed -> preparing -> ready path.
  IF OLD.status = 'confirmed'
     AND NEW.status IN ('preparing', 'ready', 'cancelled') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'preparing'
     AND NEW.status IN ('ready', 'cancelled') THEN
    RETURN NEW;
  END IF;

  -- Pickup/dine-in handoff is completed by Dispatch from Ready. Delivery orders
  -- can complete only when the same atomic update marks the delivery delivered.
  IF OLD.status = 'ready' AND NEW.status = 'completed' THEN
    IF NEW.order_type = 'delivery'
       AND NEW.delivery_status IS DISTINCT FROM 'delivered' THEN
      RAISE EXCEPTION 'A delivery order can only be completed after delivery is marked delivered'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Rider delivery failure atomically marks delivery_status=failed and cancels
  -- the order. Other ready orders cannot be cancelled through a status jump.
  IF OLD.status = 'ready'
     AND NEW.status = 'cancelled'
     AND NEW.order_type = 'delivery'
     AND NEW.delivery_status = 'failed' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Invalid order status transition: % -> %',
    OLD.status, NEW.status
    USING ERRCODE = '23514';
END;
$function$;

DROP TRIGGER IF EXISTS enforce_order_status_transition ON public.orders;
CREATE TRIGGER enforce_order_status_transition
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_order_status_transition();

REVOKE ALL ON FUNCTION public.enforce_order_status_transition() FROM PUBLIC, anon, authenticated;
