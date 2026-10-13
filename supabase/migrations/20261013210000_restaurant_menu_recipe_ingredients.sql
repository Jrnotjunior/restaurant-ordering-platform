-- Recipe-to-inventory links and idempotent ingredient deductions when orders complete.
CREATE TABLE IF NOT EXISTS public.restaurant_menu_recipe_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.restaurant_inventory_items(id) ON DELETE CASCADE,
  quantity_per_product numeric(12,3) NOT NULL CHECK (quantity_per_product > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_recipe_one_link UNIQUE (product_id, inventory_item_id)
);
CREATE INDEX IF NOT EXISTS restaurant_menu_recipe_restaurant_idx ON public.restaurant_menu_recipe_ingredients(restaurant_id, product_id);
ALTER TABLE public.restaurant_menu_recipe_ingredients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_menu_recipe_ingredients TO authenticated;
DROP POLICY IF EXISTS restaurant_recipe_owner_select ON public.restaurant_menu_recipe_ingredients;
CREATE POLICY restaurant_recipe_owner_select ON public.restaurant_menu_recipe_ingredients FOR SELECT TO authenticated USING (public.is_restaurant_owner(restaurant_id));
DROP POLICY IF EXISTS restaurant_recipe_owner_insert ON public.restaurant_menu_recipe_ingredients;
CREATE POLICY restaurant_recipe_owner_insert ON public.restaurant_menu_recipe_ingredients FOR INSERT TO authenticated WITH CHECK (public.is_restaurant_owner(restaurant_id));
DROP POLICY IF EXISTS restaurant_recipe_owner_update ON public.restaurant_menu_recipe_ingredients;
CREATE POLICY restaurant_recipe_owner_update ON public.restaurant_menu_recipe_ingredients FOR UPDATE TO authenticated USING (public.is_restaurant_owner(restaurant_id)) WITH CHECK (public.is_restaurant_owner(restaurant_id));
DROP POLICY IF EXISTS restaurant_recipe_owner_delete ON public.restaurant_menu_recipe_ingredients;
CREATE POLICY restaurant_recipe_owner_delete ON public.restaurant_menu_recipe_ingredients FOR DELETE TO authenticated USING (public.is_restaurant_owner(restaurant_id));

CREATE TABLE IF NOT EXISTS public.restaurant_inventory_order_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.restaurant_inventory_items(id) ON DELETE RESTRICT,
  quantity_deducted numeric(12,3) NOT NULL CHECK (quantity_deducted > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_inventory_order_item_deduction_unique UNIQUE (order_id, inventory_item_id)
);
CREATE INDEX IF NOT EXISTS restaurant_inventory_order_deductions_restaurant_idx ON public.restaurant_inventory_order_deductions(restaurant_id, created_at DESC);
ALTER TABLE public.restaurant_inventory_order_deductions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.restaurant_inventory_order_deductions TO authenticated;
DROP POLICY IF EXISTS restaurant_inventory_order_deductions_owner_select ON public.restaurant_inventory_order_deductions;
CREATE POLICY restaurant_inventory_order_deductions_owner_select ON public.restaurant_inventory_order_deductions FOR SELECT TO authenticated USING (public.is_restaurant_owner(restaurant_id));

CREATE OR REPLACE FUNCTION public.deduct_recipe_inventory_on_order_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_need record;
  v_item public.restaurant_inventory_items%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  -- Lock all linked stock rows in stable ID order and verify the full order before changing any quantity.
  FOR v_need IN
    SELECT r.inventory_item_id, sum(r.quantity_per_product * oi.quantity)::numeric(12,3) AS required_quantity
    FROM public.order_items oi
    JOIN public.restaurant_menu_recipe_ingredients r
      ON r.product_id = oi.product_id
     AND r.restaurant_id = NEW.restaurant_id
    WHERE oi.order_id = NEW.id
    GROUP BY r.inventory_item_id
    ORDER BY r.inventory_item_id
  LOOP
    SELECT * INTO v_item
    FROM public.restaurant_inventory_items
    WHERE id = v_need.inventory_item_id
      AND restaurant_id = NEW.restaurant_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Recipe inventory item is missing for order %', NEW.order_number;
    END IF;
    IF v_item.quantity_on_hand < v_need.required_quantity THEN
      RAISE EXCEPTION 'Insufficient stock for %: need % %, available % %',
        v_item.name, v_need.required_quantity, v_item.unit, v_item.quantity_on_hand, v_item.unit
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  FOR v_need IN
    SELECT r.inventory_item_id, sum(r.quantity_per_product * oi.quantity)::numeric(12,3) AS required_quantity
    FROM public.order_items oi
    JOIN public.restaurant_menu_recipe_ingredients r
      ON r.product_id = oi.product_id
     AND r.restaurant_id = NEW.restaurant_id
    WHERE oi.order_id = NEW.id
    GROUP BY r.inventory_item_id
    ORDER BY r.inventory_item_id
  LOOP
    UPDATE public.restaurant_inventory_items
    SET quantity_on_hand = quantity_on_hand - v_need.required_quantity,
        updated_at = now()
    WHERE id = v_need.inventory_item_id
      AND restaurant_id = NEW.restaurant_id;

    INSERT INTO public.restaurant_inventory_movements
      (restaurant_id, item_id, item_name, unit, quantity_change, reason, created_by)
    SELECT NEW.restaurant_id, id, name, unit, -v_need.required_quantity,
           'Completed order ' || NEW.order_number, NULL
    FROM public.restaurant_inventory_items
    WHERE id = v_need.inventory_item_id;

    INSERT INTO public.restaurant_inventory_order_deductions
      (restaurant_id, order_id, inventory_item_id, quantity_deducted)
    VALUES (NEW.restaurant_id, NEW.id, v_need.inventory_item_id, v_need.required_quantity)
    ON CONFLICT (order_id, inventory_item_id) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS deduct_recipe_inventory_on_order_completion ON public.orders;
CREATE TRIGGER deduct_recipe_inventory_on_order_completion
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
EXECUTE FUNCTION public.deduct_recipe_inventory_on_order_completion();
REVOKE ALL ON FUNCTION public.deduct_recipe_inventory_on_order_completion() FROM PUBLIC, anon, authenticated;
