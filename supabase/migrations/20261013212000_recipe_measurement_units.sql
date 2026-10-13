ALTER TABLE public.restaurant_menu_recipe_ingredients
  ADD COLUMN IF NOT EXISTS quantity_unit text;

UPDATE public.restaurant_menu_recipe_ingredients r
SET quantity_unit = i.unit
FROM public.restaurant_inventory_items i
WHERE r.inventory_item_id = i.id
  AND (r.quantity_unit IS NULL OR btrim(r.quantity_unit) = '');

ALTER TABLE public.restaurant_menu_recipe_ingredients
  ALTER COLUMN quantity_unit SET DEFAULT 'pcs';
ALTER TABLE public.restaurant_menu_recipe_ingredients
  ALTER COLUMN quantity_unit SET NOT NULL;
