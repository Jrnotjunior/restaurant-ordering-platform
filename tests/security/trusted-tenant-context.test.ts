import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tenantContextMigration = readFileSync(
  new URL('../../supabase/migrations/0090_customer_tenant_context.sql', import.meta.url),
  'utf8',
);

describe('trusted tenant context regression guard', () => {
  it('does not authorize a tenant using caller-controlled request headers', () => {
    const resolverStart = tenantContextMigration.indexOf(
      'create or replace function public.get_request_restaurant_id()',
    );
    expect(resolverStart).toBeGreaterThanOrEqual(0);

    const resolverEnd = tenantContextMigration.indexOf(
      '\n$$;',
      resolverStart,
    );
    expect(resolverEnd).toBeGreaterThan(resolverStart);

    const resolver = tenantContextMigration.slice(resolverStart, resolverEnd);

    // This intentionally fails against the current implementation: it reads
    // caller-supplied x-restaurant-domain / x-restaurant-slug values and uses
    // them to select the tenant. Keep this red until the trust boundary changes.
    expect(resolver).not.toContain("v_headers ->> 'x-restaurant-domain'");
    expect(resolver).not.toContain("v_headers ->> 'x-restaurant-slug'");
  });

  it('documents why matching an RPC tenant parameter to the resolver is not independent authorization', () => {
    const headerResolver = tenantContextMigration.includes(
      "v_headers ->> 'x-restaurant-domain'",
    );
    const rpcGuard = tenantContextMigration.includes(
      'p_restaurant_id <> public.get_request_restaurant_id()',
    );

    // If both are present, the RPC check depends on the same caller-controlled
    // context it is meant to validate. This guard is expected to fail until
    // an independent trusted context or explicit membership check is in place.
    expect(headerResolver && rpcGuard).toBe(false);
  });
});
