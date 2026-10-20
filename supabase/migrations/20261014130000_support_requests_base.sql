-- Base support-ticket schema used by the System Admin support console and
-- tenant support UI. This baseline was missing from the original migration chain,
-- even though later migrations alter its sequence and reference this table.

CREATE SEQUENCE IF NOT EXISTS public.restaurant_support_request_number_seq
  AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO MAXVALUE CACHE 1;

CREATE TABLE IF NOT EXISTS public.restaurant_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_email text,
  request_type text NOT NULL
    CONSTRAINT restaurant_support_requests_request_type_check
    CHECK (request_type IN ('incident', 'change_request', 'request_item')),
  subject text NOT NULL
    CONSTRAINT restaurant_support_requests_subject_check
    CHECK (length(btrim(subject)) > 0),
  description text NOT NULL
    CONSTRAINT restaurant_support_requests_description_check
    CHECK (length(btrim(description)) > 0),
  impact text NOT NULL DEFAULT 'normal'
    CONSTRAINT restaurant_support_requests_impact_check
    CHECK (impact IN ('low', 'normal', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT restaurant_support_requests_status_check
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_support_requests_id_key PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS restaurant_support_requests_restaurant_created_idx
  ON public.restaurant_support_requests (restaurant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_restaurant_support_request_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_prefix text;
BEGIN
  IF NEW.request_number IS NULL OR btrim(NEW.request_number) = '' THEN
    v_prefix := CASE NEW.request_type
      WHEN 'incident' THEN 'INC'
      WHEN 'change_request' THEN 'CHG'
      WHEN 'request_item' THEN 'RITM'
    END;
    NEW.request_number := v_prefix || lpad(nextval('public.restaurant_support_request_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS restaurant_support_request_number_before_insert
  ON public.restaurant_support_requests;
CREATE TRIGGER restaurant_support_request_number_before_insert
BEFORE INSERT ON public.restaurant_support_requests
FOR EACH ROW
EXECUTE FUNCTION public.set_restaurant_support_request_number();

ALTER TABLE public.restaurant_support_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.restaurant_support_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.restaurant_support_requests TO authenticated;
GRANT USAGE ON SEQUENCE public.restaurant_support_request_number_seq TO authenticated;

DROP POLICY IF EXISTS "Restaurant owners can read their support requests"
  ON public.restaurant_support_requests;
CREATE POLICY "Restaurant owners can read their support requests"
ON public.restaurant_support_requests
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = restaurant_support_requests.restaurant_id
      AND r.owner_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS "Restaurant owners can submit support requests"
  ON public.restaurant_support_requests;
CREATE POLICY "Restaurant owners can submit support requests"
ON public.restaurant_support_requests
FOR INSERT TO authenticated
WITH CHECK (
  requester_user_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE r.id = restaurant_support_requests.restaurant_id
      AND r.owner_id = (SELECT auth.uid())
      AND r.is_active = true
  )
);

DROP POLICY IF EXISTS "System admins can read support requests"
  ON public.restaurant_support_requests;
CREATE POLICY "System admins can read support requests"
ON public.restaurant_support_requests
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.system_admin_get_my_access_level() a
    WHERE a.is_active = true AND a.status = 'active'
  )
);

DROP POLICY IF EXISTS "System admins can update support requests"
  ON public.restaurant_support_requests;
CREATE POLICY "System admins can update support requests"
ON public.restaurant_support_requests
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.system_admin_get_my_access_level() a
    WHERE a.is_active = true
      AND a.status = 'active'
      AND a.access_level = ANY (ARRAY['owner', 'administrator'])
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.system_admin_get_my_access_level() a
    WHERE a.is_active = true
      AND a.status = 'active'
      AND a.access_level = ANY (ARRAY['owner', 'administrator'])
  )
);
