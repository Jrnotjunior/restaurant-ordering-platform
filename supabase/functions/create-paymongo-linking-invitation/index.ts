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
      let paymongoAccountId = String(existing?.paymongo_account_id ?? "").trim();

      if (!paymongoAccountId) {
        const createResponse = await fetch("https://api.paymongo.com/v2/accounts", {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${key}:`)}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `restaurant-paymongo-account-${restaurantId}-${environment}`,
          },
          body: JSON.stringify({ type: "merchant" }),
        });

        const createPayload = await createResponse.json().catch(() => null);
        if (!createResponse.ok) {
          const detail = createPayload?.errors?.[0]?.detail;
          console.error("PayMongo test child account creation error", {
            status: createResponse.status,
            detail: typeof detail === "string" ? detail : null,
          });
          return jsonResponse({
            error: typeof detail === "string" ? detail : `PayMongo test child account creation returned HTTP ${createResponse.status}.`,
          }, 502);
        }

        paymongoAccountId = String(createPayload?.data?.id ?? "").trim();
        if (!paymongoAccountId) {
          return jsonResponse({ error: "PayMongo did not return a test child account ID." }, 502);
        }
      }

      const accountResponse = await fetch(
        `https://api.paymongo.com/v2/accounts/${encodeURIComponent(paymongoAccountId)}`,
        { headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: "application/json" } },
      );
      const accountPayload = await accountResponse.json().catch(() => null);
      if (!accountResponse.ok) {
        const detail = accountPayload?.errors?.[0]?.detail;
        return jsonResponse({
          error: typeof detail === "string" ? detail : "Unable to verify the PayMongo test child account.",
        }, 502);
      }

      // PayMongo test Accounts API returns mock accounts. Persist the mock child
      // ID server-side so checkout/refund requests can actually send Account-ID.
      // A mock ID must not be shared across tenants in Web2Table's mapping.
      const { data: accountOwner, error: accountOwnerError } = await admin
        .from("restaurant_paymongo_accounts")
        .select("restaurant_id")
        .eq("paymongo_account_id", paymongoAccountId)
        .maybeSingle();
      if (accountOwnerError) throw accountOwnerError;
      if (accountOwner && accountOwner.restaurant_id !== restaurantId) {
        return jsonResponse({
          error: "PayMongo returned a test-mode mock child account ID already assigned to another restaurant. Test one tenant at a time; live child accounts receive separate IDs.",
        }, 409);
      }

      const { error: saveAccountError } = await admin.from("restaurant_paymongo_accounts").upsert({
        restaurant_id: restaurantId,
        environment: "test",
        paymongo_account_id: paymongoAccountId,
        connection_status: "pending",
        onboarding_method: "create_account",
        invitation_id: null,
        invitation_email: null,
        activation_status: "activated",
        identity_verification_status: "simulated",
        onboarding_step: "webhook_configuration",
        last_error: null,
      }, { onConflict: "restaurant_id,environment" });
      if (saveAccountError) throw saveAccountError;

      let webhookId = String(existing?.webhook_id ?? "").trim();
      const hasStoredWebhookSecret = Boolean(existing?.webhook_secret_id);
      if (!webhookId || !hasStoredWebhookSecret) {
        const webhookResponse = await fetch("https://api.paymongo.com/v1/webhooks", {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`${key}:`)}`,
            "Content-Type": "application/json",
            "Account-ID": paymongoAccountId,
            "Idempotency-Key": `restaurant-paymongo-webhook-${restaurantId}-test`,
          },
          body: JSON.stringify({
            data: {
              attributes: {
                url: `${supabaseUrl}/functions/v1/paymongo-webhook`,
                events: [
                  "checkout_session.payment.paid",
                  "payment.failed",
                  "payment.refunded",
                  "refund.created",
                  "refund.updated",
                  "refund.succeeded",
                  "refund.failed",
                ],
              },
            },
          }),
        });
        const webhookPayload = await webhookResponse.json().catch(() => null);
        if (!webhookResponse.ok) {
          const detail = webhookPayload?.errors?.[0]?.detail;
          const message = typeof detail === "string"
            ? detail
            : `PayMongo test child webhook creation returned HTTP ${webhookResponse.status}.`;
          await admin.from("restaurant_paymongo_accounts").update({
            connection_status: "pending",
            onboarding_step: "webhook_configuration",
            last_error: message,
          }).eq("restaurant_id", restaurantId).eq("environment", "test");
          return jsonResponse({ error: message, paymongoAccountId }, 502);
        }

        webhookId = String(webhookPayload?.data?.id ?? "").trim();
        const webhookSecret = String(webhookPayload?.data?.attributes?.secret_key ?? "").trim();
        if (!webhookId || !webhookSecret) {
          await admin.from("restaurant_paymongo_accounts").update({
            connection_status: "pending",
            onboarding_step: "webhook_configuration",
            last_error: "PayMongo did not return test child webhook credentials.",
          }).eq("restaurant_id", restaurantId).eq("environment", "test");
          return jsonResponse({ error: "PayMongo did not return test child webhook credentials.", paymongoAccountId }, 502);
        }

        const { error: saveWebhookIdError } = await admin.from("restaurant_paymongo_accounts").update({
          webhook_id: webhookId,
          connection_status: "pending",
          onboarding_step: "webhook_configuration",
        }).eq("restaurant_id", restaurantId).eq("environment", "test");
        if (saveWebhookIdError) throw saveWebhookIdError;

        const { error: secretError } = await admin.rpc("set_paymongo_webhook_secret", {
          p_restaurant_id: restaurantId,
          p_secret: webhookSecret,
          p_environment: "test",
        });
        if (secretError) throw secretError;
      }

      const { error: activateError } = await admin.from("restaurant_paymongo_accounts").update({
        paymongo_account_id: paymongoAccountId,
        connection_status: "active",
        activation_status: "activated",
        identity_verification_status: "simulated",
        onboarding_step: "active",
        webhook_id: webhookId,
        last_error: null,
      }).eq("restaurant_id", restaurantId).eq("environment", "test");
      if (activateError) throw activateError;

      return jsonResponse({
        status: "active",
        paymongoAccountId,
        activationStatus: "activated",
        verificationUrl: null,
        webhookConfigured: true,
        testMode: true,
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
