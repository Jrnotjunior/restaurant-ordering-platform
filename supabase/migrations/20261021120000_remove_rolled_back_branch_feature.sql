-- Remove the rolled-back multi-branch feature while preserving business records.
-- Orders, delivery quotes, pending payments, restaurant settings, and payment history remain.
-- Only obsolete branch metadata and branch-only objects are removed.

BEGIN;

-- Remove branch hooks from active business tables before dropping branch metadata.
DROP TRIGGER IF EXISTS orders_assign_default_branch ON public.orders;
DROP TRIGGER IF EXISTS delivery_quotes_assign_default_branch ON public.delivery_quotes;
DROP TRIGGER IF EXISTS pending_online_payments_assign_default_branch ON public.pending_online_payments;
DROP TRIGGER IF EXISTS restaurants_create_initial_branch ON public.restaurants;
DROP TRIGGER IF EXISTS restaurants_sync_default_branch_settings ON public.restaurants;
DROP TRIGGER IF EXISTS restaurants_validate_custom_domain_against_branches ON public.restaurants;

DO $$
BEGIN
  IF to_regclass('public.restaurant_branches') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS restaurant_branches_sync_default_settings ON public.restaurant_branches';
    EXECUTE 'DROP TRIGGER IF EXISTS restaurant_branches_validate_custom_domain ON public.restaurant_branches';
  END IF;
END;
$$;

-- Preserve restaurant custom-domain normalization and hostname validation without branch lookups.
CREATE OR REPLACE FUNCTION public.normalize_restaurant_custom_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  NEW.custom_domain := NULLIF(
    lower(regexp_replace(btrim(coalesce(NEW.custom_domain, '')), '[.]$', '')),
    ''
  );

  IF NEW.custom_domain IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.custom_domain !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
     OR NEW.custom_domain LIKE '%..%' THEN
    RAISE EXCEPTION 'Enter a hostname only, such as example.com. Do not include https:// or a path.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS restaurants_normalize_custom_domain ON public.restaurants;
CREATE TRIGGER restaurants_normalize_custom_domain
BEFORE INSERT OR UPDATE OF custom_domain ON public.restaurants
FOR EACH ROW EXECUTE FUNCTION public.normalize_restaurant_custom_domain();

REVOKE ALL ON FUNCTION public.normalize_restaurant_custom_domain() FROM PUBLIC, anon, authenticated;

-- Remove branch-aware RPC overloads. The non-branch checkout RPCs remain in place.
DROP FUNCTION IF EXISTS public.create_order_with_guest_cancel_token(
  uuid, text, text, text, text, text, text, text, text, boolean, jsonb,
  text, text, text, double precision, double precision, text, text, uuid
);
DROP FUNCTION IF EXISTS public.create_order_from_delivery_quote_with_guest_cancel_token(
  uuid, text, text, text, text, text, text, text, jsonb,
  text, text, text, double precision, double precision, text, uuid, text, uuid
);
DROP FUNCTION IF EXISTS public.create_pending_online_payment_with_guest_cancel_token(
  uuid, text, text, text, text, text, text, text, boolean, jsonb, boolean,
  text, text, text, double precision, double precision, text, text, uuid
);
DROP FUNCTION IF EXISTS public.create_pending_online_payment_from_delivery_quote_with_guest_ca(
  uuid, text, text, text, text, text, text, jsonb, boolean,
  text, text, text, double precision, double precision, text, uuid, text, uuid
);

