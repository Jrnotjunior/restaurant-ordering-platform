-- Multi-branch support for a single restaurant business.
-- Existing restaurant IDs remain the tenant boundary. Every current restaurant
-- receives a default branch, so existing orders and payment flows remain valid.

BEGIN;

CREATE TABLE IF NOT EXISTS public.restaurant_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  branch_code text NOT NULL CHECK (branch_code = upper(btrim(branch_code)) AND branch_code ~ '^[A-Z0-9_-]{2,20}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  store_address text,
  restaurant_address text,
  contact_number text,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false CHECK (NOT is_default OR is_active),
  ordering_enabled boolean NOT NULL DEFAULT true,
  operating_hours jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(operating_hours) = 'object'),
  delivery_location_latitude double precision CHECK (delivery_location_latitude IS NULL OR delivery_location_latitude BETWEEN -90 AND 90),
  delivery_location_longitude double precision CHECK (delivery_location_longitude IS NULL OR delivery_location_longitude BETWEEN -180 AND 180),
  delivery_base_fee numeric NOT NULL DEFAULT 0 CHECK (delivery_base_fee >= 0),
  delivery_distance_increment_meters integer NOT NULL DEFAULT 500 CHECK (delivery_distance_increment_meters > 0),
  delivery_fee_per_increment numeric NOT NULL DEFAULT 10 CHECK (delivery_fee_per_increment >= 0),
  delivery_max_distance_meters integer NOT NULL DEFAULT 10000 CHECK (delivery_max_distance_meters > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, branch_code),
  UNIQUE (id, restaurant_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_branches_one_default_per_restaurant
  ON public.restaurant_branches(restaurant_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS restaurant_branches_active_by_business
  ON public.restaurant_branches(restaurant_id, is_active, name);

-- Backfill each existing restaurant with one branch using the current restaurant
-- settings as the source of truth. This does not create new tenant identities.
INSERT INTO public.restaurant_branches (
  restaurant_id, branch_code, name, store_address, restaurant_address, contact_number,
  is_active, is_default, ordering_enabled, operating_hours,
  delivery_location_latitude, delivery_location_longitude, delivery_base_fee,
  delivery_distance_increment_meters, delivery_fee_per_increment, delivery_max_distance_meters
)
SELECT
  r.id,
  'MAIN',
  coalesce(nullif(btrim(r.name), ''), 'Restaurant') || ' - Main Branch',
  nullif(btrim(coalesce(r.store_address, '')), ''),
  nullif(btrim(coalesce(r.restaurant_address, '')), ''),
  r.contact_number,
  true,
  true,
  coalesce(r.ordering_enabled, true),
  coalesce(r.operating_hours, '{}'::jsonb),
  r.delivery_location_latitude,
  r.delivery_location_longitude,
  coalesce(r.delivery_base_fee, 0),
  coalesce(r.delivery_distance_increment_meters, 500),
  coalesce(r.delivery_fee_per_increment, 10),
  coalesce(r.delivery_max_distance_meters, 10000)
FROM public.restaurants r
WHERE NOT EXISTS (
  SELECT 1 FROM public.restaurant_branches b WHERE b.restaurant_id = r.id
);

-- New restaurant records automatically get their first/default branch. Branches
-- created by an owner later remain separate records under the same restaurant.
CREATE OR REPLACE FUNCTION public.create_initial_restaurant_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.restaurant_branches (
    restaurant_id, branch_code, name, store_address, restaurant_address, contact_number,
    is_active, is_default, ordering_enabled, operating_hours,
    delivery_location_latitude, delivery_location_longitude, delivery_base_fee,
    delivery_distance_increment_meters, delivery_fee_per_increment, delivery_max_distance_meters
  ) VALUES (
    NEW.id, 'MAIN',
    coalesce(nullif(btrim(NEW.name), ''), 'Restaurant') || ' - Main Branch',
    nullif(btrim(coalesce(NEW.store_address, '')), ''),
    nullif(btrim(coalesce(NEW.restaurant_address, '')), ''),
    NEW.contact_number,
    true, true, coalesce(NEW.ordering_enabled, true), coalesce(NEW.operating_hours, '{}'::jsonb),
    NEW.delivery_location_latitude, NEW.delivery_location_longitude,
    coalesce(NEW.delivery_base_fee, 0), coalesce(NEW.delivery_distance_increment_meters, 500),
    coalesce(NEW.delivery_fee_per_increment, 10), coalesce(NEW.delivery_max_distance_meters, 10000)
  )
  ON CONFLICT (restaurant_id, branch_code) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS restaurants_create_initial_branch ON public.restaurants;
CREATE TRIGGER restaurants_create_initial_branch
AFTER INSERT ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.create_initial_restaurant_branch();

-- Additive branch references. Existing operational rows are assigned to the
-- default branch before NOT NULL constraints are enforced.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS branch_id uuid;
ALTER TABLE public.pending_online_payments ADD COLUMN IF NOT EXISTS branch_id uuid;
ALTER TABLE public.delivery_quotes ADD COLUMN IF NOT EXISTS branch_id uuid;

UPDATE public.orders o
SET branch_id = b.id
FROM public.restaurant_branches b
WHERE o.branch_id IS NULL AND b.restaurant_id = o.restaurant_id AND b.is_default;

UPDATE public.pending_online_payments p
SET branch_id = b.id
FROM public.restaurant_branches b
WHERE p.branch_id IS NULL AND b.restaurant_id = p.restaurant_id AND b.is_default;

UPDATE public.delivery_quotes q
SET branch_id = b.id
FROM public.restaurant_branches b
WHERE q.branch_id IS NULL AND b.restaurant_id = q.restaurant_id AND b.is_default;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_branch_id_fkey' AND conrelid = 'public.orders'::regclass) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_branch_id_fkey
      FOREIGN KEY (branch_id, restaurant_id) REFERENCES public.restaurant_branches(id, restaurant_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_online_payments_branch_id_fkey' AND conrelid = 'public.pending_online_payments'::regclass) THEN
    ALTER TABLE public.pending_online_payments ADD CONSTRAINT pending_online_payments_branch_id_fkey
      FOREIGN KEY (branch_id, restaurant_id) REFERENCES public.restaurant_branches(id, restaurant_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_quotes_branch_id_fkey' AND conrelid = 'public.delivery_quotes'::regclass) THEN
    ALTER TABLE public.delivery_quotes ADD CONSTRAINT delivery_quotes_branch_id_fkey
      FOREIGN KEY (branch_id, restaurant_id) REFERENCES public.restaurant_branches(id, restaurant_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
  END IF;
END;
$constraints$;

ALTER TABLE public.orders ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.pending_online_payments ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE public.delivery_quotes ALTER COLUMN branch_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS orders_restaurant_branch_created_at_idx
  ON public.orders(restaurant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pending_online_payments_restaurant_branch_idx
  ON public.pending_online_payments(restaurant_id, branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delivery_quotes_restaurant_branch_created_at_idx
  ON public.delivery_quotes(restaurant_id, branch_id, created_at DESC);

-- Preserve compatibility with existing POS and any older client that does not
-- supply branch_id: it is assigned to the business's default branch. Explicit
-- branch IDs must still belong to the same business.
CREATE OR REPLACE FUNCTION public.assign_default_branch_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch_id uuid;
BEGIN
  IF NEW.branch_id IS NULL THEN
    SELECT b.id INTO v_branch_id
    FROM public.restaurant_branches b
    WHERE b.restaurant_id = NEW.restaurant_id AND b.is_default AND b.is_active
    LIMIT 1;
    IF v_branch_id IS NULL THEN
      RAISE EXCEPTION 'The restaurant has no active default branch configured';
    END IF;
    NEW.branch_id := v_branch_id;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.restaurant_branches b
    WHERE b.id = NEW.branch_id AND b.restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'Selected branch does not belong to this restaurant';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS orders_assign_default_branch ON public.orders;
CREATE TRIGGER orders_assign_default_branch
BEFORE INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.assign_default_branch_before_insert();

DROP TRIGGER IF EXISTS pending_online_payments_assign_default_branch ON public.pending_online_payments;
CREATE TRIGGER pending_online_payments_assign_default_branch
BEFORE INSERT ON public.pending_online_payments
FOR EACH ROW EXECUTE FUNCTION public.assign_default_branch_before_insert();

DROP TRIGGER IF EXISTS delivery_quotes_assign_default_branch ON public.delivery_quotes;
CREATE TRIGGER delivery_quotes_assign_default_branch
BEFORE INSERT ON public.delivery_quotes
FOR EACH ROW EXECUTE FUNCTION public.assign_default_branch_before_insert();

ALTER TABLE public.restaurant_branches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS restaurant_branches_public_active_read ON public.restaurant_branches;
CREATE POLICY restaurant_branches_public_active_read ON public.restaurant_branches
  FOR SELECT TO anon, authenticated
  USING (
    is_active = true AND EXISTS (
      SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.is_active = true
    )
  );

DROP POLICY IF EXISTS restaurant_branches_owner_manage ON public.restaurant_branches;
CREATE POLICY restaurant_branches_owner_manage ON public.restaurant_branches
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = restaurant_id AND r.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = restaurant_id AND r.owner_id = auth.uid()
  ));

REVOKE ALL ON public.restaurant_branches FROM anon, authenticated;
GRANT SELECT ON public.restaurant_branches TO anon, authenticated;
GRANT INSERT (
  restaurant_id, branch_code, name, store_address, restaurant_address, contact_number,
  is_active, ordering_enabled, operating_hours, delivery_location_latitude,
  delivery_location_longitude, delivery_base_fee, delivery_distance_increment_meters,
  delivery_fee_per_increment, delivery_max_distance_meters
) ON public.restaurant_branches TO authenticated;
GRANT UPDATE (
  branch_code, name, store_address, restaurant_address, contact_number,
  is_active, ordering_enabled, operating_hours, delivery_location_latitude,
  delivery_location_longitude, delivery_base_fee, delivery_distance_increment_meters,
  delivery_fee_per_increment, delivery_max_distance_meters, updated_at
) ON public.restaurant_branches TO authenticated;

-- The default branch can change only through this owner-authorized transaction.
CREATE OR REPLACE FUNCTION public.set_default_restaurant_branch(p_restaurant_id uuid, p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.restaurants r WHERE r.id = p_restaurant_id AND r.owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You do not have access to this restaurant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.restaurant_branches b
    WHERE b.id = p_branch_id AND b.restaurant_id = p_restaurant_id AND b.is_active
  ) THEN
    RAISE EXCEPTION 'Choose an active branch belonging to this restaurant';
  END IF;

  UPDATE public.restaurant_branches
  SET is_default = false, updated_at = now()
  WHERE restaurant_id = p_restaurant_id AND is_default AND id <> p_branch_id;

  UPDATE public.restaurant_branches
  SET is_default = true, updated_at = now()
  WHERE restaurant_id = p_restaurant_id AND id = p_branch_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_default_restaurant_branch(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_default_restaurant_branch(uuid, uuid) TO authenticated;

-- Server-side guard used by branch-aware checkout RPCs. It validates business
-- membership, branch activity, ordering toggle, and branch hours in Asia/Manila.
CREATE OR REPLACE FUNCTION public.assert_restaurant_branch_orderable(p_restaurant_id uuid, p_branch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_branch public.restaurant_branches%rowtype;
  v_local_now timestamp without time zone;
  v_day text;
  v_hours jsonb;
  v_open time;
  v_close time;
  v_time time;
BEGIN
  SELECT b.* INTO v_branch
  FROM public.restaurant_branches b
  JOIN public.restaurants r ON r.id = b.restaurant_id
  WHERE b.id = p_branch_id
    AND b.restaurant_id = p_restaurant_id
    AND r.is_active = true
    AND coalesce(r.ordering_enabled, true) = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Restaurant is not accepting orders';
  END IF;
  IF NOT v_branch.is_active THEN
    RAISE EXCEPTION 'Selected restaurant branch is not available';
  END IF;
  IF NOT v_branch.ordering_enabled THEN
    RAISE EXCEPTION 'This branch has paused online ordering';
  END IF;

  v_local_now := timezone('Asia/Manila', now());
  v_day := lower(trim(to_char(v_local_now, 'FMDay')));
  v_time := v_local_now::time;
  v_hours := v_branch.operating_hours -> v_day;

  IF v_hours IS NOT NULL THEN
    IF coalesce((v_hours->>'isOpen')::boolean, true) = false THEN
      RAISE EXCEPTION 'This branch is closed today';
    END IF;
    v_open := nullif(v_hours->>'open', '')::time;
    v_close := nullif(v_hours->>'close', '')::time;
    IF v_open IS NOT NULL AND v_close IS NOT NULL THEN
      IF (v_open <= v_close AND (v_time < v_open OR v_time >= v_close))
        OR (v_open > v_close AND v_time >= v_close AND v_time < v_open) THEN
        RAISE EXCEPTION 'This branch is outside its operating hours';
      END IF;
    END IF;
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.assert_restaurant_branch_orderable(uuid, uuid) FROM PUBLIC;

-- Branch-aware overload for standard public/cash orders. The legacy overload is
-- deliberately called and then scoped in the same transaction, preserving its
-- existing item, cancellation-token, tax, and order validations.
CREATE OR REPLACE FUNCTION public.create_order_with_guest_cancel_token(
  p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_order_type text,
  p_delivery_city text, p_delivery_barangay text, p_delivery_address text, p_notes text,
  p_payment_method text, p_is_third_party_courier boolean, p_items jsonb,
  p_customer_delivery_address text, p_customer_delivery_city text, p_customer_delivery_barangay text,
  p_customer_delivery_latitude double precision, p_customer_delivery_longitude double precision,
  p_customer_delivery_place_id text, p_guest_cancel_token_hash text, p_branch_id uuid
)
RETURNS TABLE(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_created record; v_branch public.restaurant_branches%rowtype;
BEGIN
  PERFORM public.assert_restaurant_branch_orderable(p_restaurant_id, p_branch_id);
  SELECT * INTO v_branch FROM public.restaurant_branches
  WHERE id = p_branch_id AND restaurant_id = p_restaurant_id;
  SELECT * INTO v_created FROM public.create_order_with_guest_cancel_token(
    p_restaurant_id, p_customer_name, p_mobile_number, p_order_type,
    p_delivery_city, p_delivery_barangay, p_delivery_address, p_notes,
    p_payment_method, p_is_third_party_courier, p_items, p_customer_delivery_address,
    p_customer_delivery_city, p_customer_delivery_barangay, p_customer_delivery_latitude,
    p_customer_delivery_longitude, p_customer_delivery_place_id, p_guest_cancel_token_hash
  );
  UPDATE public.orders o
  SET branch_id = p_branch_id,
      delivery_address = CASE WHEN p_order_type = 'pickup'
        THEN coalesce(nullif(btrim(v_branch.store_address), ''), nullif(btrim(v_branch.restaurant_address), ''), o.delivery_address)
        ELSE o.delivery_address END,
      updated_at = now()
  WHERE o.id = v_created.order_id AND o.restaurant_id = p_restaurant_id;
  RETURN QUERY SELECT v_created.order_id, v_created.order_number, v_created.subtotal, v_created.delivery_fee, v_created.total;
END;
$function$;

-- Branch-aware delivery orders must use a delivery quote created for that exact
-- branch. A quote from one branch cannot be replayed for another branch.
CREATE OR REPLACE FUNCTION public.create_order_from_delivery_quote_with_guest_cancel_token(
  p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_delivery_city text,
  p_delivery_barangay text, p_delivery_address text, p_notes text, p_payment_method text,
  p_items jsonb, p_customer_delivery_address text, p_customer_delivery_city text,
  p_customer_delivery_barangay text, p_customer_delivery_latitude double precision,
  p_customer_delivery_longitude double precision, p_customer_delivery_place_id text,
  p_delivery_quote_id uuid, p_guest_cancel_token_hash text, p_branch_id uuid
)
RETURNS TABLE(order_id uuid, order_number text, subtotal numeric, delivery_fee numeric, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_created record;
BEGIN
  PERFORM public.assert_restaurant_branch_orderable(p_restaurant_id, p_branch_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_quotes q
    WHERE q.id = p_delivery_quote_id AND q.restaurant_id = p_restaurant_id
      AND q.branch_id = p_branch_id AND q.consumed_at IS NULL AND q.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Delivery quote does not belong to the selected branch or has expired';
  END IF;
  SELECT * INTO v_created FROM public.create_order_from_delivery_quote_with_guest_cancel_token(
    p_restaurant_id, p_customer_name, p_mobile_number, p_delivery_city,
    p_delivery_barangay, p_delivery_address, p_notes, p_payment_method, p_items,
    p_customer_delivery_address, p_customer_delivery_city, p_customer_delivery_barangay,
    p_customer_delivery_latitude, p_customer_delivery_longitude, p_customer_delivery_place_id,
    p_delivery_quote_id, p_guest_cancel_token_hash
  );
  UPDATE public.orders SET branch_id = p_branch_id, updated_at = now()
  WHERE id = v_created.order_id AND restaurant_id = p_restaurant_id;
  RETURN QUERY SELECT v_created.order_id, v_created.order_number, v_created.subtotal, v_created.delivery_fee, v_created.total;
END;
$function$;

-- Branch-aware pending online payment staging. Checkout continues to resolve the
-- PayMongo merchant from restaurant_id; branch_id scopes fulfillment and delivery.
CREATE OR REPLACE FUNCTION public.create_pending_online_payment_with_guest_cancel_token(
  p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_order_type text,
  p_delivery_city text, p_delivery_barangay text, p_delivery_address text, p_notes text,
  p_is_third_party_courier boolean, p_items jsonb, p_redeem_loyalty boolean,
  p_customer_delivery_address text, p_customer_delivery_city text, p_customer_delivery_barangay text,
  p_customer_delivery_latitude double precision, p_customer_delivery_longitude double precision,
  p_customer_delivery_place_id text, p_guest_cancel_token_hash text, p_branch_id uuid
)
RETURNS TABLE(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_created record; v_branch public.restaurant_branches%rowtype;
BEGIN
  PERFORM public.assert_restaurant_branch_orderable(p_restaurant_id, p_branch_id);
  SELECT * INTO v_branch FROM public.restaurant_branches WHERE id = p_branch_id AND restaurant_id = p_restaurant_id;
  SELECT * INTO v_created FROM public.create_pending_online_payment_with_guest_cancel_token(
    p_restaurant_id, p_customer_name, p_mobile_number, p_order_type,
    p_delivery_city, p_delivery_barangay, p_delivery_address, p_notes,
    p_is_third_party_courier, p_items, p_redeem_loyalty, p_customer_delivery_address,
    p_customer_delivery_city, p_customer_delivery_barangay, p_customer_delivery_latitude,
    p_customer_delivery_longitude, p_customer_delivery_place_id, p_guest_cancel_token_hash
  );
  UPDATE public.pending_online_payments p
  SET branch_id = p_branch_id,
      delivery_address = CASE WHEN p_order_type = 'pickup'
        THEN coalesce(nullif(btrim(v_branch.store_address), ''), nullif(btrim(v_branch.restaurant_address), ''), p.delivery_address)
        ELSE p.delivery_address END,
      updated_at = now()
  WHERE p.id = v_created.payment_id AND p.restaurant_id = p_restaurant_id;
  RETURN QUERY SELECT v_created.payment_id, v_created.reference_number, v_created.subtotal, v_created.delivery_fee, v_created.total;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_pending_online_payment_from_delivery_quote_with_guest_cancel_token(
  p_restaurant_id uuid, p_customer_name text, p_mobile_number text, p_delivery_city text,
  p_delivery_barangay text, p_delivery_address text, p_notes text, p_items jsonb,
  p_redeem_loyalty boolean, p_customer_delivery_address text, p_customer_delivery_city text,
  p_customer_delivery_barangay text, p_customer_delivery_latitude double precision,
  p_customer_delivery_longitude double precision, p_customer_delivery_place_id text,
  p_delivery_quote_id uuid, p_guest_cancel_token_hash text, p_branch_id uuid
)
RETURNS TABLE(payment_id uuid, reference_number text, subtotal numeric, delivery_fee numeric, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_created record;
BEGIN
  PERFORM public.assert_restaurant_branch_orderable(p_restaurant_id, p_branch_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.delivery_quotes q
    WHERE q.id = p_delivery_quote_id AND q.restaurant_id = p_restaurant_id
      AND q.branch_id = p_branch_id AND q.consumed_at IS NULL AND q.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'Delivery quote does not belong to the selected branch or has expired';
  END IF;
  SELECT * INTO v_created FROM public.create_pending_online_payment_from_delivery_quote_with_guest_cancel_token(
    p_restaurant_id, p_customer_name, p_mobile_number, p_delivery_city,
    p_delivery_barangay, p_delivery_address, p_notes, p_items, p_redeem_loyalty,
    p_customer_delivery_address, p_customer_delivery_city, p_customer_delivery_barangay,
    p_customer_delivery_latitude, p_customer_delivery_longitude, p_customer_delivery_place_id,
    p_delivery_quote_id, p_guest_cancel_token_hash
  );
  UPDATE public.pending_online_payments SET branch_id = p_branch_id, updated_at = now()
  WHERE id = v_created.payment_id AND restaurant_id = p_restaurant_id;
  RETURN QUERY SELECT v_created.payment_id, v_created.reference_number, v_created.subtotal, v_created.delivery_fee, v_created.total;
END;
$function$;

-- These overloads are public checkout RPCs by design; all enforce branch
-- membership and server-side availability before invoking existing order logic.
REVOKE ALL ON FUNCTION public.create_order_with_guest_cancel_token(uuid,text,text,text,text,text,text,text,text,boolean,jsonb,text,text,text,double precision,double precision,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_with_guest_cancel_token(uuid,text,text,text,text,text,text,text,text,boolean,jsonb,text,text,text,double precision,double precision,text,text,uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.create_order_from_delivery_quote_with_guest_cancel_token(uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order_from_delivery_quote_with_guest_cancel_token(uuid,text,text,text,text,text,text,text,jsonb,text,text,text,double precision,double precision,text,uuid,text,uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.create_pending_online_payment_with_guest_cancel_token(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean,text,text,text,double precision,double precision,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_online_payment_with_guest_cancel_token(uuid,text,text,text,text,text,text,text,boolean,jsonb,boolean,text,text,text,double precision,double precision,text,text,uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.create_pending_online_payment_from_delivery_quote_with_guest_cancel_token(uuid,text,text,text,text,text,text,jsonb,boolean,text,text,text,double precision,double precision,text,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pending_online_payment_from_delivery_quote_with_guest_cancel_token(uuid,text,text,text,text,text,text,jsonb,boolean,text,text,text,double precision,double precision,text,uuid,text,uuid) TO anon, authenticated;

-- When PayMongo confirms a pending payment, copy the branch stored at checkout
-- into the resulting order. Patch the installed definition to preserve the
-- existing, fully-tested payment and loyalty logic.
DO $finalize_branch$
DECLARE
  v_definition text;
  v_replaced text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'finalize_online_payment'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_reference_number text, p_paymongo_payment_id text, p_paymongo_checkout_session_id text, p_paymongo_payment_method text, p_paymongo_fee numeric, p_paymongo_net_amount numeric';

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Expected finalize_online_payment function was not found';
  END IF;

  v_replaced := replace(v_definition,
    'restaurant_id, order_number, customer_name, mobile_number, order_type,',
    'restaurant_id, branch_id, order_number, customer_name, mobile_number, order_type,');
  v_replaced := replace(v_replaced,
    'v_payment.restaurant_id, v_order_number, v_payment.customer_name,',
    'v_payment.restaurant_id, v_payment.branch_id, v_order_number, v_payment.customer_name,');

  IF v_replaced = v_definition OR position('v_payment.branch_id' in v_replaced) = 0 THEN
    RAISE EXCEPTION 'Unable to safely patch finalize_online_payment for branch propagation';
  END IF;
  EXECUTE v_replaced;
END;
$finalize_branch$;

COMMIT;
