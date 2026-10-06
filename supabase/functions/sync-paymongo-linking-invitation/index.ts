import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  if (environment === "live") {
    return Deno.env.get("PAYMONGO_LIVE_SECRET_KEY")
      ?? ((Deno.env.get("PAYMONGO_SECRET_KEY") ?? "").startsWith("sk_live_")
        ? Deno.env.get("PAYMONGO_SECRET_KEY") ?? ""
        : "");
  }
  return Deno.env.get("PAYMONGO_TEST_SECRET_KEY") ?? Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
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
    if (!restaurantId) return jsonResponse({ error: "Restaurant is required." }, 400);
    if (!["test", "live"].includes(environment)) return jsonResponse({ error: "Invalid PayMongo environment." }, 400);

    const { data: restaurant, error: restaurantError } = await admin
      .from("restaurants").select("id,owner_id").eq("id", restaurantId).maybeSingle();
    if (restaurantError) throw restaurantError;
    if (!restaurant || restaurant.owner_id !== userData.user.id) return jsonResponse({ error: "You do not have access to this restaurant." }, 403);

    const key = getPayMongoSecretKey(environment);
    if (!key) return jsonResponse({ error: `PayMongo ${environment} mode is not configured yet.` }, 409);

    const { data: connection, error: connectionError } = await admin
      .from("restaurant_paymongo_accounts")
      .select("paymongo_account_id,connection_status,invitation_id,invitation_email,activation_status,webhook_id,webhook_secret_id")
      .eq("restaurant_id", restaurantId).eq("environment", environment).maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection?.invitation_id) return jsonResponse({ error: "PayMongo onboarding has not been started." }, 409);

    const inviteResponse = await fetch(
      `https://api.paymongo.com/v2/linking-requests/${encodeURIComponent(connection.invitation_id)}`,
      { headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: "application/json" } },
    );
    const invitePayload = await inviteResponse.json().catch(() => null);
    if (!inviteResponse.ok) {
      const detail = invitePayload?.errors?.[0]?.detail;
      return jsonResponse({ error: typeof detail === "string" ? detail : "Unable to check PayMongo onboarding." }, 502);
    }

    const invitationStatus = String(invitePayload?.status ?? "").trim();
    const childAccountId = String(invitePayload?.child_account_id ?? "").trim();

    if (invitationStatus === "pending") {
      return jsonResponse({ status: "pending", invitationId: connection.invitation_id });
    }

    if (invitationStatus === "declined") {
      await admin.from("restaurant_paymongo_accounts").update({
        connection_status: "error", activation_status: "declined"
      }).eq("restaurant_id", restaurantId).eq("environment", environment);
      return jsonResponse({ status: "error", activationStatus: "declined" });
    }

    if (invitationStatus === "cancelled") {
      await admin.from("restaurant_paymongo_accounts").update({
        connection_status: "revoked", activation_status: "cancelled"
      }).eq("restaurant_id", restaurantId).eq("environment", environment);
      return jsonResponse({ status: "revoked" });
    }

    if (invitationStatus !== "accepted" || !childAccountId) {
      return jsonResponse({ status: invitationStatus || "pending" });
    }

    const accountResponse = await fetch(
      `https://api.paymongo.com/v2/accounts/${encodeURIComponent(childAccountId)}`,
      { headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: "application/json" } },
    );
    const accountPayload = await accountResponse.json().catch(() => null);
    if (!accountResponse.ok) {
      const detail = accountPayload?.errors?.[0]?.detail;
      return jsonResponse({ error: typeof detail === "string" ? detail : "Unable to read the linked PayMongo account." }, 502);
    }

    const activationStatus = String(accountPayload?.data?.activation_status ?? "").trim();

    await admin.from("restaurant_paymongo_accounts").update({
      paymongo_account_id: childAccountId,
      activation_status: activationStatus || null,
      connection_status: activationStatus === "activated" ? "linked" : "pending",
    }).eq("restaurant_id", restaurantId).eq("environment", environment);

    if (activationStatus !== "activated") {
      return jsonResponse({
        status: "pending",
        paymongoAccountId: childAccountId,
        activationStatus: activationStatus || null,
      });
    }

    let webhookId = String(connection.webhook_id ?? "").trim();

    if (!webhookId) {
      const webhookResponse = await fetch("https://api.paymongo.com/v1/webhooks", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${key}:`)}`,
          "Content-Type": "application/json",
          "Account-ID": childAccountId,
          "Idempotency-Key": `restaurant-paymongo-webhook-${restaurantId}-${environment}`,
        },
        body: JSON.stringify({
          data: {
            attributes: {
              url: `${supabaseUrl}/functions/v1/paymongo-webhook`,
              events: ["checkout_session.payment.paid"],
            },
          },
        }),
      });

      const webhookPayload = await webhookResponse.json().catch(() => null);
      if (!webhookResponse.ok) {
        const detail = webhookPayload?.errors?.[0]?.detail;
        return jsonResponse({
          error: typeof detail === "string"
            ? detail
            : "PayMongo is active, but its payment webhook could not be configured yet.",
        }, 502);
      }

      webhookId = String(webhookPayload?.data?.id ?? "").trim();
      const webhookSecret = String(webhookPayload?.data?.attributes?.secret_key ?? "").trim();
      if (!webhookId || !webhookSecret) {
        return jsonResponse({ error: "PayMongo did not return the child webhook credentials." }, 502);
      }

      const { error: secretError } = await admin.rpc("set_paymongo_webhook_secret", {
        p_restaurant_id: restaurantId,
        p_secret: webhookSecret,
        p_environment: environment,
      });
      if (secretError) throw secretError;
    }

    const { error: activateError } = await admin.from("restaurant_paymongo_accounts").update({
      paymongo_account_id: childAccountId,
      connection_status: "active",
      activation_status: activationStatus,
      webhook_id: webhookId,
    }).eq("restaurant_id", restaurantId).eq("environment", environment);
    if (activateError) throw activateError;

    return jsonResponse({
      status: "active",
      paymongoAccountId: childAccountId,
      activationStatus,
      webhookId,
    });
  } catch (error) {
    console.error("sync-paymongo-linking-invitation error", error);
    return jsonResponse({ error: "Unable to synchronize PayMongo onboarding." }, 500);
  }
});
