import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const secret = () => { const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); return keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""; };
const paymongoKey = () => Deno.env.get("PAYMONGO_LIVE_SECRET_KEY") ?? ((Deno.env.get("PAYMONGO_SECRET_KEY") ?? "").startsWith("sk_live_") ? Deno.env.get("PAYMONGO_SECRET_KEY") ?? "" : "");

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const jwt = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "", serviceRoleKey = secret(), key = paymongoKey();
    if (!jwt || !serviceRoleKey) return json({ error: "Authentication is required." }, 401);
    if (!key) return json({ error: "PayMongo live mode is not configured yet." }, 409);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const auth = createClient(supabaseUrl, serviceRoleKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData, error: userError } = await auth.auth.getUser();
    if (userError || !userData.user) return json({ error: "Authentication is required." }, 401);
    const body = await request.json().catch(() => ({})), restaurantId = String(body.restaurantId ?? "").trim();
    if (!restaurantId) return json({ error: "Restaurant is required." }, 400);
    const { data: restaurant, error: restaurantError } = await admin.from("restaurants").select("id,owner_id").eq("id", restaurantId).maybeSingle();
    if (restaurantError) throw restaurantError;
    if (!restaurant || restaurant.owner_id !== userData.user.id) return json({ error: "You do not have access to this restaurant." }, 403);
    const { data: connection, error: connectionError } = await admin.from("restaurant_paymongo_accounts")
      .select("paymongo_account_id,connection_status,activation_status,verification_url,identity_verification_status,onboarding_step,last_error")
      .eq("restaurant_id", restaurantId).eq("environment", "live").maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.paymongo_account_id) return json({ error: "PayMongo onboarding has not been started." }, 409);
    const response = await fetch(`https://api.paymongo.com/v2/accounts/${encodeURIComponent(connection.paymongo_account_id)}`, { headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: "application/json" } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.errors?.[0]?.detail;
      return json({ error: typeof detail === "string" ? detail : "Unable to read the PayMongo child account." }, 502);
    }
    const attrs = payload?.data?.attributes ?? {};
    const activationStatus = String(attrs.activation_status ?? "").trim() || null;
    const identityStatus = String(attrs.person?.identity_verification_status ?? "").trim() || null;
    let onboardingStep = connection.onboarding_step ?? "identity_verification";
    if (activationStatus === "activated") onboardingStep = "active";
    else if (identityStatus === "passed" || identityStatus === "passed_attestation_form") onboardingStep = "business_information";
    else if (identityStatus === "failed") onboardingStep = "identity_verification";
    const connectionStatus = activationStatus === "activated" ? "active" : "pending";
    const { error: updateError } = await admin.from("restaurant_paymongo_accounts").update({ connection_status: connectionStatus, activation_status: activationStatus, identity_verification_status: identityStatus, onboarding_step: onboardingStep, last_error: null }).eq("restaurant_id", restaurantId).eq("environment", "live");
    if (updateError) throw updateError;
    return json({ status: connectionStatus, paymongoAccountId: connection.paymongo_account_id, activationStatus, identityVerificationStatus: identityStatus, onboardingStep, verificationUrl: connection.verification_url, account: { person: attrs.person ?? null, business: attrs.business ?? null } });
  } catch (error) {
    console.error("sync-paymongo-child-account error", error);
    return json({ error: "Unable to synchronize PayMongo merchant onboarding." }, 500);
  }
});
