create or replace function public.system_admin_get_mapbox_usage(
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
 where e.provider='mapbox' and e.created_at>=p_start_at and e.created_at<p_end_at and public.is_system_admin()
 group by e.service order by e.service;
$$;

create or replace function public.system_admin_get_mapbox_usage_by_restaurant(
  p_start_at timestamptz default now() - interval '30 days',
  p_end_at timestamptz default now()
)
returns table (restaurant_id uuid, restaurant_name text, requests bigint, estimated_cost_usd numeric)
language sql security definer stable set search_path=public as $$
 select e.restaurant_id,
   coalesce(r.name,'Platform / unassigned'),
   coalesce(sum(e.request_count),0)::bigint,
   coalesce(sum(e.estimated_cost_usd),0)::numeric
 from public.system_api_usage_events e
 left join public.restaurants r on r.id=e.restaurant_id
 where e.provider='mapbox' and e.created_at>=p_start_at and e.created_at<p_end_at and public.is_system_admin()
 group by e.restaurant_id,r.name order by 3 desc;
$$;

create or replace function public.system_admin_get_mapbox_usage_daily(
  p_start_at timestamptz default now() - interval '30 days',
  p_end_at timestamptz default now()
)
returns table (usage_date date, requests bigint, estimated_cost_usd numeric)
language sql security definer stable set search_path=public as $$
 select (e.created_at at time zone 'Asia/Manila')::date,
   coalesce(sum(e.request_count),0)::bigint,
   coalesce(sum(e.estimated_cost_usd),0)::numeric
 from public.system_api_usage_events e
 where e.provider='mapbox' and e.created_at>=p_start_at and e.created_at<p_end_at and public.is_system_admin()
 group by (e.created_at at time zone 'Asia/Manila')::date
 order by (e.created_at at time zone 'Asia/Manila')::date;
$$;

revoke all on function public.system_admin_get_mapbox_usage(timestamptz,timestamptz) from public, anon;
grant execute on function public.system_admin_get_mapbox_usage(timestamptz,timestamptz) to authenticated;
revoke all on function public.system_admin_get_mapbox_usage_by_restaurant(timestamptz,timestamptz) from public, anon;
grant execute on function public.system_admin_get_mapbox_usage_by_restaurant(timestamptz,timestamptz) to authenticated;
revoke all on function public.system_admin_get_mapbox_usage_daily(timestamptz,timestamptz) from public, anon;
grant execute on function public.system_admin_get_mapbox_usage_daily(timestamptz,timestamptz) to authenticated;