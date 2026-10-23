-- Do not allow VAT and non-VAT product categories to be mixed within a tenant configuration.
-- NULL remains allowed so unreviewed products are represented honestly and flagged by readiness.
CREATE OR REPLACE FUNCTION public.set_restaurant_product_tax_category(p_product_id uuid, p_tax_category text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_restaurant_id uuid;
  v_old_tax_category text;
  v_is_vat_registered boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_tax_category is not null and p_tax_category not in ('standard_rate','vat_exempt','zero_rated','percentage_taxable','non_vat_exempt') then
    raise exception 'Tax category must be a supported VAT or non-VAT category, or NULL for unclassified.';
  end if;

  select p.restaurant_id, p.tax_category, coalesce(r.tax_vat_registered, false)
    into v_restaurant_id, v_old_tax_category, v_is_vat_registered
    from public.products p
    join public.restaurants r on r.id = p.restaurant_id
    where p.id = p_product_id
      and r.owner_id = auth.uid()
      and r.is_active = true
    for update of p;

  if not found then
    raise exception 'Product not found or you are not authorized to update it.' using errcode = '42501';
  end if;

  if p_tax_category is not null and v_is_vat_registered
     and p_tax_category not in ('standard_rate','vat_exempt','zero_rated') then
    raise exception 'VAT-registered restaurants must use a VAT tax category for each classified menu product.';
  end if;
  if p_tax_category is not null and not v_is_vat_registered
     and p_tax_category not in ('percentage_taxable','non_vat_exempt') then
    raise exception 'Non-VAT restaurants must use a non-VAT sales classification for each classified menu product.';
  end if;

  update public.products
     set tax_category = p_tax_category,
         updated_at = now()
   where id = p_product_id
     and restaurant_id = v_restaurant_id;

  return p_tax_category;
end;
$function$;

REVOKE ALL ON FUNCTION public.set_restaurant_product_tax_category(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_restaurant_product_tax_category(uuid,text) TO authenticated;

