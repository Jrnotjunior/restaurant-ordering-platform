import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tenantContextMigration = readFileSync(
  new URL('../supabase/migrations/20261023020000_fail_closed_tenant_domain_context.sql', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

describe('tenant-domain isolation regression contract', () => {
  it('fails closed for unknown Web2Table tenant subdomains instead of trusting a forged slug', () => {
    expect(tenantContextMigration).toContain("v_domain like '%.web2table.io'");
    expect(tenantContextMigration).toContain("v_domain <> 'app.web2table.io'");
    expect(tenantContextMigration).toMatch(/if v_domain like '[^']*web2table\.io'[\s\S]*?return null;/);
    expect(tenantContextMigration).toContain('if v_slug <>');
  });

  it('keeps management routes off tenant storefront subdomains', () => {
    expect(appSource).toContain("hostname.endsWith('.web2table.io')");
    expect(appSource).toContain("hostname !== 'app.web2table.io'");
    expect(appSource).toContain("route.startsWith('#restaurant/')");
    expect(appSource).toContain("route.startsWith('#rider/')");
    expect(appSource).toContain("destination.hostname = 'app.web2table.io'");
    expect(appSource).toContain('window.location.replace(destination.toString())');
  });
});
