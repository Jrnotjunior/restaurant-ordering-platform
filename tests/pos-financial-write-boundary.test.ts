import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repositoryFile = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

const orderRepository = repositoryFile('modules/ordering/orderRepository.ts');
const paymentRepository = repositoryFile('modules/payments/paymentRepository.ts');
const posRepository = repositoryFile('modules/pos/posRepository.ts');
const salesRepository = repositoryFile('modules/sales/salesRepository.ts');
const dispatchRepository = repositoryFile('modules/dispatch/dispatchRepository.ts');
const kitchenRepository = repositoryFile('modules/kitchen/kitchenRepository.ts');

const financialRepositories = [
  ['orderRepository', orderRepository],
  ['paymentRepository', paymentRepository],
  ['posRepository', posRepository],
  ['salesRepository', salesRepository],
] as const;

describe('POS financial write boundary', () => {
  it('does not mutate orders directly from browser repositories', () => {
    for (const [name, source] of financialRepositories) {
      expect(
        source,
        `${name} must use server-validated RPCs/edge functions for order writes`,
      ).not.toMatch(/\.from\(['"]orders['"]\)\s*\.(?:insert|update|upsert|delete)\s*\(/i);
    }
  });

  it('routes order creation, status transitions and cancellation through server boundaries', () => {
    expect(orderRepository).toContain("supabaseRpc<CreatedOrderRow>(rpcName, rpcParams)");
    expect(orderRepository).toContain("supabaseRpc('update_order_status'");
    expect(orderRepository).toContain("'send_order_to_kitchen'");
    expect(orderRepository).toContain("supabase.functions.invoke('cancel-customer-order'");
    expect(orderRepository).toContain("supabase.functions.invoke('cancel-restaurant-order'");
  });

  it('routes online payment creation/status reads through explicit RPCs', () => {
    expect(paymentRepository).toContain("'create_pending_delivery_payment_with_cancel_token'");
    expect(paymentRepository).toContain("'create_pending_online_payment_with_guest_cancel_token'");
    expect(paymentRepository).toContain("supabase.rpc(rpcName, rpcParams)");
    expect(paymentRepository).toContain("supabase.rpc('get_online_payment_status'");
  });

  it('uses server-side payment and discount RPCs for POS financial changes', () => {
    expect(posRepository).toContain("'confirm_pos_cash_payment_with_tender'");
    expect(posRepository).toContain("'confirm_dine_in_payment'");
    expect(posRepository).toContain("'apply_pos_group_discounts'");
    expect(posRepository).not.toMatch(/\.from\(['"]orders['"]\)\s*\.(?:insert|update|upsert|delete)\s*\(/i);
  });

  it('keeps dispatch handoff and kitchen status changes behind their service boundary', () => {
    expect(dispatchRepository).toContain("supabase.rpc('assign_delivery_order'");
    expect(dispatchRepository).toContain("supabase.rpc('complete_dispatch_handoff'");
    expect(kitchenRepository).toContain('await updateOrderStatus(orderId, status)');
    expect(kitchenRepository).toContain('return getRestaurantOrders(restaurantId)');
  });
});
