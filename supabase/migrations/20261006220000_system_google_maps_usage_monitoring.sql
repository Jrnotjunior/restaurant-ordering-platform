create table if not exists public.system_api_usage_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  service text not null,
  operation text not null,
  restaurant_id uuid null references public.restaurants(id) on delete set null,
  request_count integer not null default 1 check (request_count > 0),
  status text not null default 'success' check (status in ('success','error','blocked')),
  estimated_cost_usd numeric(12,6) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_api_usage_events_created_at_idx on public.system_api_usage_events(created_at desc);
create index if not exists system_api_usage_events_provider_service_idx on public.system_api_usage_events(provider, service, created_at desc);
create index if not exists system_api_usage_events_restaurant_idx on public.system_api_usage_events(restaurant_id, created_at desc);

alter table public.system_api_usage_events enable row level security;

drop policy if exists "System admins can view API usage events" on public.system_api_usage_events;
create policy "System admins can view API usage events"
on public.system_api_usage_events
for select to authenticated
using (public.is_system_admin());

create or replace function public.system_admin_get_google_maps_usage(
  p_start_at timestamptz default now() - interval '30 days',
  p_end_at timestamptz default now()
)
returns table (service text, requests bigint, successful_requests bigint, error_requests bigint, estimated_cost_usd numeric)
language sql security definer stable set search_path=public as $$
 select e.service,
   coalesce(sum(e.request_count),0)::bigint,
   coalesce(sum(e.request_count) filter(where e.status='success'),0)::bigint,
   coalesce(sum(e.request_count) filter(where e.status<>'success'),0)::bigint,
   coalesce(sum(e.estimated_cost_usd),0)::numeric
 from public.system_api_usage_events e
 where e.provider='google_maps' and e.created_at>=p_start_at and e.created_at<p_end_at and public.is_system_admin()
 group by e.service order by e.service;
$$;

revoke all on function public.system_admin_get_google_maps_usage(timestamptz,timestamptz) from public, anon;
grant execute on function public.system_admin_get_google_maps_usage(timestamptz,timestamptz) to authenticated;

create or replace function public.system_admin_get_google_maps_usage_by_restaurant(
  p_start_at timestamptz default now() - interval '30 days',
  p_end_at timestamptz default now()
)
returns table (restaurant_id uuid, restaurant_name text, requests bigint, estimated_cost_usd numeric)
language sql security definer stable set search_path=public as $$
 select e.restaurant_id,
   coalesce(r.name,'Platform / unassigned'),
   coalesce(sum(e.request_count),0)::bigint as total_requests,
   coalesce(sum(e.estimated_cost_usd),0)::numeric
 from public.system_api_usage_events e
 left join public.restaurants r on r.id=e.restaurant_id
 where e.provider='google_maps' and e.created_at>=p_start_at and e.created_at<p_end_at and public.is_system_admin()
 group by e.restaurant_id,r.name order by total_requests desc;
$$;

revoke all on function public.system_admin_get_google_maps_usage_by_restaurant(timestamptz,timestamptz) from public, anon;
grant execute on function public.system_admin_get_google_maps_usage_by_restaurant(timestamptz,timestamptz) to authenticated;

create or replace function public.system_admin_get_google_maps_usage_daily(
  p_start_at timestamptz default now() - interval '30 days',
  p_end_at timestamptz default now()
)
returns table (usage_date date, requests bigint, estimated_cost_usd numeric)
language sql security definer stable set search_path=public as $$
 select (e.created_at at time zone 'Asia/Manila')::date,
   coalesce(sum(e.request_count),0)::bigint,
   coalesce(sum(e.estimated_cost_usd),0)::numeric
 from public.system_api_usage_events e
 where e.provider='google_maps' and e.created_at>=p_start_at and e.created_at<p_end_at and public.is_system_admin()
 group by (e.created_at at time zone 'Asia/Manila')::date
 order by (e.created_at at time zone 'Asia/Manila')::date;
$$;

revoke all on function public.system_admin_get_google_maps_usage_daily(timestamptz,timestamptz) from public, anon;
grant execute on function public.system_admin_get_google_maps_usage_daily(timestamptz,timestamptz) to authenticated;
