-- Snapshot the origin and fee inputs used for each route quote.
-- Cached quotes are reusable only while these inputs remain unchanged.
alter table public.delivery_quotes
  add column if not exists origin_latitude double precision,
  add column if not exists origin_longitude double precision,
  add column if not exists pricing_base_fee numeric(12,2),
  add column if not exists pricing_distance_increment_meters integer,
  add column if not exists pricing_fee_per_increment numeric(12,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname='delivery_quotes_origin_latitude_check' and conrelid='public.delivery_quotes'::regclass) then
    alter table public.delivery_quotes add constraint delivery_quotes_origin_latitude_check check (origin_latitude is null or origin_latitude between -90 and 90);
  end if;
  if not exists (select 1 from pg_constraint where conname='delivery_quotes_origin_longitude_check' and conrelid='public.delivery_quotes'::regclass) then
    alter table public.delivery_quotes add constraint delivery_quotes_origin_longitude_check check (origin_longitude is null or origin_longitude between -180 and 180);
  end if;
  if not exists (select 1 from pg_constraint where conname='delivery_quotes_pricing_base_fee_check' and conrelid='public.delivery_quotes'::regclass) then
    alter table public.delivery_quotes add constraint delivery_quotes_pricing_base_fee_check check (pricing_base_fee is null or pricing_base_fee >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='delivery_quotes_pricing_increment_check' and conrelid='public.delivery_quotes'::regclass) then
    alter table public.delivery_quotes add constraint delivery_quotes_pricing_increment_check check (pricing_distance_increment_meters is null or pricing_distance_increment_meters > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='delivery_quotes_pricing_fee_check' and conrelid='public.delivery_quotes'::regclass) then
    alter table public.delivery_quotes add constraint delivery_quotes_pricing_fee_check check (pricing_fee_per_increment is null or pricing_fee_per_increment >= 0);
  end if;
end $$;
