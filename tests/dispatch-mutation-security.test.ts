import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryPath = new URL('../src/modules/dispatch/dispatchRepository.ts', import.meta.url);
const dispatchPagePath = new URL('../src/pages/RestaurantDeliveryDispatchPage.tsx', import.meta.url);
const migrationPath = new URL('../supabase/migrations/20261020195000_secure_dispatch_order_mutations.sql', import.meta.url);

const repository = readFileSync(repositoryPath, 'utf8');
const dispatchPage = readFileSync(dispatchPagePath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8').toLowerCase();

function functionBody(name: string, nextName?: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = nextName
    ? migration.indexOf(`create or replace function public.${nextName}`, start + 1)
    : migration.indexOf('$function$;', start) + '$function$;'.length;
  expect(start, `missing function definition: ${name}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing end boundary for function: ${name}`).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe('dispatch order mutation security boundary', () => {
  const assignment = functionBody('assign_delivery_order', 'complete_dispatch_handoff');
  const handoff = functionBody('complete_dispatch_handoff');

  it('uses narrow RPCs instead of browser-side direct writes', () => {
    expect(repository).toContain("supabase.rpc('assign_delivery_order'");
    expect(repository).toContain("supabase.rpc('complete_dispatch_handoff'");
    expect(repository).not.toMatch(/supabase\\.from\\(['"]orders['"]\\)\\.update\\s*\\(/);
    expect(repository).not.toMatch(/supabase\\.from\\(['"]delivery_assignments['"]\\)\\.(insert|update|delete)\\s*\\(/);
  });

  it('checks authentication, MFA, active dispatcher membership and active restaurant for assignment', () => {
    for (const fragment of [
      'auth.uid() is null',
      'public.privileged_restaurant_mfa_verified()',
      's.auth_user_id = auth.uid()',
      "s.role = 'dispatcher'",
      's.is_active = true',
      'r.is_active = true',
      's.restaurant_id = p_restaurant_id',
    ]) expect(assignment).toContain(fragment);
  });

  it('scopes order and rider lookups to the requested restaurant', () => {
    expect(assignment).toContain('o.restaurant_id = p_restaurant_id');
    expect(assignment).toContain('s.restaurant_id = p_restaurant_id');
    expect(assignment).toContain("s.role = 'rider'");
    expect(assignment).toContain('s.is_active = true');
    expect(assignment).toContain('for update of o');
    expect(assignment).toMatch(/for update;/i);
  });

  it('rejects invalid assignment state and protects against a second active assignment', () => {
    expect(assignment).toContain("v_order.order_type <> 'delivery'");
    expect(assignment).toContain("v_order.status <> 'ready'");
    expect(assignment).toContain('v_order.rider_id is not null');
    expect(assignment).toContain("coalesce(v_order.delivery_status, 'unassigned') <> 'unassigned'");
    expect(assignment).toContain("da.status in ('assigned', 'delivering', 'arrived')");
    expect(assignment).toContain('order state changed during rider assignment; refresh and retry');
    expect(assignment).toContain('using errcode = \'40001\'');
  });

  it('checks authentication, MFA, dispatcher membership and tenant scope for handoff', () => {
    for (const fragment of [
      'auth.uid() is null',
      'public.privileged_restaurant_mfa_verified()',
      's.auth_user_id = auth.uid()',
      "s.role = 'dispatcher'",
      's.is_active = true',
      'r.is_active = true',
      's.restaurant_id = p_restaurant_id',
      'o.restaurant_id = p_restaurant_id',
    ]) expect(handoff).toContain(fragment);
    expect(handoff).toContain("p_order_type not in ('pickup', 'take_out', 'dine_in')");
    expect(handoff).toContain('v_order.order_type <> p_order_type');
    expect(handoff).toContain("v_order.status <> 'ready'");
    expect(handoff).toContain('for update of o');
    expect(handoff).toContain('order state changed during handoff; refresh and retry');
  });

  it('restricts RPC execution to authenticated callers rather than PUBLIC or anon', () => {
    expect(migration).toMatch(/revoke all on function public\\.assign_delivery_order\\(uuid, uuid, uuid\\) from public, anon/);
    expect(migration).toMatch(/grant execute on function public\\.assign_delivery_order\\(uuid, uuid, uuid\\) to authenticated/);
    expect(migration).toMatch(/revoke all on function public\\.complete_dispatch_handoff\\(uuid, uuid, text\\) from public, anon/);
    expect(migration).toMatch(/grant execute on function public\\.complete_dispatch_handoff\\(uuid, uuid, text\\) to authenticated/);
    expect(assignment).toContain('security definer');
    expect(handoff).toContain('security definer');
    expect(assignment).toContain("set search_path to 'public', 'pg_temp'");
    expect(handoff).toContain("set search_path to 'public', 'pg_temp'");
  });

  it('preserves the workflow that allows another delivery to be assigned to a busy rider', () => {
    expect(assignment).not.toContain('the selected rider already has an active delivery assignment');
    expect(dispatchPage).toContain("busy: 'Has active delivery'");
    expect(dispatchPage).toContain("rider.status === 'busy' ? 'Assign Another Order' : 'Assign'");
  });

  it('does not revoke broad orders-table UPDATE privileges in the additive RPC migration', () => {
    expect(migration).not.toMatch(/revoke\\s+update\\s+on\\s+table\\s+public\\.orders/i);
  });
});
