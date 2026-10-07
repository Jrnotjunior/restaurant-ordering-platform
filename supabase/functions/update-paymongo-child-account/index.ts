import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
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

async function authenticate(request: Request) {
  const jwt = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = serviceKey();
  if (!jwt || !url || !key) throw new Error("Authentication is required.");
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const auth = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) throw new Error("Authentication is required.");
  return { admin, userId: data.user.id, url, key: paymongoKey() };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { admin, userId, key } = await authenticate(request);
    if (!key) return json({ error: "PayMongo live mode is not configured yet." }, 409);
    const body = await request.json().catch(() => ({}));
    const restaurantId = String(body.restaurantId ?? "").trim();
    const person = body.person && typeof body.person === "object" ? body.person : null;
    const business = body.business && typeof body.business === "object" ? body.business : null;
    if (!restaurantId) return json({ error: "Restaurant is required." }, 400);
    if (!person && !business) return json({ error: "Onboarding information is required." }, 400);

    const { data: restaurant, error: restaurantError } = await admin.from("restaurants")
      .select("id,owner_id").eq("id", restaurantId).maybeSingle();
    if (restaurantError) throw restaurantError;
    if (!restaurant || restaurant.owner_id !== userId) return json({ error: "You do not have access to this restaurant." }, 403);

    const { data: connection, error: connectionError } = await admin.from("restaurant_paymongo_accounts")
      .select("paymongo_account_id,connection_status,activation_status,identity_verification_status,onboarding_step,onboarding_data")
      .eq("restaurant_id", restaurantId).eq("environment", "live").maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.paymongo_account_id) return json({ error: "PayMongo onboarding has not been started." }, 409);
    if (connection.connection_status === "active") return json({ error: "This PayMongo account is already active." }, 409);

    const payloadBody: Record<string, unknown> = {};
    if (person) payloadBody.person = person;
    if (business) payloadBody.business = business;

    const response = await fetch(`https://api.paymongo.com/v2/accounts/${encodeURIComponent(connection.paymongo_account_id)}`, {
      method: "PATCH",
      headers: {
        Authorization: `Basic ${btoa(`${key}:`)}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payloadBody),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.errors?.[0]?.detail;
      const code = payload?.errors?.[0]?.code;
      return json({ error: typeof detail === "string" ? detail : "PayMongo rejected the onboarding information.", ...(code ? { code } : {}) }, 502);
    }

    const attrs = payload?.data?.attributes ?? {};
        const { error: updateError } = await admin.from("restaurant_paymongo_accounts").update({
      activation_status: String(attrs.activation_status ?? connection.activation_status ?? "").trim() || null,
      identity_verification_status: String(attrs.person?.identity_verification_status ?? connection.identity_verification_status ?? "").trim() || null,
      onboarding_step: "activation",
      last_error: null,
    }).eq("restaurant_id", restaurantId).eq("environment", "live");
    if (updateError) throw updateError;

    return json({
      status: "pending",
      paymongoAccountId: connection.paymongo_account_id,
      onboardingStep: "activation",
      activationStatus: attrs.activation_status ?? connection.activation_status ?? null,
      identityVerificationStatus: attrs.person?.identity_verification_status ?? connection.identity_verification_status ?? null,
      account: { person: attrs.person ?? null, business: attrs.business ?? null },
    });
  } catch (error) {
    console.error("update-paymongo-child-account error", error);
    return json({ error: error instanceof Error ? error.message : "Unable to update PayMongo merchant information." }, 500);
  }
});
