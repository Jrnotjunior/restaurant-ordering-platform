-- Prevent a recipe from connecting products or stock belonging to another tenant.
CREATE OR REPLACE FUNCTION public.enforce_restaurant_recipe_tenant_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $function$
DECLARE v_product_restaurant uuid; v_item_restaurant uuid;
BEGIN
  SELECT restaurant_id INTO v_product_restaurant FROM public.products WHERE id = NEW.product_id;
  SELECT restaurant_id INTO v_item_restaurant FROM public.restaurant_inventory_items WHERE id = NEW.inventory_item_id;
  IF v_product_restaurant IS NULL OR v_item_restaurant IS NULL
     OR v_product_restaurant <> NEW.restaurant_id
     OR v_item_restaurant <> NEW.restaurant_id THEN
    RAISE EXCEPTION 'Recipe product and inventory item must belong to the same restaurant'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $function$;
DROP TRIGGER IF EXISTS enforce_restaurant_recipe_tenant_integrity ON public.restaurant_menu_recipe_ingredients;
CREATE TRIGGER enforce_restaurant_recipe_tenant_integrity
BEFORE INSERT OR UPDATE OF restaurant_id, product_id, inventory_item_id ON public.restaurant_menu_recipe_ingredients
FOR EACH ROW EXECUTE FUNCTION public.enforce_restaurant_recipe_tenant_integrity();
REVOKE ALL ON FUNCTION public.enforce_restaurant_recipe_tenant_integrity() FROM PUBLIC, anon, authenticated;
