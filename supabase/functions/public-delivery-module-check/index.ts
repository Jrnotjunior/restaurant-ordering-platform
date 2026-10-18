import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-restaurant-domain, x-restaurant-slug",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Module check is unavailable." }, 503);

  let body: { restaurantId?: unknown };
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 2048) return json({ error: "Request too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const restaurantId = String(body.restaurantId ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId)) {
    return json({ error: "Invalid restaurant." }, 400);
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: override, error: overrideError } = await admin
    .from("restaurant_module_overrides")
    .select("enabled")
    .eq("restaurant_id", restaurantId)
    .eq("module_key", "dispatch_delivery")
    .maybeSingle();
  if (overrideError) return json({ error: "Could not check delivery availability." }, 503);
  if (override) return json({ enabled: override.enabled === true });

  const { data: subscription, error: subscriptionError } = await admin
    .from("restaurant_subscriptions")
    .select("package_id")
    .eq("restaurant_id", restaurantId)
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .maybeSingle();
  if (subscriptionError) return json({ error: "Could not check delivery availability." }, 503);
  if (!subscription) return json({ enabled: false });

  const { data: packageModule, error: packageModuleError } = await admin
    .from("system_package_modules")
    .select("module_key")
    .eq("package_id", subscription.package_id)
    .eq("module_key", "dispatch_delivery")
    .maybeSingle();
  if (packageModuleError) return json({ error: "Could not check package modules.", stage: "package_module" }, 503);
  if (!packageModule) return json({ enabled: false });

  const { data: module, error: moduleStatusError } = await admin
    .from("system_modules")
    .select("is_active")
    .eq("module_key", "dispatch_delivery")
    .maybeSingle();
  if (moduleStatusError) return json({ error: "Could not check module status.", stage: "module_status" }, 503);

  return json({ enabled: module?.is_active === true });
});
