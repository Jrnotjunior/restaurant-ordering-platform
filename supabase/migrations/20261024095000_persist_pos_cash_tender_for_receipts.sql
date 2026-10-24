-- Store POS cash received and change on the order so the first receipt and any authorized reprint share one persisted snapshot.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cash_received_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS cash_change_amount numeric(12,2);

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_cash_tender_nonnegative_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_cash_tender_nonnegative_check
  CHECK (
    (cash_received_amount IS NULL AND cash_change_amount IS NULL)
    OR (
      cash_received_amount IS NOT NULL AND cash_received_amount >= 0
      AND cash_change_amount IS NOT NULL AND cash_change_amount >= 0
    )
  );

COMMENT ON COLUMN public.orders.cash_received_amount IS
  'Cash physically received for a POS cash payment, captured at cashier confirmation. NULL when the transaction did not capture a cash tender amount.';
COMMENT ON COLUMN public.orders.cash_change_amount IS
  'Change returned for a POS cash payment (cash_received_amount minus the persisted order total), captured server-side. NULL when the transaction did not capture a cash tender amount.';

CREATE OR REPLACE FUNCTION public.confirm_pos_cash_payment_with_tender(
  p_order_id uuid,
  p_cash_received_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_change numeric(12,2);
BEGIN
  SELECT o.*
    INTO v_order
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE o.id = p_order_id
    AND r.is_active = true
    AND (
      r.owner_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.restaurant_staff s
        WHERE s.restaurant_id = o.restaurant_id
          AND s.auth_user_id = auth.uid()
          AND s.role = 'cashier'
          AND s.is_active = true
      )
    )
  FOR UPDATE OF o;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or you are not authorized to confirm POS cash payment.' USING errcode = '42501';
  END IF;

  IF v_order.order_type NOT IN ('dine_in','take_out','pickup','delivery')
     OR v_order.payment_method <> 'cash'
     OR v_order.payment_status <> 'pending'
     OR v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'Only unpaid pending POS cash orders can be confirmed.';
  END IF;

  IF p_cash_received_amount IS NULL
     OR p_cash_received_amount < 0
     OR p_cash_received_amount = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Cash received must be a valid non-negative amount.';
  END IF;

  IF round(p_cash_received_amount, 2) < round(v_order.total, 2) THEN
    RAISE EXCEPTION 'Cash received must cover the persisted order total.';
  END IF;

  v_change := round(round(p_cash_received_amount, 2) - round(v_order.total, 2), 2);

  UPDATE public.orders
     SET payment_status = 'paid',
         status = 'preparing',
         cash_received_amount = round(p_cash_received_amount, 2),
         cash_change_amount = v_change,
         updated_at = now()
   WHERE id = p_order_id
     AND restaurant_id = v_order.restaurant_id;

  BEGIN
    PERFORM public.calculate_supported_online_order_tax_snapshot(p_order_id);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.orders
       SET tax_snapshot_status = 'requires_review',
           tax_snapshot_version = NULL,
           updated_at = now()
     WHERE id = p_order_id
       AND restaurant_id = v_order.restaurant_id
       AND tax_snapshot_status <> 'calculated';
  END;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'payment_status', 'paid',
    'order_status', 'preparing',
    'cash_received_amount', round(p_cash_received_amount, 2),
    'cash_change_amount', v_change
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_pos_cash_payment_with_tender(uuid,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_pos_cash_payment_with_tender(uuid,numeric) TO authenticated;

DROP FUNCTION public.get_restaurant_orders(uuid);
CREATE FUNCTION public.get_restaurant_orders(p_restaurant_id uuid)
 RETURNS TABLE(order_id uuid, order_number text, customer_name text, notes text, order_type text, payment_method text, payment_status text, pickup_method text, status text, total numeric, subtotal numeric, shipping_fee numeric, tax_vat_registered boolean, tax_prices_vat_inclusive boolean, tax_vat_rate numeric, tax_gross_sales numeric, tax_vatable_sales numeric, tax_vat_amount numeric, tax_vat_exempt_sales numeric, tax_net_sales numeric, tax_zero_rated_sales numeric, tax_snapshot_status text, tax_snapshot_version smallint, tax_percentage_taxable_sales numeric, tax_non_vat_exempt_sales numeric, items_tax_classified boolean, discount_beneficiaries_complete boolean, discount_amount numeric, loyalty_discount_amount numeric, discount_beneficiary_count integer, discount_group_size integer, discount_beneficiaries jsonb, mobile_number text, delivery_address text, cashier_name text, cash_received_amount numeric, cash_change_amount numeric, created_at timestamp with time zone, items jsonb)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    o.id as order_id,
    o.order_number,
    o.customer_name,
    o.notes,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.pickup_method,
    o.status,
    o.total,
    o.subtotal,
    o.delivery_fee as shipping_fee,
    o.tax_vat_registered,
    o.tax_prices_vat_inclusive,
    o.tax_vat_rate,
    o.tax_gross_sales,
    o.tax_vatable_sales,
    o.tax_vat_amount,
    o.tax_vat_exempt_sales,
    o.tax_net_sales,
    o.tax_zero_rated_sales,
    o.tax_snapshot_status,
    o.tax_snapshot_version,
    o.tax_percentage_taxable_sales,
    o.tax_non_vat_exempt_sales,
    (
      exists (select 1 from public.order_items classified_item where classified_item.order_id = o.id)
      and not exists (
        select 1 from public.order_items unclassified_item
        where unclassified_item.order_id = o.id and unclassified_item.tax_category_snapshot is null
      )
    ) as items_tax_classified,
    (
      coalesce(o.discount_beneficiary_count, 0) = 0
      or (
        exists (select 1 from public.order_discount_beneficiaries b where b.order_id = o.id)
        and not exists (
          select 1 from public.order_discount_beneficiaries b
          where b.order_id = o.id
            and (
              nullif(trim(b.beneficiary_name), '') is null
              or nullif(trim(b.beneficiary_address), '') is null
            )
        )
      )
    ) as discount_beneficiaries_complete,
    o.discount_amount,
    coalesce((
      select sum(abs(lt.eligible_amount))
      from public.loyalty_transactions lt
      where lt.order_id = o.id
        and lt.transaction_type = 'redeem'
    ), 0) as loyalty_discount_amount,
    o.discount_beneficiary_count,
    o.discount_group_size,
    case
      when exists (
        select 1
        from public.restaurants owner_check
        where owner_check.id = o.restaurant_id
          and owner_check.owner_id = auth.uid()
      ) or exists (
        select 1
        from public.restaurant_staff cashier_check
        where cashier_check.restaurant_id = o.restaurant_id
          and cashier_check.auth_user_id = auth.uid()
          and cashier_check.role = 'cashier'
          and cashier_check.is_active = true
      ) then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'discountType', b.discount_type,
              'idType', b.discount_id_type,
              'idNumber', b.discount_id_number,
              'beneficiaryName', b.beneficiary_name,
              'beneficiaryTin', b.beneficiary_tin,
              'beneficiaryAddress', b.beneficiary_address,
              'eligibleAmount', b.eligible_amount,
              'eligibleGrossAmount', (
                select round(sum(a.eligible_gross_amount), 2)
                from public.order_discount_beneficiary_line_allocations a
                where a.beneficiary_id = b.id
              ),
              'groupSize', o.discount_group_size,
              'discountAmount', b.discount_amount
            )
            order by b.created_at, b.id
          )
          from public.order_discount_beneficiaries b
          where b.order_id = o.id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end as discount_beneficiaries,
    case
      when exists (
        select 1 from public.restaurants owner_check
        where owner_check.id = o.restaurant_id and owner_check.owner_id = auth.uid()
      ) or exists (
        select 1 from public.restaurant_staff cashier_check
        where cashier_check.restaurant_id = o.restaurant_id
          and cashier_check.auth_user_id = auth.uid()
          and cashier_check.role = 'cashier'
          and cashier_check.is_active = true
      ) then o.mobile_number
      else null
    end as mobile_number,
    case
      when o.order_type = 'delivery' and (
        exists (
          select 1 from public.restaurants owner_check
          where owner_check.id = o.restaurant_id and owner_check.owner_id = auth.uid()
        ) or exists (
          select 1 from public.restaurant_staff cashier_check
          where cashier_check.restaurant_id = o.restaurant_id
            and cashier_check.auth_user_id = auth.uid()
            and cashier_check.role = 'cashier'
            and cashier_check.is_active = true
        )
      ) then coalesce(nullif(trim(o.customer_delivery_address), ''), nullif(trim(o.delivery_address), ''))
      else null
    end as delivery_address,
    case
      when exists (
        select 1 from public.restaurants owner_check
        where owner_check.id = o.restaurant_id and owner_check.owner_id = auth.uid()
      ) or exists (
        select 1 from public.restaurant_staff cashier_check
        where cashier_check.restaurant_id = o.restaurant_id
          and cashier_check.auth_user_id = auth.uid()
          and cashier_check.role = 'cashier'
          and cashier_check.is_active = true
      ) then coalesce((
        select coalesce(nullif(trim(staff.preferred_name), ''), nullif(trim(staff.name), ''))
        from public.pos_sales_journal journal
        join public.restaurant_staff staff
          on staff.restaurant_id = journal.restaurant_id
         and staff.auth_user_id = journal.actor_user_id
         and staff.role = 'cashier'
        where journal.order_id = o.id
          and journal.event_type = 'SALE_CREATED'
          and journal.actor_role = 'cashier'
        order by journal.occurred_at, journal.journal_id
        limit 1
      ), 'Cashier')
      else null
    end as cashier_name,
    o.cash_received_amount,
    o.cash_change_amount,
    o.created_at,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', oi.id,
          'productName', oi.product_name,
          'quantity', oi.quantity,
          'unitPrice', oi.unit_price,
          'lineTotal', oi.line_total
        )
        order by oi.created_at, oi.id
      ) filter (where oi.id is not null),
      '[]'::jsonb
    ) as items
  from public.orders o
  left join public.order_items oi
    on oi.order_id = o.id
  where o.restaurant_id = p_restaurant_id
    and exists (
      select 1
      from public.restaurants r
      where r.id = o.restaurant_id
        and r.is_active = true
        and (
          r.owner_id = auth.uid()
          or exists (
            select 1
            from public.restaurant_staff s
            where s.restaurant_id = r.id
              and s.auth_user_id = auth.uid()
              and s.role in ('cashier','kitchen','dispatcher')
              and s.is_active = true
          )
        )
    )
  group by
    o.id,
    o.order_number,
    o.customer_name,
    o.notes,
    o.order_type,
    o.payment_method,
    o.payment_status,
    o.pickup_method,
    o.status,
    o.total,
    o.subtotal,
    o.delivery_fee,
    o.tax_vat_registered,
    o.tax_prices_vat_inclusive,
    o.tax_vat_rate,
    o.tax_gross_sales,
    o.tax_vatable_sales,
    o.tax_vat_amount,
    o.tax_vat_exempt_sales,
    o.tax_net_sales,
    o.tax_zero_rated_sales,
    o.tax_snapshot_status,
    o.tax_snapshot_version,
    o.tax_percentage_taxable_sales,
    o.tax_non_vat_exempt_sales,
    o.mobile_number,
    o.delivery_address,
    o.customer_delivery_address,
    o.cash_received_amount,
    o.cash_change_amount,
    o.discount_amount,
    o.discount_beneficiary_count,
    o.discount_group_size,
    o.created_at
  order by o.created_at desc;
