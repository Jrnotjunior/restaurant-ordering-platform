-- Read-only readiness summary for tenant/System Admin UI.
-- This intentionally reports that the official invoice issuance API is still disabled.

create or replace function public.get_restaurant_bir_issuance_readiness(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_profile public.restaurant_taxpayer_profiles%rowtype;
  v_profile_exists boolean := false;
  v_configured_series_count integer := 0;
  v_enabled_series_count integer := 0;
  v_issued_document_count bigint := 0;
  v_profile_identity_complete boolean := false;
  v_route_evidence_recorded boolean := false;
  v_blockers jsonb := '[]'::jsonb;
begin
  if not (
    public.is_system_admin()
    or exists (
      select 1 from public.restaurants r
      where r.id = p_restaurant_id and r.owner_id = auth.uid()
    )
  ) then
    raise exception 'You are not authorized to view BIR readiness for this restaurant.';
  end if;

  select * into v_profile
  from public.restaurant_taxpayer_profiles
  where restaurant_id = p_restaurant_id;
  v_profile_exists := found;

  if v_profile_exists then
    v_profile_identity_complete :=
      nullif(trim(v_profile.registered_legal_name), '') is not null
      and nullif(trim(v_profile.tin), '') is not null
      and nullif(trim(v_profile.registered_address), '') is not null;

    v_route_evidence_recorded :=
      v_profile.bir_approval_recorded_at is not null
      and (
        (v_profile.bir_route_status = 'software_supplier'
          and nullif(trim(v_profile.bir_accreditation_reference), '') is not null
          and nullif(trim(v_profile.bir_permit_to_use_reference), '') is not null)
        or (v_profile.bir_route_status = 'esp'
          and nullif(trim(v_profile.bir_accreditation_reference), '') is not null
          and nullif(trim(v_profile.bir_permit_to_transmit_reference), '') is not null)
        or (v_profile.bir_route_status = 'both'
          and nullif(trim(v_profile.bir_accreditation_reference), '') is not null
          and nullif(trim(v_profile.bir_permit_to_use_reference), '') is not null
          and nullif(trim(v_profile.bir_permit_to_transmit_reference), '') is not null)
      );
  end if;

  select count(*)::integer,
         count(*) filter (where issuance_enabled)::integer
    into v_configured_series_count, v_enabled_series_count
  from public.restaurant_invoice_issuance_configs
  where restaurant_id = p_restaurant_id;

  select count(*) into v_issued_document_count
  from public.issued_sales_documents
  where restaurant_id = p_restaurant_id;

  if not v_profile_exists then
    v_blockers := v_blockers || jsonb_build_array('Taxpayer registration profile has not been submitted.');
  else
    if not v_profile_identity_complete then
      v_blockers := v_blockers || jsonb_build_array('Registered legal name, TIN, and registered address must be completed from official registration documents.');
    end if;
    if v_profile.profile_status <> 'reviewed' then
      v_blockers := v_blockers || jsonb_build_array('System Admin platform review is not complete.');
    end if;
    if v_profile.bir_route_status not in ('software_supplier','esp','both') then
      v_blockers := v_blockers || jsonb_build_array('The applicable BIR regulatory route is not confirmed.');
    end if;
    if not v_route_evidence_recorded then
      v_blockers := v_blockers || jsonb_build_array('Route-specific BIR approval/permit references and the recorded approval date are incomplete.');
    end if;
  end if;

  if v_configured_series_count = 0 then
    v_blockers := v_blockers || jsonb_build_array('No branch/document invoice serial series has been configured from an authorized starting number.');
  end if;

  -- Until the approved invoice rendering, full financial truth tables, required
  -- reports/readings, and route-specific transmission/issuance path have passed
  -- acceptance, the application deliberately exposes no official issue API.
  v_blockers := v_blockers || jsonb_build_array('Official invoice issuance remains disabled in the application; the immutable ledger is storage groundwork only.');

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'taxpayer_profile_exists', v_profile_exists,
    'taxpayer_identity_complete', v_profile_identity_complete,
    'taxpayer_profile_status', case when v_profile_exists then v_profile.profile_status else 'missing' end,
    'regulatory_route', case when v_profile_exists then v_profile.bir_route_status else 'unconfirmed' end,
    'route_evidence_recorded', v_route_evidence_recorded,
    'configured_series_count', v_configured_series_count,
    'enabled_series_count', v_enabled_series_count,
    'issued_document_count', v_issued_document_count,
    'official_invoice_issuance_api_enabled', false,
    'is_bir_accredited', false,
    'blockers', v_blockers,
    'notice', 'Readiness status is a platform checklist only. It is not BIR accreditation, a permit, or tax advice.'
  );
end;
$$;

revoke all on function public.get_restaurant_bir_issuance_readiness(uuid) from public, anon;
grant execute on function public.get_restaurant_bir_issuance_readiness(uuid) to authenticated;
