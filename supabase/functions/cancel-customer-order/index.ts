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

    const cancelUnpaidOrder = async () => {
      let updateQuery = admin.from("orders").update({
        status: "cancelled",
        cancellation_refund_status: "not_required",
        cancellation_refund_error: null,
        ...(order.customer_id === null ? { guest_cancel_token_hash: null } : {}),
        updated_at: new Date().toISOString(),
      })
        .eq("id", orderId)
        .eq("restaurant_id", order.restaurant_id)
        .eq("status", "pending")
        .eq("payment_status", order.payment_status);
      if (order.customer_id === null) {
        updateQuery = updateQuery.is("customer_id", null).eq("guest_cancel_token_hash", guestTokenHash);
      } else {
        updateQuery = updateQuery.eq("customer_id", order.customer_id);
      }
      const { data: changedOrder, error: cancelError } = await updateQuery.select("id").maybeSingle();
      if (cancelError) throw cancelError;
      return Boolean(changedOrder);
    };

    if (!paidOnline) {
      if (!await cancelUnpaidOrder()) {
        return jsonResponse({ error: "This order has changed. Refresh the page and check its current status." }, 409);
      }
      return jsonResponse({ cancelled: true, refundStatus: "not_required", message: "Your order has been cancelled." }, 200);
    }

    // A paid order stays pending unless PayMongo accepts the refund request.
    // Reserve the refund operation first so a concurrent cashier/kitchen handoff
    // cannot advance the order while payment reversal is in progress.

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
        updated_at: new Date().toISOString(),
      }).eq("id", orderId).eq("status", "pending").eq("payment_status", "paid");
      return jsonResponse({ cancelled: false, refundStatus: "failed", error: "PayMongo is not configured for this payment environment, so the order remains pending and was not cancelled." }, 422);
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
      const message = "The restaurant's PayMongo connection is missing or inactive for this environment.";
      await admin.from("orders").update({
        cancellation_refund_status: "failed",
        cancellation_refund_error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", orderId).eq("status", "pending").eq("payment_status", "paid");
      return jsonResponse({ cancelled: false, refundStatus: "failed", error: `${message} The order remains pending and was not cancelled.` }, 422);
    }

    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${secretKey}:`)}`,
      "Content-Type": "application/json",
      // Keep refund requests in the same account context as checkout. The
      // sandbox mock ID only tests request handling; live uses a verified child ID.
      ...(accountId ? { "Account-ID": accountId } : {}),
    };

    try {
      const { data: reservedOrder, error: reservationError } = await admin.from("orders").update({
        cancellation_refund_status: "processing",
        cancellation_refund_error: null,
        updated_at: new Date().toISOString(),
      })
        .eq("id", orderId)
        .eq("restaurant_id", order.restaurant_id)
        .eq("status", "pending")
        .eq("payment_status", "paid")
        .or("cancellation_refund_status.is.null,cancellation_refund_status.neq.processing")
        .select("id")
        .maybeSingle();
      if (reservationError) throw reservationError;
      if (!reservedOrder) {
        return jsonResponse({ error: "A refund attempt is already in progress or this order has changed. Check its current status before proceeding." }, 409);
      }

      const paymentResponse = await fetch(`https://api.paymongo.com/v1/payments/${encodeURIComponent(order.paymongo_payment_id)}`, {
        method: "GET",
        headers,
      });
      const paymentPayload = await paymentResponse.json().catch(() => null);
      const paymentAttributes = paymentPayload?.data?.attributes ?? {};
      if (!paymentResponse.ok || paymentAttributes.status !== "paid" || String(paymentPayload?.data?.id ?? "") !== order.paymongo_payment_id) {
        throw new Error("The original PayMongo payment could not be verified as paid.");
      }
      if (typeof paymentAttributes.livemode === "boolean" && paymentAttributes.livemode !== (environment === "live")) {
        throw new Error("The original payment environment does not match the tenant's configured PayMongo connection.");
      }
      const sourceType = String(paymentAttributes.source?.type ?? "").toLowerCase();
      const amount = Number(paymentAttributes.amount);
      if (!Number.isSafeInteger(amount) || amount < 100) throw new Error("The original PayMongo payment amount is invalid.");

      // Test-only parent sandbox refunds are simulated locally because PayMongo
      // does not move real funds for test transactions. The explicit status makes
      // clear this does not represent a provider refund.
      if (isParentTestSandbox && environment === "test" && paymentAttributes.livemode === false) {
        let simulationQuery = admin.from("orders").update({
          status: "cancelled",
          payment_status: "refunded",
          cancellation_refund_status: "simulated",
          cancellation_refund_error: "TEST MODE ONLY: refund flow simulated locally. No funds were moved by PayMongo.",
          paymongo_refund_id: null,
          paymongo_refund_transfer_link: null,
          ...(order.customer_id === null ? { guest_cancel_token_hash: null } : {}),
          updated_at: new Date().toISOString(),
        })
          .eq("id", orderId)
          .eq("restaurant_id", order.restaurant_id)
          .eq("status", "pending")
          .eq("payment_status", "paid")
          .eq("cancellation_refund_status", "processing");
        if (order.customer_id === null) {
          simulationQuery = simulationQuery.is("customer_id", null).eq("guest_cancel_token_hash", guestTokenHash);
        } else {
          simulationQuery = simulationQuery.eq("customer_id", order.customer_id);
        }
        const { data: simulatedOrder, error: simulationError } = await simulationQuery.select("id").maybeSingle();
        if (simulationError) throw simulationError;
        if (!simulatedOrder) {
          return jsonResponse({ error: "Order changed while the test refund was being prepared. Refresh and check its status." }, 409);
        }
        return jsonResponse({
          cancelled: true,
          refundStatus: "simulated",
          message: "Test mode only: your order was cancelled and the refund flow was simulated successfully. No real funds were moved by PayMongo.",
        }, 200);
      }

      const isQrph = sourceType === "qrph";
      const refundEndpoint = isQrph
        ? "https://refunds-api.paymongo.com/v1/refunds"
        : "https://api.paymongo.com/v1/refunds";
      const refundResponse = await fetch(refundEndpoint, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": `order-cancel-refund-${orderId}` },
        body: JSON.stringify({
          data: { attributes: {
            amount,
            payment_id: order.paymongo_payment_id,
            reason: "others",
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
      const refundTransferLink = String(refundPayload?.data?.attributes?.transfer_link ?? "");
      if (!refundId || !["pending", "processing", "refunding", "succeeded"].includes(refundState)) {
        throw new Error("PayMongo returned an unrecognized refund status.");
      }
      const normalizedRefundState = refundState === "refunding" ? "processing" : refundState;
      if (isQrph && !refundTransferLink && normalizedRefundState !== "succeeded") {
        await admin.from("orders").update({
          status: "cancelled",
          paymongo_refund_id: refundId,
          paymongo_refund_transfer_link: null,
          cancellation_refund_status: "manual_review",
          cancellation_refund_error: "PayMongo created a QR Ph refund but did not return its transfer link. Check the PayMongo dashboard; do not submit another refund.",
          payment_status: "paid",
          updated_at: new Date().toISOString(),
        }).eq("id", orderId).eq("restaurant_id", order.restaurant_id).eq("status", "pending").eq("payment_status", "paid");
        return jsonResponse({
          cancelled: true,
          refundStatus: "manual_review",
          message: "PayMongo created the QR Ph refund, but no customer claim link was returned. Contact the restaurant before trying anything else.",
        }, 200);
      }
      const paymentStatus = normalizedRefundState === "succeeded" ? "refunded" : "paid";
      let orderUpdate = admin.from("orders").update({
        status: "cancelled",
        paymongo_refund_id: refundId,
        paymongo_refund_transfer_link: isQrph ? refundTransferLink || null : null,
        cancellation_refund_status: normalizedRefundState,
        cancellation_refund_error: null,
        payment_status: paymentStatus,
        ...(order.customer_id === null ? { guest_cancel_token_hash: null } : {}),
        updated_at: new Date().toISOString(),
      })
        .eq("id", orderId)
        .eq("restaurant_id", order.restaurant_id)
        .eq("status", "pending")
        .eq("payment_status", "paid");
      if (order.customer_id === null) {
        orderUpdate = orderUpdate.is("customer_id", null).eq("guest_cancel_token_hash", guestTokenHash);
      } else {
        orderUpdate = orderUpdate.eq("customer_id", order.customer_id);
      }
      const { data: cancelledOrder, error: updateError } = await orderUpdate.select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!cancelledOrder) {
        await admin.from("orders").update({
          paymongo_refund_id: refundId,
          cancellation_refund_status: refundState,
          cancellation_refund_error: "PayMongo accepted the refund, but the order changed before cancellation could be saved. Review the order before any further action.",
          payment_status: paymentStatus,
          updated_at: new Date().toISOString(),
        }).eq("id", orderId).eq("restaurant_id", order.restaurant_id);
        return jsonResponse({
          cancelled: false,
          refundStatus: refundState,
          error: "PayMongo accepted the refund, but the order changed before cancellation finished. Do not issue another refund; review this order.",
        }, 409);
      }

      return jsonResponse({
        cancelled: true,
        refundStatus: normalizedRefundState,
        refundTransferLink: isQrph ? refundTransferLink || null : null,
        message: isQrph && refundTransferLink
          ? "Your order has been cancelled. PayMongo created a QR Ph refund claim link; open the link below to claim your refund."
          : normalizedRefundState === "succeeded"
            ? "Your order has been cancelled and PayMongo accepted the refund."
            : "Your order has been cancelled. The PayMongo refund is processing.",
      }, 200);
    } catch (refundError) {
      const message = refundError instanceof Error ? refundError.message : "PayMongo refund failed.";
      await admin.from("orders").update({
        cancellation_refund_status: "failed",
        cancellation_refund_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", orderId).eq("status", "pending").eq("payment_status", "paid");
      console.error("Customer cancellation refund failed", { orderId, message });
      return jsonResponse({
        cancelled: false,
        refundStatus: "failed",
        error: `PayMongo did not accept the refund, so your order remains pending and was not cancelled. ${message.slice(0, 350)}`,
      }, 422);
    }
  } catch (error) {
    console.error("cancel-customer-order error", error);
    return jsonResponse({ error: "Unable to cancel this order right now. Please try again." }, 500);
  }
});
