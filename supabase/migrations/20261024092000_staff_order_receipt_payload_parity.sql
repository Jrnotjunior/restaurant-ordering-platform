-- Enrich the staff order payload for receipt parity without exposing buyer PII to kitchen/dispatch.
-- Mobile number, delivery address, cashier name and beneficiary identity remain owner/cashier-only.
DROP FUNCTION public.get_restaurant_orders(uuid);

CREATE FUNCTION public.get_restaurant_orders(p_restaurant_id uuid)
 RETURNS TABLE(order_id uuid, order_number text, customer_name text, notes text, order_type text, payment_method text, payment_status text, pickup_method text, status text, total numeric, shipping_fee numeric, tax_vat_registered boolean, tax_prices_vat_inclusive boolean, tax_vat_rate numeric, tax_gross_sales numeric, tax_vatable_sales numeric, tax_vat_amount numeric, tax_vat_exempt_sales numeric, tax_net_sales numeric, tax_zero_rated_sales numeric, tax_snapshot_status text, tax_snapshot_version smallint, tax_percentage_taxable_sales numeric, tax_non_vat_exempt_sales numeric, items_tax_classified boolean, discount_beneficiaries_complete boolean, discount_amount numeric, loyalty_discount_amount numeric, discount_beneficiary_count integer, discount_group_size integer, discount_beneficiaries jsonb, mobile_number text, delivery_address text, cashier_name text, created_at timestamp with time zone, items jsonb)
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
    o.discount_amount,
    o.discount_beneficiary_count,
    o.discount_group_size,
    o.created_at
  order by o.created_at desc;
$function$;

REVOKE ALL ON FUNCTION public.get_restaurant_orders(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_orders(uuid) TO authenticated;
