-- Allow inventory items to be deleted while preserving historical deduction records.
alter table public.restaurant_inventory_order_deductions
  alter column inventory_item_id drop not null;

do $$
declare
  v_constraint text;
begin
  select tc.constraint_name into v_constraint
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name and tc.constraint_schema = kcu.constraint_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public'
    and tc.table_name = 'restaurant_inventory_order_deductions'
    and kcu.column_name = 'inventory_item_id'
  limit 1;

  if v_constraint is not null then
    execute format('alter table public.restaurant_inventory_order_deductions drop constraint %I', v_constraint);
  end if;

  alter table public.restaurant_inventory_order_deductions
    add constraint restaurant_inventory_order_deductions_inventory_item_id_fkey
    foreign key (inventory_item_id)
    references public.restaurant_inventory_items(id)
    on delete set null;
end $$;
