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

  try {
    const payload = JSON.parse(rawBody);
    const eventId = String(payload?.data?.id ?? "").trim();
    const eventType = String(payload?.data?.attributes?.type ?? "").trim();
    const isLiveMode = Boolean(payload?.data?.attributes?.livemode);
    const environment = isLiveMode ? "live" : "test";
    const organizationId = String(payload?.data?.attributes?.organization_id ?? "").trim();
    const session = payload?.data?.attributes?.data;
    const sessionAttributes = session?.attributes ?? {};
    const sessionMetadata = sessionAttributes?.metadata ?? {};
    const metadataRestaurantId = String(sessionMetadata?.restaurant_id ?? "").trim();

    if (!eventId) return jsonResponse({ error: "Invalid webhook event." }, 400);

    const serviceRoleKey = getSecretKey();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase server configuration is incomplete.");
      return jsonResponse({ error: "Server configuration is incomplete." }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let restaurantId = "";
    let webhookSecret = "";

    if (organizationId) {
      const { data: connection, error: connectionError } = await adminClient
        .from("restaurant_paymongo_accounts")
        .select("restaurant_id,webhook_secret_id")
        .eq("paymongo_account_id", organizationId)
        .eq("environment", environment)
        .maybeSingle();

      if (connectionError) throw connectionError;
      if (connection?.restaurant_id) {
        restaurantId = String(connection.restaurant_id);
        const { data: secret, error: secretError } = await adminClient.rpc("get_paymongo_webhook_secret", {
          p_restaurant_id: restaurantId,
          p_environment: environment,
        });
        if (secretError) throw secretError;
        webhookSecret = String(secret ?? "");
      }
    }

    if (metadataRestaurantId) {
      if (restaurantId && restaurantId !== metadataRestaurantId) {
        return jsonResponse({ error: "Webhook restaurant mismatch." }, 400);
      }
      restaurantId = metadataRestaurantId;
    }

    if (!webhookSecret) {
      webhookSecret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET") ?? "";
    }

    if (!webhookSecret || !signatureHeader) {
      return jsonResponse({ error: "Webhook authentication is not configured." }, 500);
    }

    const signature = parseSignature(signatureHeader);
    if (!signature.timestamp) return jsonResponse({ error: "Invalid webhook signature." }, 401);

    const providedSignature = isLiveMode ? signature.live : signature.test;
    const expectedSignature = await hmacSha256Hex(webhookSecret, `${signature.timestamp}.${rawBody}`);

    if (!providedSignature || !timingSafeEqual(expectedSignature, providedSignature)) {
      return jsonResponse({ error: "Invalid webhook signature." }, 401);
    }

    const { data: existingEvent, error: existingEventError } = await adminClient
      .from("paymongo_webhook_events")
      .select("event_id,status")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existingEventError) throw existingEventError;
    if (existingEvent?.status === "processed") return jsonResponse({ received: true, duplicate: true }, 200);

    const { error: eventInsertError } = await adminClient
      .from("paymongo_webhook_events")
      .upsert({
        event_id: eventId,
        restaurant_id: restaurantId || null,
        environment,
        event_type: eventType || "unknown",
        status: "processing",
        attempts: existingEvent ? 2 : 1,
        last_error: null,
      }, { onConflict: "event_id" });

    if (eventInsertError) throw eventInsertError;

    if (
      eventType !== "checkout_session.payment.paid" &&
      eventType !== "checkout_session.payment.failed" &&
      eventType !== "checkout_session.expired"
    ) {
      await adminClient.from("paymongo_webhook_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("event_id", eventId);
      return jsonResponse({ received: true }, 200);
    }

    const orderNumber = String(sessionAttributes.reference_number ?? "").trim();
    if (!orderNumber) {
      await adminClient.from("paymongo_webhook_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("event_id", eventId);
      return jsonResponse({ received: true }, 200);
    }

    const paidPayment = Array.isArray(sessionAttributes.payments)
      ? sessionAttributes.payments.find((payment: any) => payment?.attributes?.status === "paid") ?? sessionAttributes.payments[0]
      : null;
    const paymentAttributes = paidPayment?.attributes ?? {};
    const paymongoPaymentId = String(paidPayment?.id ?? "").trim() || null;
    const paymongoPaymentMethod = String(paymentAttributes?.source?.type ?? "").trim() || null;
    const paymongoFee = Number.isFinite(Number(paymentAttributes.fee)) ? Number(paymentAttributes.fee) / 100 : null;
    const paymongoNetAmount = Number.isFinite(Number(paymentAttributes.net_amount)) ? Number(paymentAttributes.net_amount) / 100 : null;
    const paymongoCheckoutSessionId = String(session?.id ?? "").trim() || null;

    try {
      if (eventType === "checkout_session.payment.failed" || eventType === "checkout_session.expired") {
        const failedStatus = eventType === "checkout_session.expired" ? "expired" : "failed";
        const { data: updated, error } = await adminClient.rpc("mark_pending_online_payment_status", {
          p_reference_number: orderNumber,
          p_status: failedStatus,
        });
        if (error) throw error;

        await adminClient.from("paymongo_webhook_events")
          .update({ status: "processed", processed_at: new Date().toISOString(), last_error: null })
          .eq("event_id", eventId);

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

      await adminClient.from("paymongo_webhook_events")
        .update({ status: "processed", processed_at: new Date().toISOString(), last_error: null })
        .eq("event_id", eventId);

      return jsonResponse({ received: true, order: finalized?.[0] ?? null }, 200);
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : String(processingError);
      await adminClient.from("paymongo_webhook_events")
        .update({ status: "failed", last_error: message })
        .eq("event_id", eventId);
      throw processingError;
    }
  } catch (error) {
    console.error("paymongo-webhook error", error);
    return jsonResponse({ error: "Unable to process webhook." }, 500);
  }
});
