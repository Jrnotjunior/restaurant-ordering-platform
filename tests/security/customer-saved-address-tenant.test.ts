import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("customer saved-address tenant authorization", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/20261023220000_guard_customer_saved_address_tenant.sql"), "utf8");
  const functions = [
    "get_my_customer_addresses",
    "save_my_customer_address",
    "update_my_customer_address",
    "save_my_default_delivery_address",
    "set_my_customer_address_default",
    "get_my_customer_profile",
  ];

  it.each(functions)("checks single-tenant identity in %s", (name) => {
    const start = migration.indexOf(`function public.${name}(`);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = migration.indexOf("create or replace function public.", start + 1);
    const body = migration.slice(start, next === -1 ? migration.length : next);
    expect(body).toContain("customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)");
    expect(body).toContain("auth.uid() is null");
  });

  it("does not use request headers as the sole tenant authorization check", () => {
    for (const name of functions) {
      const start = migration.indexOf(`function public.${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      const next = migration.indexOf("create or replace function public.", start + 1);
      const body = migration.slice(start, next === -1 ? migration.length : next);
      expect(body).toContain("customer_identity_is_single_tenant(auth.uid(), p_restaurant_id)");
    }
  });
});
