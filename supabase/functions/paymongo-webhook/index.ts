import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, paymongo-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSecretKey() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function parseSignature(header: string) {
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, value] = part.trim().split("=", 2);
      return [key, value ?? ""];
    }),
  );
  return { timestamp: parts.t ?? "", test: parts.te ?? "", live: parts.li ?? "" };
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("Paymongo-Signature") ?? "";

  if (!signatureHeader) {
    return jsonResponse({ error: "Webhook authentication is not configured." }, 500);
  }

  try {
    const payload = JSON.parse(rawBody);
    const eventType = payload?.data?.attributes?.type ?? payload?.data?.type ?? "";
    const session = payload?.data?.attributes?.data;
    const sessionMetadata = session?.attributes?.metadata ?? {};
    const organizationId = String(payload?.data?.attributes?.organization_id ?? "").trim();
    const metadataRestaurantId = String(sessionMetadata?.restaurant_id ?? "").trim();

    const serviceRoleKey = getSecretKey();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase server configuration is incomplete.");
      return jsonResponse({ error: "Server configuration is incomplete." }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let webhookSecret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET") ?? "";

    if (organizationId || metadataRestaurantId) {
      let connection = null;

      if (organizationId) {
        const { data, error } = await adminClient
          .from("restaurant_paymongo_accounts")
          .select("restaurant_id,webhook_secret_id,paymongo_account_id")
          .eq("paymongo_account_id", organizationId)
          .maybeSingle();
        if (error) throw error;
        connection = data;
      }

      if (!connection && metadataRestaurantId) {
        const { data, error } = await adminClient
          .from("restaurant_paymongo_accounts")
          .select("restaurant_id,webhook_secret_id,paymongo_account_id")
          .eq("restaurant_id", metadataRestaurantId)
          .maybeSingle();
        if (error) throw error;
        connection = data;
      }

      if (connection) {
        const { data: linkedSecret, error: linkedSecretError } = await adminClient.rpc(
          "get_paymongo_webhook_secret",
          { p_restaurant_id: connection.restaurant_id },
        );
        if (linkedSecretError) throw linkedSecretError;
        webhookSecret = typeof linkedSecret === "string" ? linkedSecret.trim() : "";
        if (!webhookSecret) {
          console.error("Linked PayMongo webhook secret is not configured.", {
            restaurantId: connection.restaurant_id,
            paymongoAccountId: connection.paymongo_account_id,
          });
          return jsonResponse({ error: "Linked PayMongo webhook authentication is not configured." }, 500);
        }
      }
    }

    if (!webhookSecret) {
      return jsonResponse({ error: "Webhook authentication is not configured." }, 500);
    }

    const signature = parseSignature(signatureHeader);
    if (!signature.timestamp) return jsonResponse({ error: "Invalid webhook signature." }, 401);

    const isLiveMode = Boolean(payload?.data?.attributes?.livemode);
    const providedSignature = isLiveMode ? signature.live : signature.test;
    const expectedSignature = await hmacSha256Hex(webhookSecret, `${signature.timestamp}.${rawBody}`);

    if (!providedSignature || !timingSafeEqual(expectedSignature, providedSignature)) {
      return jsonResponse({ error: "Invalid webhook signature." }, 401);
    }
    if (
      eventType !== "checkout_session.payment.paid" &&
      eventType !== "checkout_session.payment.failed" &&
      eventType !== "checkout_session.expired"
    ) {
      return jsonResponse({ received: true }, 200);
    }
    const sessionAttributes = session?.attributes ?? {};
    const orderNumber = String(sessionAttributes.reference_number ?? "").trim();
    if (!orderNumber) return jsonResponse({ received: true }, 200);

    const paidPayment = Array.isArray(sessionAttributes.payments)
      ? sessionAttributes.payments.find((payment: any) => payment?.attributes?.status === "paid") ?? sessionAttributes.payments[0]
      : null;
    const paymentAttributes = paidPayment?.attributes ?? {};
    const paymongoPaymentId = String(paidPayment?.id ?? "").trim() || null;
    const paymongoPaymentMethod = String(paymentAttributes?.source?.type ?? "").trim() || null;
    const paymongoFee = Number.isFinite(Number(paymentAttributes.fee))
      ? Number(paymentAttributes.fee) / 100
      : null;
    const paymongoNetAmount = Number.isFinite(Number(paymentAttributes.net_amount))
      ? Number(paymentAttributes.net_amount) / 100
      : null;
    const paymongoCheckoutSessionId = String(session?.id ?? "").trim() || null;

    if (eventType === "checkout_session.payment.failed" || eventType === "checkout_session.expired") {
      const failedStatus = eventType === "checkout_session.expired" ? "expired" : "failed";
      const { data: updated, error } = await adminClient.rpc("mark_pending_online_payment_status", {
        p_reference_number: orderNumber,
        p_status: failedStatus,
      });

      if (error) throw error;

      return jsonResponse({ received: true, status: updated?.[0] ?? null }, 200);
    }

    const { data: finalized, error } = await adminClient.rpc("finalize_online_payment", {
      p_reference_number: orderNumber,
      p_paymongo_payment_id: paymongoPaymentId,
      p_paymongo_checkout_session_id: paymongoCheckoutSessionId,
      p_paymongo_payment_method: paymongoPaymentMethod,
      p_paymongo_fee: paymongoFee,
      p_paymongo_net_amount: paymongoNetAmount,
    });

    if (error) throw error;

    return jsonResponse({ received: true, order: finalized?.[0] ?? null }, 200);
  } catch (error) {
    console.error("paymongo-webhook error", error);
    return jsonResponse({ error: "Unable to process webhook." }, 500);
  }
});
