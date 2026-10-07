import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
function serviceKey() {
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
function paymongoKey() {
  return Deno.env.get("PAYMONGO_LIVE_SECRET_KEY")
    ?? ((Deno.env.get("PAYMONGO_SECRET_KEY") ?? "").startsWith("sk_live_")
      ? Deno.env.get("PAYMONGO_SECRET_KEY") ?? "" : "");
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const jwt = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const url = Deno.env.get("SUPABASE_URL") ?? "", sk = serviceKey(), key = paymongoKey();
    if (!jwt || !sk) return json({ error: "Authentication is required." }, 401);
    if (!key) return json({ error: "PayMongo live mode is not configured yet." }, 409);
    const admin = createClient(url, sk, { auth: { autoRefreshToken: false, persistSession: false } });
    const auth = createClient(url, sk, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData, error: userError } = await auth.auth.getUser();
    if (userError || !userData.user) return json({ error: "Authentication is required." }, 401);
    const body = await request.json().catch(() => ({}));
    const restaurantId = String(body.restaurantId ?? "").trim();
    if (!restaurantId) return json({ error: "Restaurant is required." }, 400);
    const { data: restaurant } = await admin.from("restaurants").select("id,owner_id").eq("id", restaurantId).maybeSingle();
    if (!restaurant || restaurant.owner_id !== userData.user.id) return json({ error: "You do not have access to this restaurant." }, 403);
    const { data: connection, error: ce } = await admin.from("restaurant_paymongo_accounts")
      .select("paymongo_account_id,connection_status,activation_status,onboarding_step").eq("restaurant_id", restaurantId).eq("environment", "live").maybeSingle();
    if (ce) throw ce;
    if (!connection?.paymongo_account_id) return json({ error: "PayMongo onboarding has not been started." }, 409);
    if (connection.connection_status === "active") return json({ status: "active", paymongoAccountId: connection.paymongo_account_id });
    const accountId = connection.paymongo_account_id;
    const response = await fetch(`https://api.paymongo.com/v2/accounts/${encodeURIComponent(accountId)}/activate`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: "application/json", "Content-Type": "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errors = Array.isArray(payload?.errors) ? payload.errors : [];
      const detail = errors[0]?.detail;
      const missing = errors.map((e: any) => e?.source?.pointer).filter(Boolean);
      await admin.from("restaurant_paymongo_accounts").update({ onboarding_step: "activation", last_error: typeof detail === "string" ? detail : "PayMongo activation requirements are incomplete." }).eq("restaurant_id", restaurantId).eq("environment", "live");
      return json({ error: typeof detail === "string" ? detail : "PayMongo activation requirements are incomplete.", missing }, 409);
    }
    const attrs = payload?.data?.attributes ?? {};
    await admin.from("restaurant_paymongo_accounts").update({
      activation_status: String(attrs.activation_status ?? "activated"),
      onboarding_step: "activation",
      last_error: null,
    }).eq("restaurant_id", restaurantId).eq("environment", "live");
    return json({ status: "pending", paymongoAccountId: accountId, activationStatus: attrs.activation_status ?? "activated", message: "Activation was submitted. Refresh the status after PayMongo processes the account." });
  } catch (error) {
    console.error("activate-paymongo-child-account error", error);
    return json({ error: "Unable to activate the PayMongo merchant account." }, 500);
  }
});