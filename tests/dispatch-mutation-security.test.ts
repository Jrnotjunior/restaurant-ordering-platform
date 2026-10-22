import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryPath = new URL('../src/modules/dispatch/dispatchRepository.ts', import.meta.url);
const dispatchPagePath = new URL('../src/pages/RestaurantDeliveryDispatchPage.tsx', import.meta.url);
const migrationPath = new URL('../supabase/migrations/20261020195000_secure_dispatch_order_mutations.sql', import.meta.url);

const repository = readFileSync(repositoryPath, 'utf8');
const dispatchPage = readFileSync(dispatchPagePath, 'utf8');
const migration = readFileSync(migrationPath, 'utf8').toLowerCase();

describe('dispatch order mutation security boundary', () => {
  it('uses narrow RPCs instead of browser-side direct writes', () => {
    expect(repository).toContain("supabase.rpc('assign_delivery_order'");
    expect(repository).toContain("supabase.rpc('complete_dispatch_handoff'");
    expect(repository).not.toMatch(/supabase\.from\(['"]orders['"]\)\.update\s*\(/);
    expect(repository).not.toMatch(/supabase\.from\(['"]delivery_assignments['"]\)\.(insert|update|delete)\s*\(/);
  });

  it('validates assignment identity, MFA, dispatcher role, order state and active rider in the database', () => {
    const assignmentStart = migration.indexOf('create or replace function public.assign_delivery_order');
    const handoffStart = migration.indexOf('create or replace function public.complete_dispatch_handoff');
    expect(assignmentStart).toBeGreaterThanOrEqual(0);
    expect(handoffStart).toBeGreaterThan(assignmentStart);

    const assignment = migration.slice(assignmentStart, handoffStart);
    expect(assignment).toContain('security definer');
    expect(assignment).toContain('auth.uid()');
    expect(assignment).toContain('public.privileged_restaurant_mfa_verified()');
    expect(assignment).toContain("s.role = 'dispatcher'");
    expect(assignment).toContain("v_order.order_type <> 'delivery'");
    expect(assignment).toContain("v_order.status <> 'ready'");
    expect(assignment).toContain("s.role = 'rider'");
    expect(assignment).toMatch(/for update of o/i);
    expect(assignment).toMatch(/for update;/i);
    expect(migration).toContain('revoke all on function public.assign_delivery_order');
    expect(migration).toContain('grant execute on function public.assign_delivery_order');
  });

  it('validates dispatcher identity, MFA, allowed handoff type and ready state before completing handoff', () => {
    const handoffStart = migration.indexOf('create or replace function public.complete_dispatch_handoff');
    expect(handoffStart).toBeGreaterThanOrEqual(0);
    const handoff = migration.slice(handoffStart);

    expect(handoff).toContain('security definer');
    expect(handoff).toContain('auth.uid()');
    expect(handoff).toContain('public.privileged_restaurant_mfa_verified()');
    expect(handoff).toContain("s.role = 'dispatcher'");
    expect(handoff).toContain("p_order_type not in ('pickup', 'take_out', 'dine_in')");
    expect(handoff).toContain("v_order.status <> 'ready'");
    expect(handoff).toContain('revoke all on function public.complete_dispatch_handoff');
    expect(handoff).toContain('grant execute on function public.complete_dispatch_handoff');
  });

  it('preserves the workflow that allows another delivery to be assigned to a busy rider', () => {
    expect(migration).not.toContain('the selected rider already has an active delivery assignment');
    expect(dispatchPage).toContain("busy: 'Has active delivery'");
    expect(dispatchPage).toContain("rider.status === 'busy' ? 'Assign Another Order' : 'Assign'");
  });

  it('does not revoke broad orders-table UPDATE privileges in the additive RPC migration', () => {
    expect(migration).not.toMatch(/revoke\s+update\s+on\s+table\s+public\.orders/i);
    expect(migration).toMatch(/revoke\s+all\s+on\s+function\s+public\.assign_delivery_order/i);
    expect(migration).toMatch(/revoke\s+all\s+on\s+function\s+public\.complete_dispatch_handoff/i);
  });
});
