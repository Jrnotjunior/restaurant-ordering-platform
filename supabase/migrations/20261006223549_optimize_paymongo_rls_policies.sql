drop policy if exists "Restaurant owners can view their PayMongo connection"
  on public.restaurant_paymongo_accounts;

create policy "Restaurant owners can view their PayMongo connection"
  on public.restaurant_paymongo_accounts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.restaurants r
      where r.id = restaurant_paymongo_accounts.restaurant_id
        and r.owner_id = (select auth.uid())
    )
  );

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
        and r.owner_id = (select auth.uid())
    )
  );