$function$;

REVOKE ALL ON FUNCTION public.get_restaurant_orders(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_orders(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_pos_order_receipt_snapshot(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_cashier_name text;
  v_loyalty_discount_amount numeric(12,2) := 0;
  v_items jsonb := '[]'::jsonb;
  v_beneficiaries jsonb := '[]'::jsonb;
BEGIN
  SELECT o.*
    INTO v_order
  FROM public.orders o
  JOIN public.restaurants r ON r.id = o.restaurant_id
  WHERE o.id = p_order_id
    AND r.is_active = true
    AND (
      r.owner_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.restaurant_staff s
        WHERE s.restaurant_id = o.restaurant_id
          AND s.auth_user_id = auth.uid()
          AND s.role = 'cashier'
          AND s.is_active = true
      )
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found or you are not authorized to view its receipt.' USING errcode = '42501';
  END IF;

  SELECT coalesce(sum(abs(lt.eligible_amount)), 0)::numeric(12,2)
    INTO v_loyalty_discount_amount
  FROM public.loyalty_transactions lt
  WHERE lt.order_id = v_order.id
    AND lt.transaction_type = 'redeem';

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', oi.id,
        'name', oi.product_name,
        'quantity', oi.quantity,
        'unitPrice', oi.unit_price,
        'lineTotal', oi.line_total,
        'taxCategory', oi.tax_category_snapshot
      )
      ORDER BY oi.created_at, oi.id
    ),
    '[]'::jsonb
  )
    INTO v_items
  FROM public.order_items oi
  WHERE oi.order_id = v_order.id;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'discountType', b.discount_type,
        'idType', b.discount_id_type,
        'idNumber', b.discount_id_number,
        'beneficiaryName', b.beneficiary_name,
        'beneficiaryTin', b.beneficiary_tin,
        'beneficiaryAddress', b.beneficiary_address,
        'eligibleAmount', b.eligible_amount,
        'eligibleGrossAmount', (
          SELECT round(sum(a.eligible_gross_amount), 2)
          FROM public.order_discount_beneficiary_line_allocations a
          WHERE a.beneficiary_id = b.id
        ),
        'groupSize', v_order.discount_group_size,
        'discountAmount', b.discount_amount
      )
      ORDER BY b.created_at, b.id
    ),
    '[]'::jsonb
  )
    INTO v_beneficiaries
  FROM public.order_discount_beneficiaries b
  WHERE b.order_id = v_order.id;

  SELECT coalesce(
    (
      SELECT coalesce(nullif(trim(st.preferred_name), ''), nullif(trim(st.name), ''))
      FROM public.pos_sales_journal j
      JOIN public.restaurant_staff st
        ON st.restaurant_id = j.restaurant_id
       AND st.auth_user_id = j.actor_user_id
       AND st.role = 'cashier'
      WHERE j.order_id = v_order.id
        AND j.event_type = 'SALE_CREATED'
        AND j.actor_role = 'cashier'
      ORDER BY j.occurred_at, j.journal_id
      LIMIT 1
    ),
    (
      SELECT coalesce(nullif(trim(st.preferred_name), ''), nullif(trim(st.name), ''))
      FROM public.restaurant_staff st
      WHERE st.restaurant_id = v_order.restaurant_id
        AND st.auth_user_id = auth.uid()
        AND st.role = 'cashier'
        AND st.is_active = true
      LIMIT 1
    ),
    'Cashier'
  )
    INTO v_cashier_name;

  RETURN jsonb_build_object(
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'created_at', v_order.created_at,
    'order_type', v_order.order_type,
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'status', v_order.status,
    'customer_name', v_order.customer_name,
    'mobile_number', v_order.mobile_number,
    'delivery_address', CASE
      WHEN v_order.order_type = 'delivery'
        THEN coalesce(nullif(trim(v_order.customer_delivery_address), ''), nullif(trim(v_order.delivery_address), ''))
      ELSE NULL
    END,
    'notes', v_order.notes,
    'cashier_name', v_cashier_name,
    'subtotal', v_order.subtotal,
    'delivery_fee', v_order.delivery_fee,
    'total', v_order.total,
    'discount_amount', v_order.discount_amount,
    'loyalty_discount_amount', v_loyalty_discount_amount,
    'cash_received_amount', v_order.cash_received_amount,
    'cash_change_amount', v_order.cash_change_amount,
    'discount_group_size', v_order.discount_group_size,
    'discount_beneficiary_count', v_order.discount_beneficiary_count,
    'items', v_items,
    'beneficiaries', v_beneficiaries,
    'tax_vat_registered', v_order.tax_vat_registered,
    'tax_prices_vat_inclusive', v_order.tax_prices_vat_inclusive,
    'tax_vat_rate', v_order.tax_vat_rate,
    'tax_gross_sales', v_order.tax_gross_sales,
    'tax_vatable_sales', v_order.tax_vatable_sales,
    'tax_vat_amount', v_order.tax_vat_amount,
    'tax_vat_exempt_sales', v_order.tax_vat_exempt_sales,
    'tax_zero_rated_sales', v_order.tax_zero_rated_sales,
    'tax_net_sales', v_order.tax_net_sales,
    'tax_percentage_taxable_sales', v_order.tax_percentage_taxable_sales,
    'tax_non_vat_exempt_sales', v_order.tax_non_vat_exempt_sales,
    'tax_snapshot_status', v_order.tax_snapshot_status,
    'tax_snapshot_version', v_order.tax_snapshot_version
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_order_receipt_snapshot(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_order_receipt_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_sales_journal_order_snapshot(p_row jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'order_id', p_row -> 'id',
    'order_number', p_row -> 'order_number',
    'order_type', p_row -> 'order_type',
    'payment_method', p_row -> 'payment_method',
    'payment_status', p_row -> 'payment_status',
    'order_status', p_row -> 'status',
    'subtotal', p_row -> 'subtotal',
    'delivery_fee', p_row -> 'delivery_fee',
    'discount_amount', p_row -> 'discount_amount',
    'total', p_row -> 'total',
    'tax_snapshot_status', p_row -> 'tax_snapshot_status',
    'tax_snapshot_version', p_row -> 'tax_snapshot_version',
    'cash_received_amount', p_row -> 'cash_received_amount',
    'cash_change_amount', p_row -> 'cash_change_amount',
    'tax_vat_registered', p_row -> 'tax_vat_registered',
    'tax_prices_vat_inclusive', p_row -> 'tax_prices_vat_inclusive',
    'tax_vat_rate', p_row -> 'tax_vat_rate',
    'tax_gross_sales', p_row -> 'tax_gross_sales',
    'tax_vatable_sales', p_row -> 'tax_vatable_sales',
    'tax_vat_amount', p_row -> 'tax_vat_amount',
    'tax_vat_exempt_sales', p_row -> 'tax_vat_exempt_sales',
    'tax_net_sales', p_row -> 'tax_net_sales',
    'tax_percentage_taxable_sales', p_row -> 'tax_percentage_taxable_sales',
    'tax_non_vat_exempt_sales', p_row -> 'tax_non_vat_exempt_sales',
    'paymongo_fee', p_row -> 'paymongo_fee',
    'paymongo_net_amount', p_row -> 'paymongo_net_amount',
    'refund_status', p_row -> 'cancellation_refund_status',
    'created_at', p_row -> 'created_at',
    'updated_at', p_row -> 'updated_at'
  ));
$function$;

CREATE OR REPLACE FUNCTION public.capture_pos_sales_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_event_type text;
  v_actor_role text;
  v_restaurant_id uuid;
  v_order_id uuid;
  v_order_number text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;

  if tg_table_name = 'orders' then
    v_row := coalesce(v_new, v_old);
    v_restaurant_id := nullif(v_row ->> 'restaurant_id', '')::uuid;
    v_order_id := nullif(v_row ->> 'id', '')::uuid;
    v_order_number := v_row ->> 'order_number';

    if tg_op = 'INSERT' then
      v_event_type := 'SALE_CREATED';
    elsif tg_op = 'DELETE' then
      v_event_type := 'ORDER_RECORD_DELETED';
    elsif v_old -> 'tax_snapshot_status' is distinct from v_new -> 'tax_snapshot_status'
      or v_old -> 'tax_snapshot_version' is distinct from v_new -> 'tax_snapshot_version' then
      v_event_type := 'TAX_SNAPSHOT_STATUS_CHANGED';
    elsif v_old -> 'payment_status' is distinct from v_new -> 'payment_status' then
      v_event_type := 'PAYMENT_STATUS_CHANGED';
    elsif v_old -> 'status' is distinct from v_new -> 'status' then
      v_event_type := 'ORDER_STATUS_CHANGED';
    elsif v_old -> 'subtotal' is distinct from v_new -> 'subtotal'
      or v_old -> 'delivery_fee' is distinct from v_new -> 'delivery_fee'
      or v_old -> 'discount_amount' is distinct from v_new -> 'discount_amount'
      or v_old -> 'total' is distinct from v_new -> 'total'
      or v_old -> 'tax_vat_registered' is distinct from v_new -> 'tax_vat_registered'
      or v_old -> 'tax_prices_vat_inclusive' is distinct from v_new -> 'tax_prices_vat_inclusive'
      or v_old -> 'tax_vat_rate' is distinct from v_new -> 'tax_vat_rate'
      or v_old -> 'tax_gross_sales' is distinct from v_new -> 'tax_gross_sales'
      or v_old -> 'tax_vatable_sales' is distinct from v_new -> 'tax_vatable_sales'
      or v_old -> 'tax_vat_amount' is distinct from v_new -> 'tax_vat_amount'
      or v_old -> 'tax_vat_exempt_sales' is distinct from v_new -> 'tax_vat_exempt_sales'
      or v_old -> 'tax_net_sales' is distinct from v_new -> 'tax_net_sales'
      or v_old -> 'tax_percentage_taxable_sales' is distinct from v_new -> 'tax_percentage_taxable_sales'
      or v_old -> 'tax_non_vat_exempt_sales' is distinct from v_new -> 'tax_non_vat_exempt_sales'
      or v_old -> 'cash_received_amount' is distinct from v_new -> 'cash_received_amount'
      or v_old -> 'cash_change_amount' is distinct from v_new -> 'cash_change_amount'
      or v_old -> 'order_number' is distinct from v_new -> 'order_number' then
      v_event_type := 'FINANCIAL_OR_SERIAL_FIELDS_CHANGED';
    else
      v_event_type := 'ORDER_UPDATED';
    end if;

    v_actor_role := case
      when auth.uid() is null then coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'system')
      when public.is_system_admin() then 'system_admin'
      when exists (select 1 from public.restaurants r where r.id = v_restaurant_id and r.owner_id = auth.uid()) then 'owner'
      else coalesce((
        select s.role from public.restaurant_staff s
        where s.restaurant_id = v_restaurant_id and s.auth_user_id = auth.uid() and s.is_active = true
        order by case s.role when 'cashier' then 1 when 'dispatcher' then 2 when 'kitchen' then 3 when 'rider' then 4 else 5 end
        limit 1
      ), 'authenticated_user')
    end;

    insert into public.pos_sales_journal (
      restaurant_id, order_id, order_number, event_type, operation,
      actor_user_id, actor_role, old_values, new_values
    ) values (
      v_restaurant_id, v_order_id, v_order_number, v_event_type, tg_op,
      auth.uid(), v_actor_role,
      case when v_old is null then null else public.pos_sales_journal_order_snapshot(v_old) end,
      case when v_new is null then null else public.pos_sales_journal_order_snapshot(v_new) end
    );

    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_row := coalesce(v_new, v_old);
  v_order_id := nullif(v_row ->> 'order_id', '')::uuid;
  select o.restaurant_id, o.order_number
    into v_restaurant_id, v_order_number
    from public.orders o
    where o.id = v_order_id;

  -- If the parent order has already been deleted during a cascade, its
  -- ORDER_RECORD_DELETED event remains the authoritative record.
  if not found then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  v_event_type := case tg_op
    when 'INSERT' then 'ORDER_ITEM_ADDED'
    when 'UPDATE' then 'ORDER_ITEM_CHANGED'
    else 'ORDER_ITEM_REMOVED'
  end;

  v_actor_role := case
    when auth.uid() is null then coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'system')
    when public.is_system_admin() then 'system_admin'
    when exists (select 1 from public.restaurants r where r.id = v_restaurant_id and r.owner_id = auth.uid()) then 'owner'
    else coalesce((
      select s.role from public.restaurant_staff s
      where s.restaurant_id = v_restaurant_id and s.auth_user_id = auth.uid() and s.is_active = true
      order by case s.role when 'cashier' then 1 when 'dispatcher' then 2 when 'kitchen' then 3 when 'rider' then 4 else 5 end
      limit 1
    ), 'authenticated_user')
  end;

  insert into public.pos_sales_journal (
    restaurant_id, order_id, order_number, event_type, operation,
    actor_user_id, actor_role, old_values, new_values
  ) values (
    v_restaurant_id, v_order_id, v_order_number, v_event_type, tg_op,
    auth.uid(), v_actor_role,
    case when v_old is null then null else public.pos_sales_journal_item_snapshot(v_old) end,
    case when v_new is null then null else public.pos_sales_journal_item_snapshot(v_new) end
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$function$;
