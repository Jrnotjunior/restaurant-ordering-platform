-- Remove the legacy 9-argument online-payment RPC.
-- Supabase/PostgREST does not reliably support overloaded functions with the
-- same name, so keeping both signatures can make the client RPC ambiguous.
drop function if exists public.create_pending_online_payment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  jsonb
);

grant execute on function public.create_pending_online_payment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  jsonb,
  boolean
) to anon, authenticated;
