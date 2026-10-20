import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-restaurant-domain, x-restaurant-slug",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getServiceRoleKey() {
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
    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = getServiceRoleKey();
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Order cancellation is temporarily unavailable." }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const orderId = String(body.orderId ?? "").trim();
    const guestCancelToken = String(body.guestCancelToken ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      return jsonResponse({ error: "A valid order is required." }, 400);
    }

    // Authenticated customers can cancel only their own linked orders. Guest
    // orders require the independent 256-bit cancellation token from checkout.
    let userClient: ReturnType<typeof createClient> | null = null;
    let authenticatedUserId: string | null = null;
    if (token && anonKey) {
      const candidateClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: userData, error: userError } = await candidateClient.auth.getUser(token);
      if (!userError && userData.user) {
        userClient = candidateClient;
        authenticatedUserId = userData.user.id;
      }
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: order, error: orderError } = await admin.from("orders")
      .select("id,restaurant_id,customer_id,status,payment_method,payment_status,total,paymongo_payment_id,paymongo_payment_method,guest_cancel_token_hash")
      .eq("id", orderId).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return jsonResponse({ error: "Order not found." }, 404);

    let guestTokenHash: string | null = null;
    if (order.customer_id === null) {
      if (!/^[0-9a-f]{64}$/.test(guestCancelToken)) {
        return jsonResponse({ error: "Guest cancellation could not be verified in this browser. Please reopen the order in the browser where you placed it." }, 403);
      }
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(guestCancelToken));
      guestTokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (!order.guest_cancel_token_hash || guestTokenHash !== order.guest_cancel_token_hash) {
        return jsonResponse({ error: "This order's cancellation token is invalid or unavailable in this browser." }, 403);
      }
    } else {
      if (!userClient || !authenticatedUserId) {
        return jsonResponse({ error: "Sign in to cancel this order." }, 401);
      }
      const { data: profile, error: profileError } = await admin.from("customer_profiles")
        .select("id").eq("auth_user_id", authenticatedUserId)
        .eq("restaurant_id", order.restaurant_id).maybeSingle();
      if (profileError) throw profileError;
      if (!profile || profile.id !== order.customer_id) {
        return jsonResponse({ error: "Order not found or does not belong to your account." }, 404);
      }
    }

    if (order.status !== "pending") {
      return jsonResponse({ error: "This order can no longer be cancelled because the restaurant has confirmed it." }, 409);
    }

    // Atomically cancel before any external refund call. This prevents a concurrent
    // cashier/kitchen action from accepting the order while the refund is in flight.
    const paidOnline = order.payment_status === "paid" && Boolean(String(order.paymongo_payment_id ?? "").trim());
    if (order.payment_status === "paid" && !paidOnline) {
      return jsonResponse({ error: "The online payment reference is missing. Please contact the restaurant for refund assistance." }, 409);
    }
    if (!["pending", "paid"].includes(order.payment_status)) {
      return jsonResponse({ error: "This payment is not eligible for cancellation." }, 409);
    }
    if (paidOnline && !order.paymongo_payment_id) {
      return jsonResponse({ error: "The online payment reference is missing. Please contact the restaurant." }, 409);
    }

    if (order.customer_id === null) {
      // Compare-and-set on pending status and the exact token hash: the guest
      // token can cancel only this one pending guest order, at most once.
      const { data: changedOrder, error: guestCancelError } = await admin.from("orders")
        .update({
          status: "cancelled",
          cancellation_refund_status: paidOnline ? "pending" : "not_required",
          cancellation_refund_error: null,
          guest_cancel_token_hash: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("status", "pending")
        .eq("payment_status", order.payment_status)
        .is("customer_id", null)
        .eq("guest_cancel_token_hash", guestTokenHash)
        .select("id")
        .maybeSingle();
      if (guestCancelError) throw guestCancelError;
      if (!changedOrder) {
        return jsonResponse({ error: "This order has changed. Refresh the page and check its current status." }, 409);
      }
    } else {
      const { error: cancelError } = await userClient!.rpc("cancel_my_pending_order", { p_order_id: orderId });
      if (cancelError) {
        const message = cancelError.message || "Unable to cancel this order.";
        return jsonResponse({ error: message }, 409);
      }
    }

    if (!paidOnline) {
      return jsonResponse({ cancelled: true, refundStatus: "not_required", message: "Your order has been cancelled." }, 200);
    }

    const configuredPayMongoEnvironment = String(Deno.env.get("PAYMONGO_ENVIRONMENT") ?? "").trim();
    const legacyPayMongoKey = Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
    const environment: "test" | "live" =
      configuredPayMongoEnvironment === "live" || configuredPayMongoEnvironment === "test"
        ? configuredPayMongoEnvironment
        : legacyPayMongoKey.startsWith("sk_live_") ? "live" : "test";
    const secretKey = getPayMongoSecretKey(environment);
    if (!secretKey) {
      await admin.from("orders").update({
        cancellation_refund_status: "failed",
        cancellation_refund_error: "PayMongo secret key is not configured for this environment.",
      }).eq("id", orderId);
      return jsonResponse({ cancelled: true, refundStatus: "failed", message: "Order cancelled, but the refund could not be started. Please contact the restaurant." }, 200);
    }

    const { data: connection, error: connectionError } = await admin.from("restaurant_paymongo_accounts")
      .select("paymongo_account_id,connection_status,environment,onboarding_step,activation_status,webhook_secret_id")
      .eq("restaurant_id", order.restaurant_id).eq("environment", environment).maybeSingle();
    if (connectionError) throw connectionError;
    const isParentTestSandbox =
      environment === "test" &&
      connection?.onboarding_step === "test_parent_account" &&
      connection.connection_status === "pending" &&
      connection.activation_status === "mock" &&
      !connection.paymongo_account_id &&
      !connection.webhook_secret_id;
    // Parent-account test sandbox has no linked child ID. Never send the fake
    // org_test_merchant value as Account-ID; live still requires an active tenant child.
    const accountId = isParentTestSandbox
      ? ""
      : String(connection?.paymongo_account_id ?? "").trim();

    if (!connection || (!isParentTestSandbox && (
      connection.connection_status !== "active" || !accountId
    ))) {
      await admin.from("orders").update({
        cancellation_refund_status: "failed",
        cancellation_refund_error: "The restaurant's PayMongo connection is missing or inactive; refund was not sent through an unverified account.",
      }).eq("id", orderId);
      return jsonResponse({ cancelled: true, refundStatus: "failed", message: "Order cancelled, but the restaurant's PayMongo connection could not be verified for the refund. Please contact the restaurant." }, 200);
    }

    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${secretKey}:`)}`,
      "Content-Type": "application/json",
      // Keep refund requests in the same account context as checkout. The
      // sandbox mock ID only tests request handling; live uses a verified child ID.
      ...(accountId ? { "Account-ID": accountId } : {}),
    };

    try {
      await admin.from("orders").update({
        cancellation_refund_status: "processing",
        cancellation_refund_error: null,
      }).eq("id", orderId);

      const paymentResponse = await fetch(`https://api.paymongo.com/v1/payments/${encodeURIComponent(order.paymongo_payment_id)}`, {
        method: "GET",
        headers,
      });
      const paymentPayload = await paymentResponse.json().catch(() => null);
      if (!paymentResponse.ok) throw new Error("Unable to verify the original PayMongo payment.");
      const paymentAttributes = paymentPayload?.data?.attributes ?? {};
      if (paymentAttributes.status !== "paid" || String(paymentPayload?.data?.id ?? "") !== order.paymongo_payment_id) {
        throw new Error("The original PayMongo payment is not in a refundable paid state.");
      }
      const amount = Number(paymentAttributes.amount);
      if (!Number.isSafeInteger(amount) || amount < 100) throw new Error("The original PayMongo payment amount is invalid.");

      const refundResponse = await fetch("https://api.paymongo.com/v1/refunds", {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": `customer-cancel-refund-${orderId}` },
        body: JSON.stringify({
          data: { attributes: {
            amount,
            payment_id: order.paymongo_payment_id,
            reason: "requested_by_customer",
            notes: `Customer cancelled pending Web2Table order ${orderId}`,
          } },
        }),
      });
      const refundPayload = await refundResponse.json().catch(() => null);
      if (!refundResponse.ok) {
        const apiMessage = String(refundPayload?.errors?.[0]?.detail ?? refundPayload?.errors?.[0]?.code ?? "PayMongo rejected the refund.");
        throw new Error(apiMessage.slice(0, 450));
      }

      const refundId = String(refundPayload?.data?.id ?? "");
      const refundState = String(refundPayload?.data?.attributes?.status ?? "");
      if (!refundId || !["pending", "processing", "succeeded"].includes(refundState)) {
        throw new Error("PayMongo returned an unrecognized refund status.");
      }
      const paymentStatus = refundState === "succeeded" ? "refunded" : "paid";
      const { error: updateError } = await admin.from("orders").update({
        paymongo_refund_id: refundId,
        cancellation_refund_status: refundState,
        cancellation_refund_error: null,
        payment_status: paymentStatus,
        updated_at: new Date().toISOString(),
      }).eq("id", orderId);
      if (updateError) throw updateError;

      return jsonResponse({
        cancelled: true,
        refundStatus: refundState,
        message: refundState === "succeeded"
          ? "Your order has been cancelled and the refund has been submitted successfully."
          : "Your order has been cancelled. Your refund is being processed.",
      }, 200);
    } catch (refundError) {
      const message = refundError instanceof Error ? refundError.message : "PayMongo refund failed.";
      await admin.from("orders").update({
        cancellation_refund_status: "failed",
        cancellation_refund_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", orderId);
      console.error("Customer cancellation refund failed", { orderId, message });
      return jsonResponse({
        cancelled: true,
        refundStatus: "failed",
        message: "Your order has been cancelled, but the refund could not be completed automatically. Please contact the restaurant for assistance.",
      }, 200);
    }
  } catch (error) {
    console.error("cancel-customer-order error", error);
    return jsonResponse({ error: "Unable to cancel this order right now. Please try again." }, 500);
  }
});
