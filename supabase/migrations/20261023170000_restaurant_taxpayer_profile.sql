-- Tenant taxpayer identity profile for the selected BIR/POS route.
-- This is registration-data capture only. It does not authorize invoice issuance.

create table if not exists public.restaurant_taxpayer_profiles (
  restaurant_id uuid primary key references public.restaurants(id) on delete restrict,
  registered_legal_name text,
  trade_name text,
  tin text,
  registered_address text,
  branch_code text,
  taxpayer_category text not null default 'unknown'
    check (taxpayer_category in ('micro','small','medium','large','large_taxpayer','unknown')),
  profile_status text not null default 'draft'
    check (profile_status in ('draft','submitted_for_review','needs_correction','reviewed')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  bir_route_status text not null default 'unconfirmed'
    check (bir_route_status in ('unconfirmed','software_supplier','esp','both','other')),
  bir_accreditation_reference text,
  bir_permit_to_use_reference text,
  bir_permit_to_transmit_reference text,
  approved_software_version text,
  bir_approval_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_taxpayer_legal_name_length check (registered_legal_name is null or length(registered_legal_name) <= 250),
  constraint restaurant_taxpayer_trade_name_length check (trade_name is null or length(trade_name) <= 250),
  constraint restaurant_taxpayer_tin_length check (tin is null or length(tin) <= 64),
  constraint restaurant_taxpayer_address_length check (registered_address is null or length(registered_address) <= 1000),
  constraint restaurant_taxpayer_branch_code_length check (branch_code is null or length(branch_code) <= 64)
);

comment on table public.restaurant_taxpayer_profiles is
  'Restricted tenant taxpayer-registration profile. A reviewed profile is not proof of BIR accreditation and cannot by itself authorize official invoice issuance.';
comment on column public.restaurant_taxpayer_profiles.profile_status is
  'Platform review workflow only: draft, submitted_for_review, needs_correction, reviewed. This is not a BIR approval state.';
comment on column public.restaurant_taxpayer_profiles.bir_route_status is
  'System Admin records the intended/confirmed regulatory route only after verification. unconfirmed must remain until BIR guidance is received.';
comment on column public.restaurant_taxpayer_profiles.bir_accreditation_reference is
  'Reference to verified supplier/software or ESP accreditation evidence, if applicable; do not populate from unverified claims.';
comment on column public.restaurant_taxpayer_profiles.bir_permit_to_use_reference is
  'Tenant-user PTU reference, if applicable for the confirmed route.';
comment on column public.restaurant_taxpayer_profiles.bir_permit_to_transmit_reference is
  'EIS/E-Invoice Permit to Transmit reference, if applicable for the confirmed route.';

alter table public.restaurant_taxpayer_profiles enable row level security;
revoke all on table public.restaurant_taxpayer_profiles from public, anon, authenticated, service_role;

create or replace function public.get_restaurant_taxpayer_profile(p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, pg_temp
as $$
declare
  v_profile public.restaurant_taxpayer_profiles%rowtype;
begin
  if not (
    public.is_system_admin()
    or exists (
      select 1 from public.restaurants r
      where r.id = p_restaurant_id and r.owner_id = auth.uid()
    )
  ) then
    raise exception 'You are not authorized to view this taxpayer profile.';
  end if;

  select * into v_profile
  from public.restaurant_taxpayer_profiles
  where restaurant_id = p_restaurant_id;

  if not found then
    return jsonb_build_object(
      'restaurant_id', p_restaurant_id,
      'registered_legal_name', null,
      'trade_name', null,
      'tin', null,
      'registered_address', null,
      'branch_code', null,
      'taxpayer_category', 'unknown',
      'profile_status', 'draft',
      'review_note', null,
      'reviewed_at', null,
      'bir_route_status', 'unconfirmed',
      'bir_accreditation_reference', null,
      'bir_permit_to_use_reference', null,
      'bir_permit_to_transmit_reference', null,
      'approved_software_version', null,
      'bir_approval_recorded_at', null
    );
  end if;

  return jsonb_build_object(
    'restaurant_id', v_profile.restaurant_id,
    'registered_legal_name', v_profile.registered_legal_name,
    'trade_name', v_profile.trade_name,
    'tin', v_profile.tin,
    'registered_address', v_profile.registered_address,
    'branch_code', v_profile.branch_code,
    'taxpayer_category', v_profile.taxpayer_category,
    'profile_status', v_profile.profile_status,
    'review_note', v_profile.review_note,
    'reviewed_at', v_profile.reviewed_at,
    'bir_route_status', v_profile.bir_route_status,
    'bir_accreditation_reference', v_profile.bir_accreditation_reference,
    'bir_permit_to_use_reference', v_profile.bir_permit_to_use_reference,
    'bir_permit_to_transmit_reference', v_profile.bir_permit_to_transmit_reference,
    'approved_software_version', v_profile.approved_software_version,
    'bir_approval_recorded_at', v_profile.bir_approval_recorded_at
  );
end;
$$;

revoke all on function public.get_restaurant_taxpayer_profile(uuid) from public, anon;
grant execute on function public.get_restaurant_taxpayer_profile(uuid) to authenticated;

create or replace function public.save_restaurant_taxpayer_profile(
  p_restaurant_id uuid,
  p_registered_legal_name text,
  p_trade_name text,
  p_tin text,
  p_registered_address text,
  p_branch_code text,
  p_taxpayer_category text,
  p_submit_for_review boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_status text;
  v_result public.restaurant_taxpayer_profiles%rowtype;
  v_category text := coalesce(nullif(trim(p_taxpayer_category), ''), 'unknown');
  v_legal_name text := nullif(trim(p_registered_legal_name), '');
  v_trade_name text := nullif(trim(p_trade_name), '');
  v_tin text := nullif(trim(p_tin), '');
  v_address text := nullif(trim(p_registered_address), '');
  v_branch_code text := nullif(trim(p_branch_code), '');
begin
  select owner_id into v_owner_id
  from public.restaurants
  where id = p_restaurant_id;

  if not found then
    raise exception 'Restaurant not found.';
  end if;

  if not (public.is_system_admin() or v_owner_id = auth.uid()) then
    raise exception 'Only this restaurant owner or the System Administrator can save taxpayer registration details.';
  end if;

  if v_category not in ('micro','small','medium','large','large_taxpayer','unknown') then
    raise exception 'Choose a valid taxpayer category.';
  end if;

  if p_submit_for_review is true then
    if v_legal_name is null or v_tin is null or v_address is null then
      raise exception 'Enter the registered legal name, TIN and registered address before submitting for review.';
    end if;
    v_status := 'submitted_for_review';
  else
    v_status := 'draft';
  end if;

  insert into public.restaurant_taxpayer_profiles (
    restaurant_id, registered_legal_name, trade_name, tin, registered_address,
    branch_code, taxpayer_category, profile_status, review_note, reviewed_by, reviewed_at, updated_at
  ) values (
    p_restaurant_id, v_legal_name, v_trade_name, v_tin, v_address,
    v_branch_code, v_category, v_status, null, null, null, now()
  )
  on conflict (restaurant_id) do update set
    registered_legal_name = excluded.registered_legal_name,
    trade_name = excluded.trade_name,
    tin = excluded.tin,
    registered_address = excluded.registered_address,
    branch_code = excluded.branch_code,
    taxpayer_category = excluded.taxpayer_category,
    profile_status = excluded.profile_status,
    review_note = null,
    reviewed_by = null,
    reviewed_at = null,
    updated_at = now()
  returning * into v_result;

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

revoke all on function public.save_restaurant_taxpayer_profile(uuid,text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.save_restaurant_taxpayer_profile(uuid,text,text,text,text,text,text,boolean) to authenticated;

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
  if not public.is_system_admin() then
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
