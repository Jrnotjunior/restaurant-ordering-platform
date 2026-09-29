-- Allow restaurant owners to use a product category as part of the product workflow.
-- The category is created only when the restaurant does not already have it.

create or replace function public.get_or_create_restaurant_category(
  p_restaurant_id uuid,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(p_name);
  v_slug text;
  v_category_id uuid;
  v_sort_order integer;
begin
  if v_name = '' then
    raise exception 'Category name is required.';
  end if;

  if not exists (
    select 1
    from public.restaurants
    where id = p_restaurant_id
      and is_active = true
  ) then
    raise exception 'Restaurant was not found or is inactive.';
  end if;

  v_slug := lower(v_name);
  v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
  v_slug := regexp_replace(v_slug, '(^-+|-+$)', '', 'g');

  if v_slug = '' then
    raise exception 'Category name must contain letters or numbers.';
  end if;

  select id
  into v_category_id
  from public.categories
  where restaurant_id = p_restaurant_id
    and lower(trim(name)) = lower(v_name)
  limit 1;

  if v_category_id is not null then
    update public.categories
    set is_active = true,
        name = v_name,
        updated_at = now()
    where id = v_category_id;

    return v_category_id;
  end if;

  select coalesce(max(sort_order), -1) + 1
  into v_sort_order
  from public.categories
  where restaurant_id = p_restaurant_id;

  insert into public.categories (
    restaurant_id,
    name,
    slug,
    description,
    sort_order,
    is_active
  )
  values (
    p_restaurant_id,
    v_name,
    v_slug,
    '',
    v_sort_order,
    true
  )
  on conflict (restaurant_id, slug)
  do update set
    is_active = true,
    name = excluded.name,
    updated_at = now()
  returning id into v_category_id;

  return v_category_id;
end;
$$;
