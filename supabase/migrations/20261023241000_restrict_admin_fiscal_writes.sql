-- Restrict privileged System Admin writes to active owner/administrator accounts with MFA.
-- View-only administrators may read readiness information but cannot change approvals,
-- configure serials, or change tenant online-payment availability.

create or replace function public.is_system_admin_manager()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'system_admin'
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1
      from public.system_admin_access a
      where a.admin_user_id = auth.uid()
        and a.is_active = true
        and a.status = 'active'
        and a.access_level in ('owner', 'administrator')
    );
$$;

revoke all on function public.is_system_admin_manager() from public, anon;
grant execute on function public.is_system_admin_manager() to authenticated;


create or replace function public.system_admin_review_restaurant_taxpayer_profile(
  p_restaurant_id uuid,
  p_profile_status text,
  p_review_note text default null,
  p_bir_route_status text default 'unconfirmed',
  p_bir_accreditation_reference text default null,
  p_bir_permit_to_use_reference text default null,
  p_bir_permit_to_transmit_reference text default null,
  p_approved_software_version text default null,
  p_bir_approval_recorded_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result public.restaurant_taxpayer_profiles%rowtype;
begin
  if not public.is_system_admin_manager() then
    raise exception 'System Administrator access required.';
  end if;

  if p_profile_status not in ('submitted_for_review','needs_correction','reviewed') then
    raise exception 'Invalid taxpayer profile review status.';
  end if;

  if coalesce(p_bir_route_status, 'unconfirmed') not in ('unconfirmed','software_supplier','esp','both','other') then
    raise exception 'Invalid BIR route status.';
  end if;

  update public.restaurant_taxpayer_profiles
  set profile_status = p_profile_status,
      review_note = nullif(trim(p_review_note), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      bir_route_status = coalesce(p_bir_route_status, 'unconfirmed'),
      bir_accreditation_reference = nullif(trim(p_bir_accreditation_reference), ''),
      bir_permit_to_use_reference = nullif(trim(p_bir_permit_to_use_reference), ''),
      bir_permit_to_transmit_reference = nullif(trim(p_bir_permit_to_transmit_reference), ''),
      approved_software_version = nullif(trim(p_approved_software_version), ''),
      bir_approval_recorded_at = p_bir_approval_recorded_at,
      updated_at = now()
  where restaurant_id = p_restaurant_id
  returning * into v_result;

  if not found then
    raise exception 'Taxpayer profile not found.';
  end if;

  return jsonb_build_object(
    'restaurant_id', v_result.restaurant_id,
    'registered_legal_name', v_result.registered_legal_name,
    'trade_name', v_result.trade_name,
    'tin', v_result.tin,
    'registered_address', v_result.registered_address,
    'branch_code', v_result.branch_code,
    'taxpayer_category', v_result.taxpayer_category,
    'profile_status', v_result.profile_status,
    'review_note', v_result.review_note,
    'reviewed_at', v_result.reviewed_at,
    'bir_route_status', v_result.bir_route_status,
    'bir_accreditation_reference', v_result.bir_accreditation_reference,
    'bir_permit_to_use_reference', v_result.bir_permit_to_use_reference,
    'bir_permit_to_transmit_reference', v_result.bir_permit_to_transmit_reference,
    'approved_software_version', v_result.approved_software_version,
    'bir_approval_recorded_at', v_result.bir_approval_recorded_at
  );
end;
$$;
revoke all on function public.system_admin_review_restaurant_taxpayer_profile(uuid,text,text,text,text,text,text,text,timestamptz) from public, anon;
grant execute on function public.system_admin_review_restaurant_taxpayer_profile(uuid,text,text,text,text,text,text,text,timestamptz) to authenticated;

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
  if not public.is_system_admin_manager() then
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

create or replace function public.system_admin_set_online_payments_enabled(
  p_restaurant_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_methods jsonb;
begin
  if not public.is_system_admin_manager() then
    raise exception 'System Administrator access required.';
  end if;

  if p_enabled is null then
    raise exception 'Online payments enabled status is required.';
  end if;

  select coalesce(online_payment_methods, '{}'::jsonb)
    into v_methods
    from public.restaurants
    where id = p_restaurant_id
    for update;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  update public.restaurants
    set online_payment_methods = jsonb_set(coalesce(v_methods, '{}'::jsonb), '{enabled}', to_jsonb(p_enabled), true)
    where id = p_restaurant_id;

  return p_enabled;
end;
$$;
revoke all on function public.system_admin_set_online_payments_enabled(uuid,boolean) from public, anon;
grant execute on function public.system_admin_set_online_payments_enabled(uuid,boolean) to authenticated;

create or replace function public.protect_system_admin_online_payments_toggle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin_manager()
    and coalesce((new.online_payment_methods ->> 'enabled')::boolean, true)
      is distinct from coalesce((old.online_payment_methods ->> 'enabled')::boolean, true)
  then
    raise exception 'Online payments availability is controlled by the System Administrator.';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_system_admin_online_payments_toggle() from public, anon, authenticated;
