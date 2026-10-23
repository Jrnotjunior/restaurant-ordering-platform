-- Enforce the Senior/PWD ID-type allowlist at the database boundary.
-- The POS UI and RPC checks are useful, but neither should be the sole control.
ALTER TABLE public.order_discount_beneficiaries
  ADD CONSTRAINT order_discount_beneficiary_id_type_matches_discount_type_check
  CHECK (
    discount_type IS NOT NULL
    AND discount_id_type IS NOT NULL
    AND (
      (
        discount_type = 'senior'
        AND discount_id_type IN (
          'osca_id',
          'national_senior_id',
          'passport',
          'other_government_id'
        )
      )
      OR (
        discount_type = 'pwd'
        AND discount_id_type IN (
          'pwd_id',
          'passport'
        )
      )
    )
  );

COMMENT ON CONSTRAINT order_discount_beneficiary_id_type_matches_discount_type_check
  ON public.order_discount_beneficiaries IS
  'Rejects missing or mismatched ID types for Senior Citizen and PWD statutory-discount beneficiaries.';
