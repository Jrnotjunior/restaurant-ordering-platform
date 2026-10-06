create table if not exists public.paymongo_webhook_events (
  event_id text primary key,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  environment text not null check (environment in ('test','live')),
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing','processed','failed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists paymongo_webhook_events_restaurant_idx
  on public.paymongo_webhook_events (restaurant_id, environment, received_at desc);

alter table public.paymongo_webhook_events enable row level security;

grant select on public.paymongo_webhook_events to authenticated;
grant select, insert, update on public.paymongo_webhook_events to service_role;

drop policy if exists "Restaurant owners can view their PayMongo webhook events"
  on public.paymongo_webhook_events;

create policy "Restaurant owners can view their PayMongo webhook events"
  on public.paymongo_webhook_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.restaurants r
      where r.id = paymongo_webhook_events.restaurant_id
        and r.owner_id = auth.uid()
    )
  );