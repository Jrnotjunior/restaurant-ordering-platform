import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-restaurant-domain, x-restaurant-slug",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSecretKey() {
  const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return keys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function getPayMongoSecretKey() {
  return Deno.env.get("PAYMONGO_LIVE_SECRET_KEY")
    ?? ((Deno.env.get("PAYMONGO_SECRET_KEY") ?? "").startsWith("sk_live_")
      ? Deno.env.get("PAYMONGO_SECRET_KEY") ?? ""
      : "");
}

function authHeader(key: string) {
  return `Basic ${btoa(`${key}:`)}`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const jwt = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = getSecretKey();
    const paymongoKey = getPayMongoSecretKey();

    if (!jwt || !supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Authentication is required." }, 401);
    if (!paymongoKey) return jsonResponse({ error: "PayMongo live mode is not configured yet." }, 409);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const auth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await auth.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ error: "Authentication is required." }, 401);

    const body = await request.json().catch(() => ({}));
    const restaurantId = String(body.restaurantId ?? "").trim();
    if (!restaurantId) return jsonResponse({ error: "Restaurant is required." }, 400);

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants").select("id,owner_id").eq("id", restaurantId).maybeSingle();
    if (restaurantError) throw restaurantError;
    if (!restaurant || restaurant.owner_id !== userData.user.id) return jsonResponse({ error: "You do not have access to this restaurant." }, 403);

    const { data: existing, error: existingError } = await admin
      .from("restaurant_paymongo_accounts")
      .select("paymongo_account_id,connection_status,activation_status,verification_url,identity_verification_status,onboarding_step,last_error")
      .eq("restaurant_id", restaurantId).eq("environment", "live").maybeSingle();
    if (existingError) throw existingError;

    if (existing?.connection_status === "active" && existing.paymongo_account_id) {
      return jsonResponse({ status: "active", paymongoAccountId: existing.paymongo_account_id, activationStatus: existing.activation_status, onboardingStep: "active" });
    }

    let accountId = String(existing?.paymongo_account_id ?? "").trim();
    let verificationUrl = String(existing?.verification_url ?? "").trim();

    if (!accountId) {
      const response = await fetch("https://api.paymongo.com/v2/accounts", {
        method: "POST",
        headers: {
          Authorization: authHeader(paymongoKey),
          "Content-Type": "application/json",
          "Idempotency-Key": `web2table-child-account-${restaurantId}-live`,
        },
        body: JSON.stringify({ type: "merchant" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.errors?.[0]?.detail;
        return jsonResponse({ error: typeof detail === "string" ? detail : `PayMongo child account creation returned HTTP ${response.status}.` }, 502);
      }

      accountId = String(payload?.data?.id ?? "").trim();
      if (!accountId) return jsonResponse({ error: "PayMongo did not return a child account ID." }, 502);

      const { error } = await admin.from("restaurant_paymongo_accounts").upsert({
        restaurant_id: restaurantId,
        environment: "live",
        paymongo_account_id: accountId,
        connection_status: "pending",
        onboarding_method: "create_account",
        onboarding_step: "identity_verification",
        activation_status: String(payload?.data?.attributes?.activation_status ?? "pending"),
        invitation_id: null,
        invitation_email: null,
        verification_url: null,
        identity_verification_status: String(payload?.data?.attributes?.person?.identity_verification_status ?? "pending"),
        last_error: null,
      }, { onConflict: "restaurant_id,environment" });
      if (error) throw error;
    }

    if (!verificationUrl) {
      const response = await fetch(`https://api.paymongo.com/v2/accounts/${encodeURIComponent(accountId)}/identity_verification`, {
        method: "POST",
        headers: {
          Authorization: authHeader(paymongoKey),
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": `web2table-child-verification-${restaurantId}-live`,
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = payload?.errors?.[0]?.detail;
        await admin.from("restaurant_paymongo_accounts").update({
          last_error: typeof detail === "string" ? detail : `Identity verification returned HTTP ${response.status}.`,
          onboarding_step: "identity_verification",
        }).eq("restaurant_id", restaurantId).eq("environment", "live");
        return jsonResponse({ error: typeof detail === "string" ? detail : `PayMongo identity verification returned HTTP ${response.status}.`, paymongoAccountId: accountId }, 502);
      }

      verificationUrl = String(
        payload?.data?.attributes?.url
        ?? payload?.data?.attributes?.verification_url
        ?? payload?.data?.attributes?.hosted_url
        ?? ""
      ).trim();
      if (!verificationUrl) return jsonResponse({ error: "PayMongo created the identity verification session but did not return a verification URL.", paymongoAccountId: accountId }, 502);

      const { error } = await admin.from("restaurant_paymongo_accounts").update({
        verification_url: verificationUrl,
        onboarding_step: "identity_verification",
        last_error: null,
      }).eq("restaurant_id", restaurantId).eq("environment", "live");
      if (error) throw error;
    }

    return jsonResponse({
      status: "pending",
      paymongoAccountId: accountId,
      activationStatus: existing?.activation_status ?? "pending",
      identityVerificationStatus: existing?.identity_verification_status ?? "pending",
      onboardingStep: "identity_verification",
      verificationUrl,
    });
  } catch (error) {
    console.error("create-paymongo-child-account error", error);
    return jsonResponse({ error: "Unable to start PayMongo merchant onboarding." }, 500);
  }
});