DROP FUNCTION IF EXISTS public.assert_restaurant_branch_orderable(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_effective_restaurant_branch_id(uuid);
DROP FUNCTION IF EXISTS public.get_restaurant_orders_with_branch(uuid, uuid);
DROP FUNCTION IF EXISTS public.resolve_restaurant_branch_by_domain(text);
DROP FUNCTION IF EXISTS public.set_default_restaurant_branch(uuid, uuid);
DROP FUNCTION IF EXISTS public.set_restaurant_branch_product_settings(uuid, uuid, uuid, boolean, numeric);
DROP FUNCTION IF EXISTS public.assign_default_branch_before_insert();
DROP FUNCTION IF EXISTS public.create_initial_restaurant_branch();
DROP FUNCTION IF EXISTS public.sync_default_branch_from_restaurant_settings();
DROP FUNCTION IF EXISTS public.sync_default_branch_to_restaurant_settings();
DROP FUNCTION IF EXISTS public.validate_restaurant_branch_custom_domain();
DROP FUNCTION IF EXISTS public.validate_restaurant_custom_domain_against_branches();

-- The payment finalizer must no longer read/write branch_id. Its service-role-only ACL
-- and existing payment/loyalty behavior are preserved by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.finalize_online_payment(
  p_reference_number text,
  p_paymongo_payment_id text DEFAULT NULL::text,
  p_paymongo_checkout_session_id text DEFAULT NULL::text,
  p_paymongo_payment_method text DEFAULT NULL::text,
  p_paymongo_fee numeric DEFAULT NULL::numeric,
  p_paymongo_net_amount numeric DEFAULT NULL::numeric
)
RETURNS TABLE(order_id uuid, order_number text, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_payment public.pending_online_payments%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_account public.customer_loyalty_accounts%rowtype;
BEGIN
  SELECT * INTO v_payment
  FROM public.pending_online_payments
  WHERE reference_number = trim(p_reference_number)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending online payment not found';
  END IF;

  IF v_payment.status = 'paid' AND v_payment.order_id IS NOT NULL THEN
    UPDATE public.orders
    SET paymongo_payment_id = coalesce(paymongo_payment_id, nullif(trim(p_paymongo_payment_id), '')),
        paymongo_checkout_session_id = coalesce(paymongo_checkout_session_id, nullif(trim(p_paymongo_checkout_session_id), '')),
        paymongo_payment_method = coalesce(paymongo_payment_method, nullif(trim(p_paymongo_payment_method), '')),
        paymongo_fee = coalesce(paymongo_fee, p_paymongo_fee),
        paymongo_net_amount = coalesce(paymongo_net_amount, p_paymongo_net_amount),
        updated_at = now()
    WHERE id = v_payment.order_id;

    SELECT o.id, o.order_number, o.total
      INTO v_order_id, v_order_number, total
    FROM public.orders o
    WHERE o.id = v_payment.order_id;

    RETURN QUERY SELECT v_order_id, v_order_number, total;
    RETURN;
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Online payment is not pending';
  END IF;

  IF v_payment.loyalty_points_redeemed > 0 THEN
    SELECT * INTO v_account
    FROM public.customer_loyalty_accounts
    WHERE customer_id = v_payment.customer_id
    FOR UPDATE;

    IF NOT FOUND OR v_account.points_balance < v_payment.loyalty_points_redeemed THEN
      RAISE EXCEPTION 'Customer does not have enough loyalty points';
    END IF;
  END IF;

  v_order_number := public.next_restaurant_order_number(v_payment.restaurant_id);

  INSERT INTO public.orders (
    restaurant_id, order_number, customer_name, mobile_number, order_type,
    delivery_address, notes, payment_method, payment_status, status,
    subtotal, delivery_fee, discount_amount, total, customer_id,
    paymongo_payment_id, paymongo_checkout_session_id,
    paymongo_payment_method, paymongo_fee, paymongo_net_amount
  ) VALUES (
    v_payment.restaurant_id, v_order_number, v_payment.customer_name,
    v_payment.mobile_number, v_payment.order_type, v_payment.delivery_address,
    v_payment.notes, 'gcash', 'paid', 'pending',
    v_payment.subtotal, v_payment.delivery_fee, v_payment.loyalty_discount_amount,
    v_payment.total, v_payment.customer_id,
    nullif(trim(p_paymongo_payment_id), ''),
    nullif(trim(p_paymongo_checkout_session_id), ''),
    nullif(trim(p_paymongo_payment_method), ''),
    p_paymongo_fee,
    p_paymongo_net_amount
  )
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_payment.items)
  LOOP
    INSERT INTO public.order_items (
      order_id, product_id, product_name, unit_price, quantity, line_total
    ) VALUES (
      v_order_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::integer,
      (v_item->>'line_total')::numeric
    );
  END LOOP;

  IF v_payment.loyalty_points_redeemed > 0 THEN
    UPDATE public.customer_loyalty_accounts
    SET points_balance = points_balance - v_payment.loyalty_points_redeemed,
        updated_at = now()
    WHERE customer_id = v_payment.customer_id;

    INSERT INTO public.loyalty_transactions (
      restaurant_id, customer_id, order_id, transaction_type, points,
      eligible_amount, rule_amount_threshold, rule_points_awarded, description
    ) VALUES (
      v_payment.restaurant_id, v_payment.customer_id, v_order_id, 'redeem',
      -v_payment.loyalty_points_redeemed, v_payment.loyalty_discount_amount,
      v_payment.loyalty_points_redeemed,
      v_payment.loyalty_discount_amount::integer,
      'Redeemed loyalty reward on order ' || v_order_number
    );
  END IF;

  UPDATE public.pending_online_payments
  SET status = 'paid', order_id = v_order_id, updated_at = now()
  WHERE id = v_payment.id;

  RETURN QUERY SELECT v_order_id, v_order_number, v_payment.total;
END;
$function$;

-- Retain the existing restricted payment-finalization boundary.
REVOKE EXECUTE ON FUNCTION public.finalize_online_payment(text, text, text, text, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_online_payment(text, text, text, text, numeric, numeric)
  TO service_role;

-- Remove branch metadata only. No rows are deleted from orders, quotes, or payment records.
ALTER TABLE public.orders DROP COLUMN IF EXISTS branch_id;
ALTER TABLE public.delivery_quotes DROP COLUMN IF EXISTS branch_id;
ALTER TABLE public.pending_online_payments DROP COLUMN IF EXISTS branch_id;

DROP TABLE IF EXISTS public.restaurant_branch_product_settings;
DROP TABLE IF EXISTS public.restaurant_branch_website_customizations;
DROP TABLE IF EXISTS public.restaurant_branches;

COMMIT;
