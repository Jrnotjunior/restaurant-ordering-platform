-- Give each restaurant branch its own public storefront hostname and
-- independent theme/storefront customization while retaining one owner platform.

ALTER TABLE public.restaurant_branches
  ADD COLUMN IF NOT EXISTS custom_domain text;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_branches_custom_domain_unique_idx
  ON public.restaurant_branches (lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_restaurant_branch_custom_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.custom_domain := NULLIF(lower(regexp_replace(btrim(coalesce(NEW.custom_domain, '')), '[.]$', '')), '');
  IF NEW.custom_domain IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.custom_domain !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
     OR NEW.custom_domain LIKE '%..%' THEN
    RAISE EXCEPTION 'Enter a hostname only, such as branch.example.com. Do not include https:// or a path.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurant_branches b
    WHERE lower(b.custom_domain) = NEW.custom_domain
      AND b.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'That website domain is already assigned to another branch.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurants r
    WHERE lower(r.custom_domain) = NEW.custom_domain
      AND (
        r.id <> NEW.restaurant_id
        OR NOT EXISTS (
          SELECT 1 FROM public.restaurant_branches default_branch
          WHERE default_branch.id = NEW.id
            AND default_branch.restaurant_id = NEW.restaurant_id
            AND default_branch.is_default = true
        )
      )
  ) THEN
    RAISE EXCEPTION 'That website domain is already assigned to another restaurant or its default storefront.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS restaurant_branches_validate_custom_domain ON public.restaurant_branches;
CREATE TRIGGER restaurant_branches_validate_custom_domain
BEFORE INSERT OR UPDATE OF custom_domain, restaurant_id, is_default
ON public.restaurant_branches
FOR EACH ROW
EXECUTE FUNCTION public.validate_restaurant_branch_custom_domain();

CREATE OR REPLACE FUNCTION public.validate_restaurant_custom_domain_against_branches()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.custom_domain := NULLIF(lower(regexp_replace(btrim(coalesce(NEW.custom_domain, '')), '[.]$', '')), '');
  IF NEW.custom_domain IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.custom_domain !~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
     OR NEW.custom_domain LIKE '%..%' THEN
    RAISE EXCEPTION 'Enter a hostname only, such as branch.example.com. Do not include https:// or a path.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.restaurant_branches b
    WHERE lower(b.custom_domain) = NEW.custom_domain
      AND (b.restaurant_id <> NEW.id OR NOT b.is_default)
  ) THEN
    RAISE EXCEPTION 'That website domain is already assigned to another branch.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS restaurants_validate_custom_domain_against_branches ON public.restaurants;
CREATE TRIGGER restaurants_validate_custom_domain_against_branches
BEFORE INSERT OR UPDATE OF custom_domain, id
ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.validate_restaurant_custom_domain_against_branches();

REVOKE ALL ON FUNCTION public.validate_restaurant_branch_custom_domain() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_restaurant_custom_domain_against_branches() FROM PUBLIC, anon, authenticated;

GRANT INSERT (custom_domain) ON public.restaurant_branches TO authenticated;
GRANT UPDATE (custom_domain) ON public.restaurant_branches TO authenticated;

CREATE TABLE IF NOT EXISTS public.restaurant_branch_website_customizations (
  branch_id uuid PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  theme jsonb NOT NULL,
  storefront jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_branch_website_customizations_branch_restaurant_fkey
    FOREIGN KEY (branch_id, restaurant_id)
    REFERENCES public.restaurant_branches(id, restaurant_id)
    ON DELETE CASCADE
);

ALTER TABLE public.restaurant_branch_website_customizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS restaurant_branch_website_customizations_public_read
  ON public.restaurant_branch_website_customizations;
CREATE POLICY restaurant_branch_website_customizations_public_read
  ON public.restaurant_branch_website_customizations
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.restaurant_branches b
      JOIN public.restaurants r ON r.id = b.restaurant_id
      WHERE b.id = restaurant_branch_website_customizations.branch_id
        AND b.restaurant_id = restaurant_branch_website_customizations.restaurant_id
        AND b.is_active = true
        AND r.is_active = true
    )
  );

