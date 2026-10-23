-- Gated BIR document issuance groundwork.
-- This migration creates storage and controls only. There is deliberately no
-- public invoice-issuance RPC or enabled sequence; official issue flow remains disabled
-- until the confirmed BIR route, per-tenant authorization, template and tax rules are approved.

create table if not exists public.restaurant_invoice_issuance_configs (
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  branch_code text not null default '',
  document_type text not null
    check (document_type in ('invoice','sales_invoice','cash_invoice','credit_invoice','service_invoice')),
  issuance_enabled boolean not null default false,
  next_serial bigint,
  initial_serial bigint,
  regulatory_route text not null default 'unconfirmed'
    check (regulatory_route in ('unconfirmed','software_supplier','esp','both','other')),
  approval_reference text,
  approval_verified_at timestamptz,
  configured_by uuid,
  configured_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, branch_code, document_type),
  constraint invoice_sequence_next_serial_positive check (next_serial is null or next_serial > 0),
  constraint invoice_sequence_initial_serial_positive check (initial_serial is null or initial_serial > 0),
  constraint invoice_issuance_requires_serial check (
    issuance_enabled = false or (next_serial is not null and initial_serial is not null)
  ),
  constraint invoice_issuance_requires_verified_route check (
    issuance_enabled = false or (
      regulatory_route in ('software_supplier','esp','both')
      and nullif(trim(approval_reference), '') is not null
      and approval_verified_at is not null
      and configured_by is not null
      and configured_at is not null
    )
  )
);

comment on table public.restaurant_invoice_issuance_configs is
  'Per-tenant/branch/document-type issuance gate and serial cursor. This migration creates no enabled rows; do not enable until the BIR route, registration/permit, invoice form and financial rules are verified.';
comment on column public.restaurant_invoice_issuance_configs.next_serial is
  'Next serial reserved for a future approved issuance RPC. NULL means the serial series has not been configured; never infer it from order_number.';
comment on column public.restaurant_invoice_issuance_configs.approval_reference is
  'Reference verified by the System Administrator against the actual official approval/permit document applicable to the selected route. A text value by itself is not proof of approval.';

create table if not exists public.issued_sales_documents (
  issued_document_id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  branch_code text not null default '',
  document_type text not null
    check (document_type in ('invoice','sales_invoice','cash_invoice','credit_invoice','service_invoice')),
  serial_number bigint not null check (serial_number > 0),
  serial_label text not null check (serial_label ~ '^[0-9]{6,}$'),
  issued_at timestamptz not null,
  issued_by uuid,
  seller_snapshot jsonb not null,
  buyer_snapshot jsonb not null default '{}'::jsonb,
  line_items_snapshot jsonb not null,
  financial_snapshot jsonb not null,
  document_payload_version smallint not null default 1 check (document_payload_version > 0),
  rendering_sha256 text,
  created_at timestamptz not null default now(),
  constraint issued_sales_documents_serial_unique
    unique (restaurant_id, branch_code, document_type, serial_number),
  constraint issued_sales_documents_order_type_unique
    unique (order_id, document_type)
);

comment on table public.issued_sales_documents is
  'Append-only snapshot store for future approved official sales documents. No rows are issued by this migration and no issuance API is exposed here.';
comment on column public.issued_sales_documents.serial_number is
  'Numeric document serial, independent from the operational ORD- order number. Display serial must contain at least six digits for the applicable Sales Machine/Software route.';
comment on column public.issued_sales_documents.seller_snapshot is
  'Registered seller identity frozen at issue time; must be sourced from the verified taxpayer profile.';
comment on column public.issued_sales_documents.financial_snapshot is
  'Frozen order/tax/discount totals and calculation provenance as of issuance, not a live join to mutable order values.';

create table if not exists public.issued_sales_document_events (
  document_event_id bigint generated always as identity primary key,
  issued_document_id uuid not null references public.issued_sales_documents(issued_document_id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  event_type text not null
    check (event_type in ('REPRINTED','VOIDED','REFUND_LINKED','CREDIT_ADJUSTMENT_ISSUED','DEBIT_ADJUSTMENT_ISSUED')),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  reason text,
  related_document_id uuid references public.issued_sales_documents(issued_document_id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists issued_sales_documents_restaurant_issued_at_idx
  on public.issued_sales_documents (restaurant_id, issued_at desc);
create index if not exists issued_sales_documents_order_idx
  on public.issued_sales_documents (order_id);
create index if not exists issued_sales_document_events_document_time_idx
  on public.issued_sales_document_events (issued_document_id, occurred_at desc);

alter table public.restaurant_invoice_issuance_configs enable row level security;
alter table public.issued_sales_documents enable row level security;
alter table public.issued_sales_document_events enable row level security;

revoke all on table public.restaurant_invoice_issuance_configs from public, anon, authenticated, service_role;
revoke all on table public.issued_sales_documents from public, anon, authenticated, service_role;
revoke all on table public.issued_sales_document_events from public, anon, authenticated, service_role;

create or replace function public.prevent_issued_sales_document_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Issued sales documents are immutable; record corrections as a void or adjustment event.';
end;
$$;

revoke all on function public.prevent_issued_sales_document_mutation() from public, anon, authenticated, service_role;
drop trigger if exists prevent_issued_sales_document_mutation on public.issued_sales_documents;
create trigger prevent_issued_sales_document_mutation
before update or delete on public.issued_sales_documents
for each row execute function public.prevent_issued_sales_document_mutation();

create or replace function public.prevent_issued_sales_document_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Issued-document events are append-only.';
end;
$$;

revoke all on function public.prevent_issued_sales_document_event_mutation() from public, anon, authenticated, service_role;
drop trigger if exists prevent_issued_sales_document_event_mutation on public.issued_sales_document_events;
create trigger prevent_issued_sales_document_event_mutation
before update or delete on public.issued_sales_document_events
for each row execute function public.prevent_issued_sales_document_event_mutation();

-- Deliberately no INSERT/UPDATE/DELETE grants, no enabled sequence rows, and no
-- invoice issuance RPC are provided by this migration. A later route-specific change
-- must implement verified System Admin configuration, serial allocation, authorization,
-- idempotency, complete tax classifications, void/reprint rules and approved rendering.
