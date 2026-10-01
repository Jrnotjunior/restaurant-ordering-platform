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
  const webhookSecret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET") ?? "";

  if (!webhookSecret || !signatureHeader) {
    return jsonResponse({ error: "Webhook authentication is not configured." }, 500);
  }

  try {
    const signature = parseSignature(signatureHeader);
    if (!signature.timestamp) return jsonResponse({ error: "Invalid webhook signature." }, 401);

    const payload = JSON.parse(rawBody);
    const isLiveMode = Boolean(payload?.data?.attributes?.livemode);
    const providedSignature = isLiveMode ? signature.live : signature.test;
    const expectedSignature = await hmacSha256Hex(webhookSecret, `${signature.timestamp}.${rawBody}`);

    if (!providedSignature || !timingSafeEqual(expectedSignature, providedSignature)) {
      return jsonResponse({ error: "Invalid webhook signature." }, 401);
    }

    const eventType = payload?.data?.attributes?.type ?? payload?.data?.type ?? "";
    if (eventType !== "checkout_session.payment.paid") {
      return jsonResponse({ received: true }, 200);
    }

    const session = payload?.data?.attributes?.data;
    const orderNumber = String(session?.attributes?.reference_number ?? "").trim();
    if (!orderNumber) return jsonResponse({ received: true }, 200);

    const serviceRoleKey = getSecretKey();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Supabase server configuration is incomplete.");
      return jsonResponse({ error: "Server configuration is incomplete." }, 500);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await adminClient
      .from("orders")
      .update({ payment_status: "paid", updated_at: new Date().toISOString() })
      .eq("order_number", orderNumber)
      .eq("payment_method", "gcash")
      .eq("payment_status", "pending");

    if (error) throw error;

    return jsonResponse({ received: true }, 200);
  } catch (error) {
    console.error("paymongo-webhook error", error);
    return jsonResponse({ error: "Unable to process webhook." }, 500);
  }
});
