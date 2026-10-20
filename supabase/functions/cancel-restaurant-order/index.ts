import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-restaurant-domain, x-restaurant-slug",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

function serviceKey() {
  try {
    return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default
      ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      ?? "";
  } catch {
    return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  }
}

function payKey(environment: "test" | "live") {
  const expectedPrefix = environment === "live" ? "sk_live_" : "sk_test_";
  const dedicated = environment === "live"
    ? Deno.env.get("PAYMONGO_LIVE_SECRET_KEY") ?? ""
    : Deno.env.get("PAYMONGO_TEST_SECRET_KEY") ?? "";
  if (dedicated.startsWith(expectedPrefix)) return dedicated;
  const legacy = Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
  return legacy.startsWith(expectedPrefix) ? legacy : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ error: "Method not allowed" }, 405);

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const key = serviceKey();
    if (!token || !url || !anon || !key) return out({ error: "Please sign in again." }, 401);

    const user = createClient(url, anon, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await user.auth.getUser(token);
    if (userError || !userData.user) return out({ error: "Your session has expired." }, 401);

    const body = await req.json().catch(() => ({}));
    const id = String(body.orderId ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return out({ error: "A valid order is required." }, 400);
    }

    const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: order, error: orderError } = await db.from("orders")
      .select("id,restaurant_id,status,payment_status,paymongo_payment_id,paymongo_refund_id,order_number")
      .eq("id", id).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return out({ error: "Order not found." }, 404);

    const { data: restaurant, error: restaurantError } = await db.from("restaurants")
      .select("owner_id").eq("id", order.restaurant_id).maybeSingle();
    if (restaurantError) throw restaurantError;

    let authorized = restaurant?.owner_id === userData.user.id;
    if (!authorized) {
      const { data: staff, error: staffError } = await db.from("restaurant_staff")
        .select("role")
        .eq("restaurant_id", order.restaurant_id)
        .eq("auth_user_id", userData.user.id)
        .eq("is_active", true)
        .eq("role", "cashier")
        .maybeSingle();
      if (staffError) throw staffError;
      authorized = Boolean(staff);
    }
    if (!authorized) return out({ error: "Only the restaurant owner or an active cashier can cancel orders." }, 403);
    if (order.status !== "pending") {
      return out({ error: "This order can only be cancelled before it is confirmed or sent to the kitchen." }, 409);
    }

    const paidOnline = order.payment_status === "paid" && Boolean(String(order.paymongo_payment_id ?? "").trim());
    if (order.payment_status === "paid" && !paidOnline) {
      return out({ error: "The online payment reference is missing. Please contact support before cancelling this paid order." }, 409);
    }
    if (!["pending", "paid"].includes(order.payment_status)) {
      return out({ error: "This payment is not eligible for cancellation." }, 409);
    }

    const cancelWithoutRefund = async () => {
      const { data: changed, error } = await db.from("orders").update({
        status: "cancelled",
        cancellation_refund_status: "not_required",
        cancellation_refund_error: null,
        updated_at: new Date().toISOString(),
      })
        .eq("id", id)
        .eq("restaurant_id", order.restaurant_id)
        .eq("status", "pending")
        .eq("payment_status", order.payment_status)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return Boolean(changed);
    };

    if (!paidOnline) {
      if (!await cancelWithoutRefund()) return out({ error: "Order status changed. Refresh and check its current status." }, 409);
      return out({ cancelled: true, refundStatus: "not_required", message: "Order cancelled. No online refund was needed." });
    }

    // A paid order is NOT cancelled until PayMongo accepts the refund request.
    // This avoids leaving an order cancelled and still paid when the provider rejects
    // the first refund attempt (for example, a sandbox payment method restriction).
    const configuredEnvironment = String(Deno.env.get("PAYMONGO_ENVIRONMENT") ?? "").trim();
    const legacyKey = Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
    const environment: "test" | "live" =
      configuredEnvironment === "live" || configuredEnvironment === "test"
        ? configuredEnvironment
        : legacyKey.startsWith("sk_live_") ? "live" : "test";

    const failRefund = async (message: string, status = 422) => {
      await db.from("orders").update({
        cancellation_refund_status: "failed",
        cancellation_refund_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
        .eq("id", id)
        .eq("restaurant_id", order.restaurant_id)
        .eq("status", "pending")
        .eq("payment_status", "paid");
      return out({
        cancelled: false,
        refundStatus: "failed",
        error: `PayMongo did not accept the refund, so the order remains open and has not been cancelled. ${message}`,
      }, status);
    };

    const secret = payKey(environment);
    if (!secret) return await failRefund("PayMongo secret key is not configured for this payment environment.");

    const { data: connection, error: connectionError } = await db.from("restaurant_paymongo_accounts")
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
    const accountId = isParentTestSandbox ? "" : String(connection?.paymongo_account_id ?? "").trim();
    if (!connection || (!isParentTestSandbox && (connection.connection_status !== "active" || !accountId))) {
      return await failRefund("The tenant's PayMongo connection is not active for this environment.");
    }

    const headers: Record<string, string> = {
      Authorization: "Basic " + btoa(secret + ":"),
      "Content-Type": "application/json",
      ...(accountId ? { "Account-ID": accountId } : {}),
    };

    const { data: reservedOrder, error: reservationError } = await db.from("orders").update({
      cancellation_refund_status: "processing",
      cancellation_refund_error: null,
      updated_at: new Date().toISOString(),
    })
      .eq("id", id)
      .eq("restaurant_id", order.restaurant_id)
      .eq("status", "pending")
      .eq("payment_status", "paid")
      .or("cancellation_refund_status.is.null,cancellation_refund_status.neq.processing")
      .select("id")
      .maybeSingle();
    if (reservationError) throw reservationError;
    if (!reservedOrder) {
      return out({ error: "A refund request is already processing or this order has changed. Check its current status." }, 409);
    }

    try {
      const paymentResponse = await fetch(
        "https://api.paymongo.com/v1/payments/" + encodeURIComponent(order.paymongo_payment_id),
        { method: "GET", headers },
      );
      const paymentPayload = await paymentResponse.json().catch(() => null);
      const paymentAttributes = paymentPayload?.data?.attributes ?? {};
      if (!paymentResponse.ok || paymentPayload?.data?.id !== order.paymongo_payment_id || paymentAttributes.status !== "paid") {
        throw new Error("The original PayMongo payment could not be verified as paid.");
      }
      if (typeof paymentAttributes.livemode === "boolean" && paymentAttributes.livemode !== (environment === "live")) {
        throw new Error("The original payment environment does not match the tenant's configured PayMongo connection.");
      }

      const sourceType = String(paymentAttributes.source?.type ?? "").toLowerCase();
      const amount = Number(paymentAttributes.amount);
      if (!Number.isSafeInteger(amount) || amount < 100) throw new Error("The original PayMongo payment amount is invalid.");

      // Test and live payments both go through PayMongo's refund API.
      // The parent test sandbox uses the test secret key without an Account-ID;
      // never report a refund unless PayMongo returns a refund resource/status.

      const isQrph = sourceType === "qrph";
      const refundEndpoint = isQrph
        ? "https://refunds-api.paymongo.com/v1/refunds"
        : "https://api.paymongo.com/v1/refunds";
      const refundResponse = await fetch(refundEndpoint, {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "order-cancel-refund-" + id },
        body: JSON.stringify({
          data: {
            attributes: {
              amount,
              payment_id: order.paymongo_payment_id,
              reason: "others",
              notes: "Refund for cancelled Web2Table order " + order.order_number,
            },
          },
        }),
      });
      const refundPayload = await refundResponse.json().catch(() => null);
      if (!refundResponse.ok) {
        const detail = String(refundPayload?.errors?.[0]?.detail ?? refundPayload?.errors?.[0]?.code ?? "PayMongo rejected the refund.");
        return await failRefund(detail.slice(0, 400));
      }

      const refundId = String(refundPayload?.data?.id ?? "");
      const refundStatus = String(refundPayload?.data?.attributes?.status ?? "");
      const refundTransferLink = String(refundPayload?.data?.attributes?.transfer_link ?? "");
      if (!refundId || !["pending", "processing", "refunding", "succeeded"].includes(refundStatus)) {
        return await failRefund("PayMongo did not return a valid refund resource/status.");
      }

      // QR Ph refunds use a separate PayMongo API and create a customer claim
      // link. Store and return that link; QR Ph is not complete until the customer
      // claims the transfer and PayMongo reports the refund as succeeded.
      if (isQrph && !refundTransferLink && refundStatus !== "succeeded") {
        const { error: auditError } = await db.from("orders").update({
          status: "cancelled",
          paymongo_refund_id: refundId,
          paymongo_refund_transfer_link: null,
          cancellation_refund_status: "manual_review",
          cancellation_refund_error: "PayMongo created a QR Ph refund but did not return its transfer link. Check the PayMongo dashboard; do not submit another refund.",
          payment_status: "paid",
          updated_at: new Date().toISOString(),
        }).eq("id", id).eq("restaurant_id", order.restaurant_id).eq("status", "pending").eq("payment_status", "paid");
        if (auditError) throw auditError;
        return out({
          cancelled: true,
          refundStatus: "manual_review",
          message: "PayMongo created the QR Ph refund, but no customer claim link was returned. Check the PayMongo dashboard before taking further action.",
        });
      }

      const now = new Date().toISOString();
      const updates = {
        status: "cancelled",
        paymongo_refund_id: refundId,
        paymongo_refund_transfer_link: isQrph ? refundTransferLink || null : null,
        cancellation_refund_status: refundStatus === "refunding" ? "processing" : refundStatus,
        cancellation_refund_error: null,
        payment_status: refundStatus === "succeeded" ? "refunded" : "paid",
        updated_at: now,
      };
      const { data: changed, error: updateError } = await db.from("orders").update(updates)
        .eq("id", id)
        .eq("restaurant_id", order.restaurant_id)
        .eq("status", "pending")
        .eq("payment_status", "paid")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!changed) {
        // PayMongo has accepted the request. Preserve its ID so no one creates a
        // second refund, but do not overwrite an order that advanced concurrently.
        await db.from("orders").update({
          paymongo_refund_id: refundId,
          cancellation_refund_status: refundStatus,
          cancellation_refund_error: "PayMongo accepted the refund, but the order status changed before cancellation could be saved. Review the order before taking further action.",
          payment_status: refundStatus === "succeeded" ? "refunded" : "paid",
          updated_at: now,
        }).eq("id", id).eq("restaurant_id", order.restaurant_id);
        return out({
          cancelled: false,
          refundStatus,
          error: "PayMongo accepted the refund, but the order status changed before cancellation finished. Do not issue another refund; review this order.",
        }, 409);
      }

      return out({
        cancelled: true,
        refundStatus: refundStatus === "refunding" ? "processing" : refundStatus,
        refundTransferLink: isQrph ? refundTransferLink || null : null,
        message: isQrph && refundTransferLink
          ? "Order cancelled. PayMongo created a QR Ph refund claim link; share the link with the customer to complete the refund."
          : isQrph && refundStatus !== "succeeded"
            ? "PayMongo created a QR Ph refund, but no claim link was returned. Check the PayMongo dashboard before taking further action."
            : refundStatus === "succeeded"
              ? "Order cancelled and PayMongo accepted the refund."
              : "Order cancelled. PayMongo refund is processing.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PayMongo refund request failed.";
      return await failRefund(message);
    }
  } catch (error) {
    console.error("cancel-restaurant-order error", error);
    return out({ error: "Unable to cancel this order right now. Please try again." }, 500);
  }
});
