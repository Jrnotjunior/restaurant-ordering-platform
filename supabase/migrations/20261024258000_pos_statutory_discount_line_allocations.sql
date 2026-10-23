-- Persist and validate cashier-entered, product-line allocations for each
-- statutory-discount beneficiary. No equal-group-share assumption is made.
CREATE TABLE IF NOT EXISTS public.order_discount_beneficiary_line_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL REFERENCES public.order_discount_beneficiaries(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  eligible_gross_amount numeric(12,2) NOT NULL CHECK (eligible_gross_amount > 0),
  eligible_net_amount numeric(12,2) NOT NULL CHECK (eligible_net_amount >= 0),
  discount_amount numeric(12,2) NOT NULL CHECK (discount_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_discount_beneficiary_line_allocations_unique_line
    UNIQUE (beneficiary_id, order_item_id)
);

CREATE INDEX IF NOT EXISTS order_discount_beneficiary_line_allocations_order_idx
  ON public.order_discount_beneficiary_line_allocations (order_id, beneficiary_id);

ALTER TABLE public.order_discount_beneficiary_line_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.order_discount_beneficiary_line_allocations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.order_discount_beneficiary_line_allocations TO authenticated;

DROP POLICY IF EXISTS "Owners and active cashiers can read beneficiary line allocations"
  ON public.order_discount_beneficiary_line_allocations;
CREATE POLICY "Owners and active cashiers can read beneficiary line allocations"
ON public.order_discount_beneficiary_line_allocations
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
      FROM public.orders o
      JOIN public.restaurants r ON r.id = o.restaurant_id
     WHERE o.id = order_discount_beneficiary_line_allocations.order_id
       AND (
         r.owner_id = auth.uid()
         OR EXISTS (
           SELECT 1 FROM public.restaurant_staff s
            WHERE s.restaurant_id = r.id
              AND s.auth_user_id = auth.uid()
              AND s.role = 'cashier'
              AND s.is_active = true
         )
       )
  )
);

CREATE OR REPLACE FUNCTION public.guard_order_discount_beneficiary_line_allocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_beneficiary_order_id uuid;
  v_item_order_id uuid;
  v_line_total numeric(12,2);
  v_already_allocated numeric(12,2);
BEGIN
  SELECT b.order_id INTO v_beneficiary_order_id
    FROM public.order_discount_beneficiaries b
   WHERE b.id = NEW.beneficiary_id;

  SELECT oi.order_id, oi.line_total
    INTO v_item_order_id, v_line_total
    FROM public.order_items oi
   WHERE oi.id = NEW.order_item_id
   FOR UPDATE;

  IF v_beneficiary_order_id IS NULL
     OR v_item_order_id IS NULL
     OR NEW.order_id IS DISTINCT FROM v_beneficiary_order_id
     OR NEW.order_id IS DISTINCT FROM v_item_order_id THEN
    RAISE EXCEPTION 'Discount allocation beneficiary, order, and item must belong to the same order';
  END IF;

  SELECT coalesce(sum(a.eligible_gross_amount), 0)
    INTO v_already_allocated
    FROM public.order_discount_beneficiary_line_allocations a
   WHERE a.order_item_id = NEW.order_item_id
     AND a.id IS DISTINCT FROM NEW.id;

  IF NEW.eligible_gross_amount <= 0
     OR v_already_allocated + NEW.eligible_gross_amount > v_line_total + 0.001 THEN
    RAISE EXCEPTION 'Allocated eligible amount cannot exceed the order item line total';
  END IF;

  IF NEW.discount_amount > NEW.eligible_net_amount THEN
    RAISE EXCEPTION 'Discount amount cannot exceed the eligible net amount';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_order_discount_beneficiary_line_allocation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_order_discount_beneficiary_line_allocation
  ON public.order_discount_beneficiary_line_allocations;
CREATE TRIGGER guard_order_discount_beneficiary_line_allocation
BEFORE INSERT OR UPDATE ON public.order_discount_beneficiary_line_allocations
FOR EACH ROW EXECUTE FUNCTION public.guard_order_discount_beneficiary_line_allocation();

