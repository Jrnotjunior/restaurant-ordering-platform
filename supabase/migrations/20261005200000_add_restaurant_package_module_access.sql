-- Restaurant package/module access control.
create table if not exists public.system_packages (
  id smallint primary key,
  package_key text not null unique,
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_packages_package_key_check check (package_key ~ '^[a-z0-9_]+$')
);

create table if not exists public.system_modules (
  module_key text primary key,
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_modules_module_key_check check (module_key ~ '^[a-z0-9_]+$')
);

create table if not exists public.system_package_modules (
  package_id smallint not null references public.system_packages(id) on delete cascade,
  module_key text not null references public.system_modules(module_key) on delete cascade,
  primary key (package_id, module_key)
);

create table if not exists public.restaurant_subscriptions (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  package_id smallint not null references public.system_packages(id),
  status text not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_subscriptions_status_check check (status in ('active','suspended','cancelled'))
);

create table if not exists public.restaurant_module_overrides (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  module_key text not null references public.system_modules(module_key) on delete cascade,
  enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, module_key)
);

create index if not exists restaurant_subscriptions_package_idx on public.restaurant_subscriptions(package_id);
create index if not exists restaurant_module_overrides_module_idx on public.restaurant_module_overrides(module_key);

alter table public.system_packages enable row level security;
alter table public.system_modules enable row level security;
alter table public.system_package_modules enable row level security;
alter table public.restaurant_subscriptions enable row level security;
alter table public.restaurant_module_overrides enable row level security;

revoke all on table public.system_packages from anon, authenticated;
revoke all on table public.system_modules from anon, authenticated;
revoke all on table public.system_package_modules from anon, authenticated;
revoke all on table public.restaurant_subscriptions from anon, authenticated;
revoke all on table public.restaurant_module_overrides from anon, authenticated;

insert into public.system_packages (id, package_key, name, description) values
(1,'full_system','Full System','Self Ordering, POS, Sales, Kitchen, Dispatch, Delivery, Loyalty, and Website.'),
(2,'self_ordering_pos','Self Ordering + POS','Self Ordering, POS, and Sales.'),
(3,'pos','POS','POS and Sales.'),
(4,'self_ordering_pos_kitchen','Self Ordering + POS + Kitchen','Self Ordering, POS, Sales, and Kitchen.'),
(5,'dispatch_delivery','Dispatch + Delivery','Dispatch, Delivery, Rider, Shipping Fee, and operational Sales records.'),
(6,'self_ordering_kitchen','Self Ordering + Kitchen','Self Ordering, Orders, Kitchen, and Sales.'),
(7,'pos_delivery','POS + Delivery','POS, Sales, Orders, Dispatch, Rider, Delivery, and Shipping Fee.')
on conflict (id) do update set package_key=excluded.package_key,name=excluded.name,description=excluded.description,is_active=true,updated_at=now();

insert into public.system_modules (module_key,name,description,sort_order) values
('self_ordering','Self Ordering','Customer-facing self ordering and checkout.',10),
('pos','POS','Cashier point-of-sale workflow.',20),
('sales','Sales','Restaurant sales reporting and transaction history.',30),
('kitchen','Kitchen','Kitchen order workflow and sold-out controls.',40),
('dispatch_delivery','Dispatch + Delivery','Dispatcher, rider, delivery, and shipping-fee workflow.',50),
('loyalty','Loyalty','Customer loyalty points and redemption.',60),
('website','Website','Restaurant website and website customization.',70)
on conflict (module_key) do update set name=excluded.name,description=excluded.description,sort_order=excluded.sort_order,is_active=true;

delete from public.system_package_modules;
insert into public.system_package_modules select 1,module_key from public.system_modules where module_key in ('self_ordering','pos','sales','kitchen','dispatch_delivery','loyalty','website');
insert into public.system_package_modules (package_id,module_key) values
(2,'self_ordering'),(2,'pos'),(2,'sales'),
(3,'pos'),(3,'sales'),
(4,'self_ordering'),(4,'pos'),(4,'sales'),(4,'kitchen'),
(5,'dispatch_delivery'),(5,'sales'),
(6,'self_ordering'),(6,'sales'),(6,'kitchen'),
(7,'pos'),(7,'sales'),(7,'dispatch_delivery');

create or replace function public.restaurant_has_module(p_restaurant_id uuid,p_module_key text)
returns boolean language plpgsql security definer set search_path='' stable as $$
declare v_enabled boolean;
begin
  if not exists (
    select 1 from public.restaurants r
    where r.id=p_restaurant_id and (
      r.owner_id=(select auth.uid())
      or exists(select 1 from public.restaurant_staff rs where rs.restaurant_id=r.id and rs.auth_user_id=(select auth.uid()) and rs.is_active=true)
      or public.system_admin_has_access()
    )
  ) then return false; end if;
  select o.enabled into v_enabled from public.restaurant_module_overrides o
  where o.restaurant_id=p_restaurant_id and o.module_key=p_module_key;
  if found then return v_enabled; end if;
  return exists(
    select 1 from public.restaurant_subscriptions s
    join public.system_package_modules pm on pm.package_id=s.package_id
    join public.system_modules m on m.module_key=pm.module_key
    where s.restaurant_id=p_restaurant_id and s.status='active'
      and (s.expires_at is null or s.expires_at>now())
      and m.module_key=p_module_key and m.is_active=true
  );
end;
$$;

create or replace function public.restaurant_get_my_modules(p_restaurant_id uuid)
returns table(module_key text,module_name text,enabled boolean)
language sql security definer set search_path='' stable as $$
  select m.module_key,m.name,public.restaurant_has_module(p_restaurant_id,m.module_key)
  from public.system_modules m where m.is_active=true order by m.sort_order,m.module_key;
