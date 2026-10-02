-- Allow the shared kitchen account to control product availability.
-- Kitchen staff can only change whether a product is available; they cannot edit
-- product name, price, category, description, or delete the product.

create or replace function public.update_product_availability(
  p_product_id uuid,
  p_is_available boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.products p
    join public.restaurants r on r.id = p.restaurant_id
    where p.id = p_product_id
      and r.is_active = true
      and (
        r.owner_id = auth.uid()
        or exists (
          select 1
          from public.restaurant_staff s
          where s.restaurant_id = p.restaurant_id
            and s.auth_user_id = auth.uid()
            and s.role = 'kitchen'
            and s.is_active = true
        )
      )
  ) then
    raise exception 'Product not found or you are not authorized to update availability';
  end if;

  update public.products
  set is_available = p_is_available,
      updated_at = now()
  where id = p_product_id;
end;
$$;

revoke all on function public.update_product_availability(uuid, boolean) from public;
grant execute on function public.update_product_availability(uuid, boolean) to authenticated;