CREATE OR REPLACE FUNCTION public.apply_pos_group_discounts(
  p_order_id uuid,
  p_group_size integer,
  p_beneficiaries jsonb
)
RETURNS TABLE (
  order_id uuid,
  group_size integer,
  beneficiary_count integer,
  discount_amount numeric,
  gross_sales numeric,
  vatable_sales numeric,
  vat_amount numeric,
  vat_exempt_sales numeric,
  net_sales numeric,
  total numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_restaurant public.restaurants%ROWTYPE;
  v_beneficiary jsonb;
  v_line jsonb;
  v_beneficiary_id uuid;
  v_type text;
  v_id_type text;
  v_id_number text;
  v_product_id uuid;
  v_item public.order_items%ROWTYPE;
  v_line_count integer;
  v_item_count integer := 0;
  v_classified_count integer := 0;
  v_item_total numeric(12,2) := 0;
  v_eligible_gross numeric(12,2);
  v_eligible_net numeric(12,2);
  v_line_discount numeric(12,2);
  v_beneficiary_eligible numeric(12,2);
  v_beneficiary_discount numeric(12,2);
  v_total_discount numeric(12,2) := 0;
  v_base_standard_net numeric(12,2) := 0;
  v_base_vat_exempt numeric(12,2) := 0;
  v_base_zero_rated numeric(12,2) := 0;
  v_eligible_standard_net numeric(12,2) := 0;
  v_eligible_standard_gross numeric(12,2) := 0;
  v_discount_standard numeric(12,2) := 0;
  v_discount_exempt numeric(12,2) := 0;
  v_discount_zero_rated numeric(12,2) := 0;
  v_vatable_sales numeric(12,2) := 0;
  v_vat_amount numeric(12,2) := 0;
  v_vat_exempt_sales numeric(12,2) := 0;
  v_zero_rated_sales numeric(12,2) := 0;
  v_net_sales numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_count integer;
BEGIN
  IF p_group_size IS NULL OR p_group_size < 1 THEN
    RAISE EXCEPTION 'Group size must be at least 1';
  END IF;
  IF jsonb_typeof(p_beneficiaries) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Discount beneficiaries must be an array';
  END IF;

  v_count := jsonb_array_length(p_beneficiaries);
  IF v_count > p_group_size THEN
    RAISE EXCEPTION 'Discount beneficiaries cannot exceed the group size';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_beneficiaries) x(value)
     GROUP BY trim(coalesce(x.value->>'discount_id_number', ''))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'The same ID number cannot be used for two beneficiaries on one order';
  END IF;

  SELECT * INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  SELECT * INTO v_restaurant
    FROM public.restaurants r
   WHERE r.id = v_order.restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant not found';
  END IF;

  IF NOT (
    v_restaurant.owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.restaurant_staff s
       WHERE s.restaurant_id = v_order.restaurant_id
         AND s.auth_user_id = auth.uid()
         AND s.role = 'cashier'
         AND s.is_active = true
    )
  ) THEN
    RAISE EXCEPTION 'You are not authorized to finalize POS financials for this order';
  END IF;

  IF coalesce(v_order.discount_beneficiary_count, 0) > 0
     OR coalesce(v_order.discount_amount, 0) > 0
     OR v_order.discount_type IS NOT NULL
     OR coalesce(v_order.tax_net_sales, 0) > 0
     OR v_order.tax_snapshot_status IN ('calculated', 'requires_review') THEN
    RAISE EXCEPTION 'POS financials have already been finalized for this order';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE oi.tax_category_snapshot IS NOT NULL),
         coalesce(round(sum(oi.line_total), 2), 0)
    INTO v_item_count, v_classified_count, v_item_total
    FROM public.order_items oi
   WHERE oi.order_id = p_order_id;

  IF v_item_count = 0 OR abs(v_item_total - v_order.subtotal) > 0.01 THEN
    RAISE EXCEPTION 'Order lines do not reconcile to the recorded subtotal';
  END IF;

  IF v_count > 0 AND v_restaurant.tax_vat_registered
     AND v_classified_count <> v_item_count THEN
    RAISE EXCEPTION 'Review tax categories for every item before applying a statutory discount';
  END IF;

  -- Validate and store each beneficiary, then allocate explicit portions of
  -- individual order lines. All writes roll back if any allocation is invalid.
  IF v_count > 0 THEN
    FOR v_beneficiary IN SELECT value FROM jsonb_array_elements(p_beneficiaries) LOOP
      v_type := lower(trim(coalesce(v_beneficiary->>'discount_type', '')));
      v_id_type := trim(coalesce(v_beneficiary->>'discount_id_type', ''));
      v_id_number := trim(coalesce(v_beneficiary->>'discount_id_number', ''));

      IF v_type NOT IN ('senior', 'pwd') THEN
        RAISE EXCEPTION 'Invalid discount type';
      END IF;
      IF length(v_id_type) = 0 OR length(v_id_number) = 0 THEN
        RAISE EXCEPTION 'ID type and ID number are required for every discount beneficiary';
      END IF;
      IF length(trim(coalesce(v_beneficiary->>'beneficiary_name', ''))) = 0
         OR length(trim(coalesce(v_beneficiary->>'beneficiary_address', ''))) = 0 THEN
        RAISE EXCEPTION 'Beneficiary name and address are required';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.order_discount_beneficiaries b
         WHERE b.order_id = p_order_id AND b.discount_id_number = v_id_number
      ) THEN
        RAISE EXCEPTION 'The same ID number cannot be used twice on one order';
      END IF;
      IF jsonb_typeof(v_beneficiary->'eligible_lines') IS DISTINCT FROM 'array'
         OR jsonb_array_length(coalesce(v_beneficiary->'eligible_lines', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Assign an eligible amount from at least one order line to each beneficiary';
      END IF;

      INSERT INTO public.order_discount_beneficiaries (
        order_id, discount_type, discount_id_type, discount_id_number,
        beneficiary_name, beneficiary_tin, beneficiary_address,
        eligible_amount, discount_amount
      ) VALUES (
        p_order_id, v_type, v_id_type, v_id_number,
        nullif(trim(coalesce(v_beneficiary->>'beneficiary_name', '')), ''),
        nullif(trim(coalesce(v_beneficiary->>'beneficiary_tin', '')), ''),
        nullif(trim(coalesce(v_beneficiary->>'beneficiary_address', '')), ''),
        0, 0
      )
      RETURNING id INTO v_beneficiary_id;

      v_beneficiary_eligible := 0;
      v_beneficiary_discount := 0;

      FOR v_line IN SELECT value FROM jsonb_array_elements(v_beneficiary->'eligible_lines') LOOP
        v_product_id := nullif(trim(coalesce(v_line->>'product_id', '')), '')::uuid;
        v_eligible_gross := round(nullif(trim(coalesce(v_line->>'eligible_amount', '')), '')::numeric, 2);

        IF v_product_id IS NULL OR v_eligible_gross IS NULL OR v_eligible_gross <= 0 THEN
          RAISE EXCEPTION 'Every allocated order line needs a product and a positive eligible amount';
        END IF;

        SELECT count(*) INTO v_line_count
          FROM public.order_items oi
         WHERE oi.order_id = p_order_id AND oi.product_id = v_product_id;
        IF v_line_count <> 1 THEN
          RAISE EXCEPTION 'Each allocated product must match exactly one order line';
        END IF;

        SELECT * INTO v_item
          FROM public.order_items oi
         WHERE oi.order_id = p_order_id AND oi.product_id = v_product_id
         FOR UPDATE;

        IF v_restaurant.tax_vat_registered AND v_item.tax_category_snapshot IS NULL THEN
          RAISE EXCEPTION 'Review the tax category for % before applying a statutory discount', v_item.product_name;
        END IF;
        IF v_eligible_gross > v_item.line_total THEN
          RAISE EXCEPTION 'Eligible amount for % exceeds the order line total', v_item.product_name;
        END IF;

        v_eligible_net := CASE
          WHEN v_restaurant.tax_vat_registered
           AND v_restaurant.tax_prices_vat_inclusive
           AND v_item.tax_category_snapshot = 'standard_rate'
            THEN round(v_eligible_gross / (1 + (v_restaurant.tax_vat_rate / 100)), 2)
          ELSE v_eligible_gross
        END;
        v_line_discount := round(v_eligible_net * 0.20, 2);

        INSERT INTO public.order_discount_beneficiary_line_allocations (
          order_id, beneficiary_id, order_item_id,
          eligible_gross_amount, eligible_net_amount, discount_amount
        ) VALUES (
          p_order_id, v_beneficiary_id, v_item.id,
          v_eligible_gross, v_eligible_net, v_line_discount
        );

        v_beneficiary_eligible := v_beneficiary_eligible + v_eligible_net;
        v_beneficiary_discount := v_beneficiary_discount + v_line_discount;
      END LOOP;

      IF v_beneficiary_eligible <= 0 OR v_beneficiary_discount <= 0 THEN
        RAISE EXCEPTION 'Each beneficiary must have a positive eligible amount';
      END IF;

      UPDATE public.order_discount_beneficiaries b
         SET eligible_amount = v_beneficiary_eligible,
             discount_amount = v_beneficiary_discount
       WHERE b.id = v_beneficiary_id;

      v_total_discount := v_total_discount + v_beneficiary_discount;
    END LOOP;
  END IF;

  SELECT
    coalesce(round(sum(CASE
      WHEN oi.tax_category_snapshot = 'standard_rate'
       AND v_restaurant.tax_vat_registered
       AND v_restaurant.tax_prices_vat_inclusive
        THEN round(oi.line_total / (1 + (v_restaurant.tax_vat_rate / 100)), 2)
      ELSE oi.line_total END) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate'), 2), 0),
    coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'vat_exempt'), 2), 0),
    coalesce(round(sum(oi.line_total) FILTER (WHERE oi.tax_category_snapshot = 'zero_rated'), 2), 0)
  INTO v_base_standard_net, v_base_vat_exempt, v_base_zero_rated
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id;

  SELECT
    coalesce(round(sum(a.eligible_net_amount) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate'), 2), 0),
    coalesce(round(sum(a.eligible_gross_amount) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate'), 2), 0),
    coalesce(round(sum(a.discount_amount) FILTER (WHERE oi.tax_category_snapshot = 'standard_rate'), 2), 0),
    coalesce(round(sum(a.discount_amount) FILTER (WHERE oi.tax_category_snapshot = 'vat_exempt'), 2), 0),
    coalesce(round(sum(a.discount_amount) FILTER (WHERE oi.tax_category_snapshot = 'zero_rated'), 2), 0)
  INTO v_eligible_standard_net, v_eligible_standard_gross, v_discount_standard,
       v_discount_exempt, v_discount_zero_rated
  FROM public.order_discount_beneficiary_line_allocations a
  JOIN public.order_items oi ON oi.id = a.order_item_id
  WHERE a.order_id = p_order_id;

  IF v_restaurant.tax_vat_registered AND v_classified_count = v_item_count THEN
    v_vatable_sales := greatest(round(v_base_standard_net - v_eligible_standard_net, 2), 0);
    v_vat_amount := round(v_vatable_sales * v_restaurant.tax_vat_rate / 100, 2);
    v_vat_exempt_sales := greatest(
      round(v_base_vat_exempt - v_discount_exempt
        + v_eligible_standard_net - v_discount_standard, 2), 0
    );
    v_zero_rated_sales := greatest(round(v_base_zero_rated - v_discount_zero_rated, 2), 0);
    v_net_sales := round(v_vatable_sales + v_vat_exempt_sales + v_zero_rated_sales, 2);

    IF v_restaurant.tax_prices_vat_inclusive THEN
      -- Preserve the configured display-price total; remove only the VAT
      -- embedded in the allocated standard-rated portions plus their 20% discount.
      v_total := greatest(round(
        v_order.subtotal + v_order.delivery_fee
        - greatest(v_eligible_standard_gross - v_eligible_standard_net, 0)
        - v_total_discount, 2
      ), 0);
    ELSE
      v_total := greatest(round(v_net_sales + v_vat_amount + v_order.delivery_fee, 2), 0);
    END IF;
  ELSIF NOT v_restaurant.tax_vat_registered THEN
    v_vatable_sales := 0;
    v_vat_amount := 0;
    v_vat_exempt_sales := 0;
    v_zero_rated_sales := 0;
    v_net_sales := greatest(round(v_order.subtotal - v_total_discount, 2), 0);
    v_total := greatest(round(v_net_sales + v_order.delivery_fee, 2), 0);
  ELSE
    -- Unknown classifications are never promoted to a completed snapshot.
    -- Preserve existing checkout pricing behavior while leaving the tax state
    -- for review; a statutory discount still needs every line classified above.
    v_vatable_sales := CASE WHEN v_restaurant.tax_prices_vat_inclusive
      THEN greatest(round(v_order.subtotal / (1 + (v_restaurant.tax_vat_rate / 100)), 2), 0)
      ELSE greatest(round(v_order.subtotal, 2), 0) END;
    v_vat_amount := CASE WHEN v_restaurant.tax_prices_vat_inclusive
      THEN greatest(round(v_order.subtotal - v_vatable_sales, 2), 0)
      ELSE round(v_vatable_sales * v_restaurant.tax_vat_rate / 100, 2) END;
    v_vat_exempt_sales := 0;
    v_zero_rated_sales := 0;
    v_net_sales := v_vatable_sales;
    v_total := CASE WHEN v_restaurant.tax_prices_vat_inclusive
      THEN round(v_order.subtotal + v_order.delivery_fee, 2)
      ELSE round(v_order.subtotal + v_vat_amount + v_order.delivery_fee, 2) END;
  END IF;

  UPDATE public.orders
     SET tax_vat_registered = v_restaurant.tax_vat_registered,
         tax_prices_vat_inclusive = v_restaurant.tax_prices_vat_inclusive,
         tax_vat_rate = CASE WHEN v_restaurant.tax_vat_registered THEN v_restaurant.tax_vat_rate ELSE 0 END,
         tax_gross_sales = round(v_order.subtotal, 2),
         tax_vatable_sales = v_vatable_sales,
         tax_vat_amount = v_vat_amount,
         tax_vat_exempt_sales = v_vat_exempt_sales,
         tax_net_sales = v_net_sales,
         tax_zero_rated_sales = CASE
           WHEN v_count = 0 AND v_restaurant.tax_vat_registered
             AND v_restaurant.tax_prices_vat_inclusive
             AND v_classified_count = v_item_count THEN v_zero_rated_sales
           ELSE NULL
         END,
         tax_snapshot_status = 'requires_review',
         tax_snapshot_version = NULL,
         discount_type = CASE WHEN v_count = 1 THEN lower(trim(p_beneficiaries->0->>'discount_type')) ELSE NULL END,
         discount_id_number = CASE WHEN v_count = 1 THEN trim(p_beneficiaries->0->>'discount_id_number') ELSE NULL END,
         discount_amount = v_total_discount,
         discount_group_size = p_group_size,
         discount_beneficiary_count = v_count,
         total = v_total,
         updated_at = now()
   WHERE id = p_order_id;

  RETURN QUERY SELECT
    p_order_id, p_group_size, v_count, v_total_discount,
    round(v_order.subtotal, 2), v_vatable_sales, v_vat_amount,
    v_vat_exempt_sales, v_net_sales, v_total;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_pos_group_discounts(uuid, integer, jsonb) TO authenticated;

COMMENT ON FUNCTION public.apply_pos_group_discounts(uuid, integer, jsonb) IS
  'Applies SC/PWD discount only from cashier-supplied line-level eligible amounts, records per-beneficiary line allocations, caps combined allocation to each line total, and leaves statutory-discount tax snapshots requires_review pending approved allocation rules.';
