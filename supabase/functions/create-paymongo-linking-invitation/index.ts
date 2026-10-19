import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type, x-retry-count, traceparent, tracestate, baggage, x-supabase-api-version, x-restaurant-domain, x-restaurant-slug",
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

function getPayMongoSecretKey(environment: "test" | "live") {
  const dedicated = environment === "live"
    ? Deno.env.get("PAYMONGO_LIVE_SECRET_KEY") ?? ""
    : Deno.env.get("PAYMONGO_TEST_SECRET_KEY") ?? "";
  const expectedPrefix = environment === "live" ? "sk_live_" : "sk_test_";
  if (dedicated.startsWith(expectedPrefix)) return dedicated;

  const legacy = Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
  return legacy.startsWith(expectedPrefix) ? legacy : "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const jwt = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = getSecretKey();
    if (!jwt || !supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Authentication is required." }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const auth = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await auth.auth.getUser();
    if (userError || !userData.user) return jsonResponse({ error: "Authentication is required." }, 401);

    const body = await request.json();
    const restaurantId = String(body.restaurantId ?? "").trim();
    const environment = String(body.environment ?? "test").trim() as "test" | "live";
    const email = String(body.email ?? "").trim().toLowerCase();

    if (!restaurantId) return jsonResponse({ error: "Restaurant is required." }, 400);
    if (!["test", "live"].includes(environment)) return jsonResponse({ error: "Invalid PayMongo environment." }, 400);
    if (!/^\S+@\S+\.\S+$/.test(email)) return jsonResponse({ error: "A valid email is required." }, 400);

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants").select("id,owner_id").eq("id", restaurantId).maybeSingle();
    if (restaurantError) throw restaurantError;
    if (!restaurant || restaurant.owner_id !== userData.user.id) return jsonResponse({ error: "You do not have access to this restaurant." }, 403);

    const key = getPayMongoSecretKey(environment);
    if (!key) return jsonResponse({ error: `PayMongo ${environment} mode is not configured yet.` }, 409);

    const { data: existing } = await admin.from("restaurant_paymongo_accounts")
      .select("paymongo_account_id,connection_status,invitation_id,invitation_email,webhook_id,webhook_secret_id")
      .eq("restaurant_id", restaurantId).eq("environment", environment).maybeSingle();

    if (environment === "live" && existing?.connection_status === "active" && existing.paymongo_account_id) {
      return jsonResponse({ status: "active", paymongoAccountId: existing.paymongo_account_id });
    }

    if (environment === "test") {
      // PayMongo explicitly returns mock account resources when test keys are
      // used. The mock ID (often org_test_merchant) is not a real linked child
      // relationship, so do not try to register a child webhook or mark the
      // mock as a connected merchant. Save a clearly labeled sandbox simulation
      // instead; checkout/refunds will run against the parent test account only.
      let mockAccountId = String(existing?.paymongo_account_id ?? "").trim();

      if (!mockAccountId) {
        const createResponse = await fetch("https://api.paymongo.com/v2/accounts", {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${key}:`)}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `restaurant-paymongo-account-${restaurantId}-test`,
          },
          body: JSON.stringify({ type: "merchant" }),
        });
        const createPayload = await createResponse.json().catch(() => null);
        if (!createResponse.ok) {
          const detail = createPayload?.errors?.[0]?.detail;
          return jsonResponse({
            error: typeof detail === "string" ? detail : `PayMongo test account simulation returned HTTP ${createResponse.status}.`,
          }, 502);
        }
        mockAccountId = String(createPayload?.data?.id ?? "").trim();
        if (!mockAccountId) {
          return jsonResponse({ error: "PayMongo did not return its test-mode mock account response." }, 502);
        }
      }

      const accountResponse = await fetch(
        `https://api.paymongo.com/v2/accounts/${encodeURIComponent(mockAccountId)}`,
        { headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: "application/json" } },
      );
      const accountPayload = await accountResponse.json().catch(() => null);
      if (!accountResponse.ok) {
        const detail = accountPayload?.errors?.[0]?.detail;
        return jsonResponse({
          error: typeof detail === "string" ? detail : "Unable to verify PayMongo's test-mode mock response.",
        }, 502);
      }

      const { error: saveError } = await admin.from("restaurant_paymongo_accounts").upsert({
        restaurant_id: restaurantId,
        environment: "test",
        // Never persist the shared mock ID as a real child ID. It is not a
        // relationship and would collide across independent tenants.
        paymongo_account_id: null,
        connection_status: "pending",
        onboarding_method: "create_account",
        invitation_id: null,
        invitation_email: null,
        activation_status: "mock",
        identity_verification_status: "simulated",
        onboarding_step: "test_simulation",
        webhook_id: null,
        webhook_secret_id: null,
        last_error: "Sandbox-only simulation. PayMongo test keys return mock accounts and do not establish a real child relationship. Checkout/refunds use the parent test account; child routing is not verified.",
      }, { onConflict: "restaurant_id,environment" });
      if (saveError) throw saveError;

      return jsonResponse({
        status: "simulated",
        paymongoAccountId: null,
        activationStatus: "mock",
        onboardingStep: "test_simulation",
        webhookConfigured: false,
        testMode: true,
        linkedTransactionsSupported: false,
        message: "Test simulation is ready. Payments and refunds use Web2Table's parent test account; this does not verify PayMongo child-account routing.",
      });
    }

    if (existing?.connection_status === "pending" && existing.invitation_id && existing.invitation_email === email) {
      return jsonResponse({
        status: "pending",
        invitationId: existing.invitation_id,
        signupUrl: `https://dashboard.paymongo.com/signup?email=${encodeURIComponent(email)}&invitation_code=${encodeURIComponent(existing.invitation_id)}`,
      });
    }

    const response = await fetch("https://api.paymongo.com/v2/linking-requests/invites", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${key}:`)}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `restaurant-paymongo-invite-${restaurantId}-${environment}-${email}`,
      },
      body: JSON.stringify({ invites: [{ email, account_type: "merchant" }] }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = payload?.errors?.[0]?.detail;
      console.error("PayMongo invitation API error", {
        status: response.status,
        detail: typeof detail === "string" ? detail : null,
        payload,
      });
      return jsonResponse({
        error: typeof detail === "string"
          ? detail
          : `PayMongo invitation API returned HTTP ${response.status}.`,
      }, 502);
    }

    const invite = Array.isArray(payload?.invites) ? payload.invites[0] : null;
    const invitationId = String(invite?.invitation_id ?? "").trim();
    if (!invitationId) return jsonResponse({ error: "PayMongo did not return an invitation ID." }, 502);

    const { error: saveError } = await admin.from("restaurant_paymongo_accounts").upsert({
      restaurant_id: restaurantId,
      environment,
      paymongo_account_id: null,
      connection_status: "pending",
      invitation_id: invitationId,
      invitation_email: email,
      activation_status: null,
      webhook_id: null,
      webhook_secret_id: null,
    }, { onConflict: "restaurant_id,environment" });
    if (saveError) throw saveError;

    return jsonResponse({
      status: "pending",
      invitationId,
      signupUrl: `https://dashboard.paymongo.com/signup?email=${encodeURIComponent(email)}&invitation_code=${encodeURIComponent(invitationId)}`,
    });
  } catch (error) {
    console.error("create-paymongo-linking-invitation error", error);
    return jsonResponse({ error: "Unable to start PayMongo onboarding." }, 500);
  }
});
