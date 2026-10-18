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
  if (!url || !key) return json({ error: "Module check is unavailable.", stage: "configuration" }, 503);

  let body: { restaurantId?: unknown };
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > 2048) return json({ error: "Request too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid request.", stage: "body" }, 400);
  }

  const restaurantId = String(body.restaurantId ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId)) {
    return json({ error: "Invalid restaurant.", stage: "restaurant_id", receivedType: typeof body.restaurantId }, 400);
  }

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Use the existing SECURITY DEFINER database function instead of querying
  // protected tables directly; service_role currently lacks SELECT grants on
  // restaurant_module_overrides in this project.
  const { data: enabled, error } = await admin.rpc("public_restaurant_has_module", {
    p_restaurant_id: restaurantId,
    p_module_key: "dispatch_delivery",
  });
  if (error) {
    console.error("public_restaurant_has_module failed", { code: error.code, message: error.message });
    return json({ error: "Could not check delivery availability.", stage: "module_rpc" }, 503);
  }

  return json({ enabled: enabled === true });
});
