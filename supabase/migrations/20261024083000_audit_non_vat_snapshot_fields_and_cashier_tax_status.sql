-- Keep the new non-VAT amounts and line tax classifications in the technical audit snapshots.
-- Restore same-tenant cashier access to non-sensitive tax-snapshot completeness status for cashier reports.
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

CREATE OR REPLACE FUNCTION public.pos_sales_journal_item_snapshot(p_row jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'order_item_id', p_row -> 'id',
    'order_id', p_row -> 'order_id',
    'product_id', p_row -> 'product_id',
    'product_name', p_row -> 'product_name',
    'unit_price', p_row -> 'unit_price',
    'quantity', p_row -> 'quantity',
    'line_total', p_row -> 'line_total',
    'tax_category_snapshot', p_row -> 'tax_category_snapshot',
    'created_at', p_row -> 'created_at'
  ));
$function$;

CREATE OR REPLACE FUNCTION public.get_restaurant_tax_snapshot_statuses(p_restaurant_id uuid)
 RETURNS TABLE(order_id uuid, tax_snapshot_status text, tax_snapshot_version smallint, tax_zero_rated_sales numeric, items_tax_classified boolean, discount_beneficiaries_complete boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not (
    public.is_system_admin()
    or exists (
      select 1 from public.restaurants r
      where r.id = p_restaurant_id
        and r.owner_id = auth.uid()
        and r.is_active = true
    )
    or exists (
      select 1
      from public.restaurant_staff s
      join public.restaurants r on r.id = s.restaurant_id
      where s.restaurant_id = p_restaurant_id
        and s.auth_user_id = auth.uid()
        and s.role = 'cashier'
        and s.is_active = true
        and r.is_active = true
    )
  ) then
    raise exception 'You are not authorized to view this restaurant tax status.';
  end if;

  return query
  select
    o.id,
    o.tax_snapshot_status,
    o.tax_snapshot_version,
    o.tax_zero_rated_sales,
    (
      exists (select 1 from public.order_items oi where oi.order_id = o.id)
      and not exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id
          and oi.tax_category_snapshot is null
      )
    ) as items_tax_classified,
    (
      o.discount_beneficiary_count = 0
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
    ) as discount_beneficiaries_complete
  from public.orders o
  where o.restaurant_id = p_restaurant_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_restaurant_tax_snapshot_statuses(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_tax_snapshot_statuses(uuid) TO authenticated;