DROP POLICY IF EXISTS restaurant_branch_website_customizations_owner_manage
  ON public.restaurant_branch_website_customizations;
CREATE POLICY restaurant_branch_website_customizations_owner_manage
  ON public.restaurant_branch_website_customizations
  FOR ALL TO authenticated
  USING (
    public.privileged_restaurant_mfa_verified()
    AND EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = restaurant_branch_website_customizations.restaurant_id
        AND r.owner_id = auth.uid()
        AND r.is_active = true
    )
  )
  WITH CHECK (
    public.privileged_restaurant_mfa_verified()
    AND EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = restaurant_branch_website_customizations.restaurant_id
        AND r.owner_id = auth.uid()
        AND r.is_active = true
    )
  );

REVOKE ALL ON public.restaurant_branch_website_customizations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.restaurant_branch_website_customizations TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.restaurant_branch_website_customizations TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_restaurant_branch_by_domain(p_hostname text)
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  tagline text,
  logo_url text,
  restaurant_address text,
  contact_number text,
  email text,
  is_active boolean,
  custom_domain text,
  branch_id uuid,
  branch_code text,
  branch_name text,
  branch_store_address text,
  branch_restaurant_address text,
  branch_contact_number text,
  branch_ordering_enabled boolean,
  branch_operating_hours jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_hostname text;
BEGIN
  v_hostname := lower(regexp_replace(btrim(coalesce(p_hostname, '')), '[.]$', ''));
  IF v_hostname = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.slug,
    r.name,
    r.tagline,
    r.logo_url,
    r.restaurant_address,
    r.contact_number,
    r.email,
    r.is_active,
    coalesce(nullif(b.custom_domain, ''), r.custom_domain),
    b.id,
    b.branch_code,
    b.name,
    b.store_address,
    b.restaurant_address,
    b.contact_number,
    b.ordering_enabled,
    b.operating_hours
  FROM public.restaurant_branches b
  JOIN public.restaurants r ON r.id = b.restaurant_id
  WHERE r.is_active = true
    AND b.is_active = true
    AND (
      lower(coalesce(b.custom_domain, '')) = v_hostname
      OR (
        lower(coalesce(r.custom_domain, '')) = v_hostname
        AND b.is_default = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.restaurant_branches domain_branch
          WHERE lower(coalesce(domain_branch.custom_domain, '')) = v_hostname
        )
      )
    )
  ORDER BY CASE WHEN lower(coalesce(b.custom_domain, '')) = v_hostname THEN 0 ELSE 1 END
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_restaurant_branch_by_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_restaurant_branch_by_domain(text) TO anon, authenticated;

-- Keep the original lightweight resolver compatible with older clients while
-- allowing it to recognize hostnames assigned to a branch.
CREATE OR REPLACE FUNCTION public.resolve_restaurant_by_domain(p_hostname text)
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  tagline text,
  logo_url text,
  restaurant_address text,
  contact_number text,
  email text,
  is_active boolean,
  custom_domain text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_hostname text;
BEGIN
  v_hostname := lower(regexp_replace(btrim(coalesce(p_hostname, '')), '[.]$', ''));
  IF v_hostname = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.id, r.slug, r.name, r.tagline, r.logo_url, r.restaurant_address,
         r.contact_number, r.email, r.is_active, coalesce(b.custom_domain, r.custom_domain)
  FROM public.restaurants r
  LEFT JOIN public.restaurant_branches b ON b.restaurant_id = r.id
  WHERE r.is_active = true
    AND (
      lower(coalesce(r.custom_domain, '')) = v_hostname
      OR EXISTS (
        SELECT 1 FROM public.restaurant_branches domain_branch
        WHERE domain_branch.restaurant_id = r.id
          AND domain_branch.is_active = true
          AND lower(coalesce(domain_branch.custom_domain, '')) = v_hostname
      )
    )
  ORDER BY CASE WHEN lower(coalesce(b.custom_domain, '')) = v_hostname THEN 0 ELSE 1 END
  LIMIT 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_restaurant_by_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_restaurant_by_domain(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
