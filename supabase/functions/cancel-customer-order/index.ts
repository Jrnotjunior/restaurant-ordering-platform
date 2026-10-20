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

    // Unpaid orders can be cancelled immediately. Paid orders remain pending until
    // PayMongo verifies the test payment/refund path or accepts a real refund.
    if (!paidOnline) {
      if (order.customer_id === null) {
        const { data: changedOrder, error: guestCancelError } = await admin.from("orders")
          .update({
            status: "cancelled",
            cancellation_refund_status: "not_required",
            cancellation_refund_error: null,
            guest_cancel_token_hash: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", orderId)
          .eq("restaurant_id", order.restaurant_id)
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
          return jsonResponse({ error: cancelError.message || "Unable to cancel this order." }, 409);
        }
      }
      return jsonResponse({ cancelled: true, refundStatus: "not_required", message: "Your order has been cancelled." }, 200);
    }

    // Reserve this paid order while refund eligibility is checked. A failed
    // check releases the reservation and leaves the order pending.
    let reservationQuery = admin.from("orders").update({
      cancellation_refund_status: "processing",
      cancellation_refund_error: null,
      updated_at: new Date().toISOString(),
    })
      .eq("id", orderId)
      .eq("restaurant_id", order.restaurant_id)
      .eq("status", "pending")
      .eq("payment_status", "paid")
      .or("cancellation_refund_status.is.null,cancellation_refund_status.neq.processing");
    if (order.customer_id === null) {
      reservationQuery = reservationQuery.is("customer_id", null).eq("guest_cancel_token_hash", guestTokenHash);
    } else {
      reservationQuery = reservationQuery.eq("customer_id", order.customer_id);
    }
    const { data: reservedOrder, error: reservationError } = await reservationQuery.select("id").maybeSingle();
    if (reservationError) throw reservationError;
    if (!reservedOrder) {
      return jsonResponse({ error: "A refund operation is already processing or this order has changed. Check its current status." }, 409);
    }

    const failRefund = async (message: string, status = 422) => {
      await admin.from("orders").update({
        cancellation_refund_status: "failed",
        cancellation_refund_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
        .eq("id", orderId)
        .eq("restaurant_id", order.restaurant_id)
        .eq("status", "pending")
        .eq("payment_status", "paid")
        .eq("cancellation_refund_status", "processing");
      return jsonResponse({
        cancelled: false,
        refundStatus: "failed",
        error: `PayMongo did not accept the refund, so the order remains pending and was not cancelled. ${message}`,
      }, status);
    };

    const configuredPayMongoEnvironment = String(Deno.env.get("PAYMONGO_ENVIRONMENT") ?? "").trim();
    const legacyPayMongoKey = Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
    const environment: "test" | "live" =
      configuredPayMongoEnvironment === "live" || configuredPayMongoEnvironment === "test"
        ? configuredPayMongoEnvironment
        : legacyPayMongoKey.startsWith("sk_live_") ? "live" : "test";
    const secretKey = getPayMongoSecretKey(environment);
    if (!secretKey) {
      return await failRefund("PayMongo secret key is not configured for this payment environment.");
    }

    const { data: connection, error: connectionError } = await admin.from("restaurant_paymongo_accounts")
      .select("paymongo_account_id,connection_status,environment,onboarding_step,activation_status,webhook_secret_id")
      .eq("restaurant_id", order.restaurant_id)
      .eq("environment", environment)
      .maybeSingle();
    if (connectionError) throw connectionError;

    const isParentTestSandbox =
      environment === "test" &&
      connection?.onboarding_step === "test_simulation" &&
      connection.connection_status === "pending" &&
      connection.activation_status === "mock" &&
      !connection.paymongo_account_id &&
      !connection.webhook_secret_id;
    // The parent sandbox uses the parent test key. Never send a fabricated Account-ID.
    const accountId = isParentTestSandbox ? "" : String(connection?.paymongo_account_id ?? "").trim();
    if (!connection || (!isParentTestSandbox && (
      connection.connection_status !== "active" || !accountId
    ))) {
      return await failRefund("The restaurant's PayMongo connection is missing or inactive for this environment.");
    }

    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${secretKey}:`)}`,
      "Content-Type": "application/json",
      ...(accountId ? { "Account-ID": accountId } : {}),
    };

    try {
      const paymentResponse = await fetch(`https://api.paymongo.com/v1/payments/${encodeURIComponent(order.paymongo_payment_id)}`, {
        method: "GET",
        headers,
      });
      const paymentPayload = await paymentResponse.json().catch(() => null);
      const paymentAttributes = paymentPayload?.data?.attributes ?? {};
      if (!paymentResponse.ok || paymentPayload?.data?.id !== order.paymongo_payment_id || paymentAttributes.status !== "paid") {
        throw new Error("The original PayMongo payment could not be verified as paid.");
      }
      if (typeof paymentAttributes.livemode === "boolean" && paymentAttributes.livemode !== (environment === "live")) {
        throw new Error("The original payment environment does not match the tenant's configured PayMongo connection.");
      }

      const amount = Number(paymentAttributes.amount);
      if (!Number.isSafeInteger(amount) || amount < 100) throw new Error("The original PayMongo payment amount is invalid.");

      // Parent test sandbox cancellations are simulated only after verifying that
      // PayMongo identifies the payment as test mode. No real refund is requested.
      if (isParentTestSandbox) {
        if (environment !== "test" || paymentAttributes.livemode !== false) {
          throw new Error("The payment is not verified as a PayMongo test-mode payment; no cancellation or refund was performed.");
        }

        let simulationQuery = admin.from("orders").update({
          status: "cancelled",
          payment_status: "refunded",
          cancellation_refund_status: "simulated",
          cancellation_refund_error: "TEST MODE ONLY: refund flow simulated locally. No funds were moved by PayMongo.",
          paymongo_refund_id: null,
          paymongo_refund_transfer_link: null,
          guest_cancel_token_hash: null,
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
          return jsonResponse({ error: "The order changed while its test refund was being prepared. Refresh and check the current order status." }, 409);
        }
        return jsonResponse({
          cancelled: true,
          refundStatus: "simulated",
          message: "Test mode only: your order was cancelled and the refund flow was simulated successfully. No real funds were moved by PayMongo.",
        }, 200);
      }

      const sourceType = String(paymentAttributes.source?.type ?? "").toLowerCase();
      const isQrph = sourceType === "qrph";
      const refundEndpoint = isQrph
        ? "https://refunds-api.paymongo.com/v1/refunds"
        : "https://api.paymongo.com/v1/refunds";
      const refundResponse = await fetch(refundEndpoint, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": `customer-cancel-refund-${orderId}` },
        body: JSON.stringify({
          data: { attributes: {
            amount,
            payment_id: order.paymongo_payment_id,
            reason: "others",
            notes: `Refund for cancelled Web2Table order ${orderId}`,
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
      const transferLink = String(refundPayload?.data?.attributes?.transfer_link ?? "");
      if (!refundId || !["pending", "processing", "refunding", "succeeded"].includes(refundState)) {
        throw new Error("PayMongo returned an unrecognized refund status.");
      }

      const now = new Date().toISOString();
      if (isQrph && !transferLink && refundState !== "succeeded") {
        let reviewQuery = admin.from("orders").update({
          status: "cancelled",
          paymongo_refund_id: refundId,
          paymongo_refund_transfer_link: null,
          cancellation_refund_status: "manual_review",
          cancellation_refund_error: "PayMongo created a QR Ph refund but did not return its transfer link. Check PayMongo before taking further action.",
          payment_status: "paid",
          guest_cancel_token_hash: null,
          updated_at: now,
        })
          .eq("id", orderId)
          .eq("restaurant_id", order.restaurant_id)
          .eq("status", "pending")
          .eq("payment_status", "paid")
          .eq("cancellation_refund_status", "processing");
        if (order.customer_id === null) {
          reviewQuery = reviewQuery.is("customer_id", null).eq("guest_cancel_token_hash", guestTokenHash);
        } else {
          reviewQuery = reviewQuery.eq("customer_id", order.customer_id);
        }
        const { data: reviewOrder, error: reviewError } = await reviewQuery.select("id").maybeSingle();
        if (reviewError) throw reviewError;
        if (!reviewOrder) {
          return jsonResponse({ error: "PayMongo accepted the QR Ph refund, but the order changed before cancellation was saved. Contact support before taking further action." }, 409);
        }
        return jsonResponse({
          cancelled: true,
          refundStatus: "manual_review",
          message: "The order was cancelled and PayMongo accepted the QR Ph refund request, but no claim link was returned. Check the PayMongo dashboard before taking further action.",
        }, 200);
      }

      const normalizedRefundState = refundState === "refunding" ? "processing" : refundState;
      let finalQuery = admin.from("orders").update({
        status: "cancelled",
        paymongo_refund_id: refundId,
        paymongo_refund_transfer_link: isQrph ? transferLink || null : null,
        cancellation_refund_status: normalizedRefundState,
        cancellation_refund_error: null,
        payment_status: refundState === "succeeded" ? "refunded" : "paid",
        guest_cancel_token_hash: null,
        updated_at: now,
      })
        .eq("id", orderId)
        .eq("restaurant_id", order.restaurant_id)
        .eq("status", "pending")
        .eq("payment_status", "paid")
        .eq("cancellation_refund_status", "processing");
      if (order.customer_id === null) {
        finalQuery = finalQuery.is("customer_id", null).eq("guest_cancel_token_hash", guestTokenHash);
      } else {
        finalQuery = finalQuery.eq("customer_id", order.customer_id);
      }
      const { data: changedOrder, error: updateError } = await finalQuery.select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!changedOrder) {
        // PayMongo has accepted the refund. Preserve the refund ID so it cannot
        // be duplicated, but never overwrite a newer order state.
        await admin.from("orders").update({
          paymongo_refund_id: refundId,
          paymongo_refund_transfer_link: isQrph ? transferLink || null : null,
          cancellation_refund_status: normalizedRefundState,
          cancellation_refund_error: "PayMongo accepted the refund, but the order status changed before cancellation could be saved. Review the order; do not submit another refund.",
          payment_status: refundState === "succeeded" ? "refunded" : "paid",
          updated_at: now,
        }).eq("id", orderId).eq("restaurant_id", order.restaurant_id);
        return jsonResponse({
          cancelled: false,
          refundStatus: normalizedRefundState,
          error: "PayMongo accepted the refund, but the order status changed before cancellation could finish. Do not issue another refund; review this order.",
        }, 409);
      }

      return jsonResponse({
        cancelled: true,
        refundStatus: normalizedRefundState,
        refundTransferLink: isQrph ? transferLink || null : null,
        message: isQrph && transferLink
          ? "Your order was cancelled. PayMongo created a QR Ph refund claim link; use the link provided to complete the refund."
          : refundState === "succeeded"
            ? "Your order has been cancelled and the refund completed successfully."
            : "Your order has been cancelled. The PayMongo refund is being processed.",
      }, 200);
    } catch (refundError) {
      const message = refundError instanceof Error ? refundError.message : "PayMongo refund failed.";
      console.error("Customer cancellation refund failed", { orderId, message });
      return await failRefund(message);
    }
  } catch (error) {
    console.error("cancel-customer-order error", error);
    return jsonResponse({ error: "Unable to cancel this order right now. Please try again." }, 500);
  }
});