$$;

create or replace function public.system_admin_get_restaurant_package(p_restaurant_id uuid)
returns table(package_id smallint,package_key text,package_name text,package_description text,subscription_status text,module_key text,module_name text,included_by_package boolean,override_enabled boolean,effective_enabled boolean)
language plpgsql security definer set search_path='' as $$
declare v_package_id smallint; v_status text;
begin
  if not public.system_admin_has_access() then raise exception 'System Administrator access required'; end if;
  select s.package_id,s.status into v_package_id,v_status from public.restaurant_subscriptions s where s.restaurant_id=p_restaurant_id;
  return query
  select p.id,p.package_key,p.name,p.description,coalesce(v_status,'not_assigned'),m.module_key,m.name,
    exists(select 1 from public.system_package_modules pm where pm.package_id=p.id and pm.module_key=m.module_key),
    o.enabled,public.restaurant_has_module(p_restaurant_id,m.module_key)
  from public.system_modules m
  left join public.system_packages p on p.id=v_package_id
  left join public.restaurant_module_overrides o on o.restaurant_id=p_restaurant_id and o.module_key=m.module_key
  where m.is_active=true order by m.sort_order,m.module_key;
end;
$$;

create or replace function public.system_admin_assign_restaurant_package(p_restaurant_id uuid,p_package_id smallint)
returns table(package_id smallint,package_key text,package_name text,subscription_status text)
language plpgsql security definer set search_path='' as $$
declare v_package public.system_packages%rowtype; v_previous_package smallint;
begin
  if not public.system_admin_has_manage_access() then raise exception 'System Administrator manage access required'; end if;
  select * into v_package from public.system_packages where id=p_package_id and is_active=true;
  if not found then raise exception 'Invalid or inactive package'; end if;
  select s.package_id into v_previous_package from public.restaurant_subscriptions s where s.restaurant_id=p_restaurant_id;
  insert into public.restaurant_subscriptions(restaurant_id,package_id,status,started_at,expires_at,updated_at)
  values(p_restaurant_id,p_package_id,'active',now(),null,now())
  on conflict(restaurant_id) do update set package_id=excluded.package_id,status='active',
    started_at=case when public.restaurant_subscriptions.package_id is distinct from excluded.package_id then now() else public.restaurant_subscriptions.started_at end,
    expires_at=null,updated_at=now();
  delete from public.restaurant_module_overrides where restaurant_id=p_restaurant_id;
  perform public.system_admin_write_audit_log('ADMIN_ACTION','Restaurant package assigned',p_restaurant_id,'restaurant_subscription',p_restaurant_id,
    jsonb_build_object('previous_package_id',v_previous_package,'new_package_id',p_package_id,'package_key',v_package.package_key));
  return query select v_package.id,v_package.package_key,v_package.name,'active'::text;
end;
$$;

create or replace function public.system_admin_set_restaurant_module_override(p_restaurant_id uuid,p_module_key text,p_enabled boolean)
returns table(module_key text,module_name text,included_by_package boolean,override_enabled boolean,effective_enabled boolean)
language plpgsql security definer set search_path='' as $$
declare v_module public.system_modules%rowtype; v_package_id smallint; v_previous boolean; v_included boolean;
begin
  if not public.system_admin_has_manage_access() then raise exception 'System Administrator manage access required'; end if;
  select * into v_module from public.system_modules where module_key=p_module_key and is_active=true;
  if not found then raise exception 'Invalid or inactive module'; end if;
  select s.package_id into v_package_id from public.restaurant_subscriptions s
  where s.restaurant_id=p_restaurant_id and s.status='active' and (s.expires_at is null or s.expires_at>now());
  if v_package_id is null then raise exception 'Restaurant has no active package'; end if;
  select exists(select 1 from public.system_package_modules pm where pm.package_id=v_package_id and pm.module_key=p_module_key) into v_included;
  if not v_included then raise exception 'Module is not included in the restaurant package'; end if;
  select o.enabled into v_previous from public.restaurant_module_overrides o where o.restaurant_id=p_restaurant_id and o.module_key=p_module_key;
  insert into public.restaurant_module_overrides(restaurant_id,module_key,enabled,updated_at)
  values(p_restaurant_id,p_module_key,p_enabled,now())
  on conflict(restaurant_id,module_key) do update set enabled=excluded.enabled,updated_at=now();
  perform public.system_admin_write_audit_log('ADMIN_ACTION',case when p_enabled then 'Restaurant module enabled' else 'Restaurant module disabled' end,
    p_restaurant_id,'restaurant_module_override',p_restaurant_id,
    jsonb_build_object('module_key',p_module_key,'previous_override',v_previous,'new_override',p_enabled,'package_id',v_package_id));
  return query select v_module.module_key,v_module.name,v_included,p_enabled,p_enabled;
end;
$$;

revoke execute on function public.restaurant_has_module(uuid,text) from public,anon;
revoke execute on function public.restaurant_get_my_modules(uuid) from public,anon;
revoke execute on function public.system_admin_get_restaurant_package(uuid) from public,anon;
revoke execute on function public.system_admin_assign_restaurant_package(uuid,smallint) from public,anon;
revoke execute on function public.system_admin_set_restaurant_module_override(uuid,text,boolean) from public,anon;
grant execute on function public.restaurant_has_module(uuid,text) to authenticated;
grant execute on function public.restaurant_get_my_modules(uuid) to authenticated;
grant execute on function public.system_admin_get_restaurant_package(uuid) to authenticated;
grant execute on function public.system_admin_assign_restaurant_package(uuid,smallint) to authenticated;
grant execute on function public.system_admin_set_restaurant_module_override(uuid,text,boolean) to authenticated;
