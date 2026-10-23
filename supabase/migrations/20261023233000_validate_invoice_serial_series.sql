-- Strengthen disabled-series validation: six-digit serials and explicit document type.
create or replace function public.system_admin_configure_disabled_invoice_series(
  p_restaurant_id uuid,
  p_branch_code text,
  p_document_type text,
  p_initial_serial bigint,
  p_next_serial bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.restaurant_taxpayer_profiles%rowtype;
  v_existing public.restaurant_invoice_issuance_configs%rowtype;
  v_has_existing boolean := false;
  v_issued_count bigint := 0;
  v_branch_code text := coalesce(trim(p_branch_code), '');
begin
  if not public.is_system_admin() then
    raise exception 'System Administrator access required.';
  end if;

  if p_document_type is null or p_document_type not in ('invoice','sales_invoice','cash_invoice','credit_invoice','service_invoice') then
    raise exception 'Invalid document type.';
  end if;

  if p_initial_serial is null or p_initial_serial < 100000
     or p_next_serial is null or p_next_serial < p_initial_serial then
    raise exception 'Enter an authorized initial serial with at least six digits and a next serial that is not lower than the initial serial.';
  end if;

  if length(v_branch_code) > 64 then
    raise exception 'Branch code must be 64 characters or fewer.';
  end if;

  select * into v_profile
  from public.restaurant_taxpayer_profiles
  where restaurant_id = p_restaurant_id
  for update;

  if not found then
    raise exception 'Create and review the tenant taxpayer profile before configuring a serial series.';
  end if;

  if v_profile.profile_status <> 'reviewed' then
    raise exception 'The tenant taxpayer profile must have completed System Admin review before a serial series can be recorded.';
  end if;

  if v_profile.bir_route_status not in ('software_supplier','esp','both') then
    raise exception 'The tenant regulatory route must be confirmed before a serial series can be recorded.';
  end if;

  if v_profile.bir_approval_recorded_at is null
     or nullif(trim(v_profile.bir_accreditation_reference), '') is null then
    raise exception 'Record the verified BIR accreditation/approval reference and approval date first.';
  end if;

  if v_profile.bir_route_status in ('software_supplier','both')
     and nullif(trim(v_profile.bir_permit_to_use_reference), '') is null then
    raise exception 'Record the verified tenant Permit to Use reference first.';
  end if;

  if v_profile.bir_route_status in ('esp','both')
     and nullif(trim(v_profile.bir_permit_to_transmit_reference), '') is null then
    raise exception 'Record the verified Permit to Transmit reference first.';
  end if;

  select * into v_existing
  from public.restaurant_invoice_issuance_configs
  where restaurant_id = p_restaurant_id
    and branch_code = v_branch_code
    and document_type = p_document_type
  for update;
  v_has_existing := found;

  if v_has_existing and v_existing.issuance_enabled then
    raise exception 'This serial series is active. Use a separately reviewed controlled maintenance process; this function cannot reconfigure an active series.';
  end if;

  select count(*) into v_issued_count
  from public.issued_sales_documents d
  where d.restaurant_id = p_restaurant_id
    and d.branch_code = v_branch_code
    and d.document_type = p_document_type;

  if v_issued_count > 0 and v_has_existing and p_initial_serial is distinct from v_existing.initial_serial then
    raise exception 'Cannot change the starting serial after documents exist for this series.';
  end if;

  if v_has_existing and p_next_serial < v_existing.next_serial then
    raise exception 'The next serial cannot be moved backwards.';
  end if;

  insert into public.restaurant_invoice_issuance_configs (
    restaurant_id, branch_code, document_type, issuance_enabled,
    next_serial, initial_serial, regulatory_route, approval_reference,
    approval_verified_at, configured_by, configured_at, updated_at
  ) values (
    p_restaurant_id, v_branch_code, p_document_type, false,
    p_next_serial, p_initial_serial, v_profile.bir_route_status,
    v_profile.bir_accreditation_reference, v_profile.bir_approval_recorded_at,
    auth.uid(), now(), now()
  )
  on conflict (restaurant_id, branch_code, document_type) do update set
    issuance_enabled = false,
    next_serial = excluded.next_serial,
    initial_serial = excluded.initial_serial,
    regulatory_route = excluded.regulatory_route,
    approval_reference = excluded.approval_reference,
    approval_verified_at = excluded.approval_verified_at,
    configured_by = excluded.configured_by,
    configured_at = excluded.configured_at,
    updated_at = now();

  return jsonb_build_object(
    'restaurant_id', p_restaurant_id,
    'branch_code', v_branch_code,
    'document_type', p_document_type,
    'initial_serial', p_initial_serial,
    'next_serial', p_next_serial,
    'issuance_enabled', false,
    'notice', 'Serial series recorded in disabled state. This does not enable invoices or establish BIR accreditation by itself.'
  );
end;
$$;

revoke all on function public.system_admin_configure_disabled_invoice_series(uuid,text,text,bigint,bigint) from public, anon;
grant execute on function public.system_admin_configure_disabled_invoice_series(uuid,text,text,bigint,bigint) to authenticated;
