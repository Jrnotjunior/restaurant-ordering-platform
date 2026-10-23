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

function getSecretKey() {
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

const GITHUB_PAGES_ORIGIN = "https://jrnotjunior.github.io";
const GITHUB_PAGES_RETURN_BASE = "https://jrnotjunior.github.io/restaurant-ordering-platform/";

function getRestaurantSiteBaseUrl(customDomain: unknown, requestOrigin: string | null): string | null {
  if (requestOrigin === GITHUB_PAGES_ORIGIN) return GITHUB_PAGES_RETURN_BASE;

  const configuredDomain = String(customDomain ?? "").trim();
  if (!configuredDomain) return null;

  try {
    const candidate = new URL(
      configuredDomain.includes("://") ? configuredDomain : `https://${configuredDomain}`,
    );
    if (
      candidate.protocol !== "https:" ||
      !candidate.hostname ||
      candidate.username ||
      candidate.password ||
      candidate.port ||
      candidate.pathname !== "/" ||
      candidate.search ||
      candidate.hash
    ) return null;

    return `${candidate.origin}/`;
  } catch {
    return null;
  }
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

function getPaymentMethodTypes(configuredMethods: unknown): string[] {
  const methodSettings = configuredMethods && typeof configuredMethods === "object" && !Array.isArray(configuredMethods)
    ? configuredMethods as Record<string, unknown>
    : {};
  return [
    ...(methodSettings.card === true ? ["card"] : []),
    ...(methodSettings.gcash !== false ? ["gcash"] : []),
    ...(methodSettings.qrph !== false ? ["qrph"] : []),
    ...(methodSettings.grab_pay !== false ? ["grab_pay"] : []),
    ...(methodSettings.paymaya !== false ? ["paymaya"] : []),
    ...(methodSettings.dob !== false ? ["dob"] : []),
    ...(methodSettings.billease === true ? ["billease"] : []),
  ];
}

function isParentTestSandboxConnection(
  environment: "test" | "live",
  connection: Record<string, unknown> | null | undefined,
): boolean {
  return environment === "test"
    && connection?.onboarding_step === "test_simulation"
    && connection?.connection_status === "pending"
    && connection?.activation_status === "mock"
    && !connection?.paymongo_account_id
    && !connection?.webhook_secret_id;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = getSecretKey();
    const configuredPayMongoEnvironment = String(Deno.env.get("PAYMONGO_ENVIRONMENT") ?? "").trim();
    const legacyPayMongoKey = Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
    const paymongoEnvironment: "test" | "live" =
      configuredPayMongoEnvironment === "live" || configuredPayMongoEnvironment === "test"
        ? configuredPayMongoEnvironment
        : legacyPayMongoKey.startsWith("sk_live_") ? "live" : "test";
    const paymongoSecretKey = getPayMongoSecretKey(paymongoEnvironment);

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase server configuration is incomplete." }, 500);
    }
    if (!paymongoSecretKey) {
      return jsonResponse({ error: "Online payment is not configured yet. Please contact the restaurant." }, 500);
    }

    const body = await request.json();
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (body?.action === "preflight") {
      const restaurantId = String(body.restaurantId ?? "").trim();
      if (!restaurantId) return jsonResponse({ error: "Restaurant is required." }, 400);

      const { data: restaurant, error: restaurantError } = await adminClient
        .from("restaurants")
        .select("id,custom_domain,online_payment_methods")
        .eq("id", restaurantId)
        .maybeSingle();
      if (restaurantError) throw restaurantError;
      if (!restaurant) return jsonResponse({ error: "This restaurant could not be found." }, 404);

      const requestOrigin = request.headers.get("origin");
      const siteBaseUrl = getRestaurantSiteBaseUrl(restaurant.custom_domain, requestOrigin);
      if (!siteBaseUrl) {
        return jsonResponse({ error: "This restaurant storefront domain is not configured correctly. Please contact the restaurant before trying payment again." }, 409);
      }

      if (getPaymentMethodTypes(restaurant.online_payment_methods).length === 0) {
        return jsonResponse({ error: "This restaurant has no online payment methods enabled. Please contact the restaurant." }, 409);
      }

      const { data: connection, error: connectionError } = await adminClient
        .from("restaurant_paymongo_accounts")
        .select("paymongo_account_id,connection_status,webhook_secret_id,onboarding_step,activation_status")
        .eq("restaurant_id", restaurantId)
        .eq("environment", paymongoEnvironment)
        .maybeSingle();
      if (connectionError) throw connectionError;
      if (!connection) {
        return jsonResponse({
          error: `This restaurant has not configured its PayMongo ${paymongoEnvironment} payment connection yet.`,
        }, 409);
      }

      const parentTestSandbox = isParentTestSandboxConnection(paymongoEnvironment, connection);
      if (!parentTestSandbox && (
        connection.connection_status !== "active"
        || !connection.paymongo_account_id
        || !connection.webhook_secret_id
      )) {
        return jsonResponse({
          error: `This restaurant's PayMongo ${paymongoEnvironment} child account is not ready for online payments yet.`,
        }, 409);
      }

      return jsonResponse({ ready: true, environment: paymongoEnvironment }, 200);
    }

    const orderId = String(body.orderId ?? "").trim();
    if (!orderId) return jsonResponse({ error: "Order is required." }, 400);

    const { data: pendingPayment, error: paymentError } = await adminClient
      .from("pending_online_payments")
      .select("id,restaurant_id,reference_number,customer_name,mobile_number,items,subtotal,delivery_fee,total,status,checkout_session_id,checkout_url,loyalty_discount_amount")
      .eq("id", orderId)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!pendingPayment) return jsonResponse({ error: "Pending payment not found." }, 404);
    const { data: restaurantDomain, error: restaurantDomainError } = await adminClient
      .from("restaurants")
      .select("custom_domain,online_payment_methods")
      .eq("id", pendingPayment.restaurant_id)
      .maybeSingle();
    if (restaurantDomainError) throw restaurantDomainError;
    const requestOrigin = request.headers.get("origin");
    const isGitHubPagesTest = requestOrigin === GITHUB_PAGES_ORIGIN;
    const siteBaseUrl = getRestaurantSiteBaseUrl(restaurantDomain?.custom_domain, requestOrigin);
    if (!siteBaseUrl) {
      console.error("PayMongo checkout blocked: restaurant custom domain is missing or invalid", {
        paymentId: pendingPayment.id,
        restaurantId: pendingPayment.restaurant_id,
      });
      return jsonResponse({ error: "This restaurant storefront domain is not configured correctly. Please contact the restaurant before trying payment again." }, 409);
    }
    if (restaurantDomain?.online_payment_methods?.enabled === false) {
      return jsonResponse({ error: "Online payments are currently turned off by this restaurant. Please choose another payment method." }, 409);
    }
    if (pendingPayment.status !== "pending") {
      return jsonResponse({ error: "This payment is no longer awaiting payment." }, 409);
    }

    const { data: paymongoConnection, error: paymongoConnectionError } = await adminClient
      .from("restaurant_paymongo_accounts")
      .select("paymongo_account_id,connection_status,webhook_secret_id,onboarding_step,activation_status")
      .eq("restaurant_id", pendingPayment.restaurant_id)
      .eq("environment", paymongoEnvironment)
      .maybeSingle();

    if (paymongoConnectionError) throw paymongoConnectionError;

    if (!paymongoConnection) {
      return jsonResponse({
        error: `This restaurant has not configured its PayMongo ${paymongoEnvironment} payment connection yet.`,
      }, 409);
    }

    const isParentTestSandbox = isParentTestSandboxConnection(paymongoEnvironment, paymongoConnection);

    if (isParentTestSandbox) {
      // Parent-account sandbox checkout only. No fake child ID or Account-ID
      // header is used, so this does not claim or simulate child account routing.
      if (paymongoConnection.activation_status !== "mock") {
        return jsonResponse({ error: "The PayMongo parent sandbox is not in a valid state." }, 409);
      }
    } else if (
      paymongoConnection.connection_status !== "active" ||
      !paymongoConnection.paymongo_account_id ||
      !paymongoConnection.webhook_secret_id
    ) {
      return jsonResponse({
        error: `This restaurant's PayMongo ${paymongoEnvironment} child account is not ready for online payments yet.`,
      }, 409);
    }

    // Test parent sandbox deliberately omits Account-ID. A real active child
    // connection always uses its own persisted tenant account ID.
    const linkedPayMongoAccountId = isParentTestSandbox
      ? ""
      : String(paymongoConnection.paymongo_account_id ?? "").trim();
    if (pendingPayment.checkout_url && !isGitHubPagesTest) {
      return jsonResponse({ checkoutUrl: pendingPayment.checkout_url }, 200);
    }

    // Payment methods are configured per restaurant. Optional methods are
    // disabled unless explicitly enabled in that restaurant's settings.
    const paymentMethodTypes = getPaymentMethodTypes(restaurantDomain?.online_payment_methods);
    if (paymentMethodTypes.length === 0) {
      return jsonResponse({ error: "This restaurant has no online payment methods enabled. Please contact the restaurant." }, 409);
    }

    const storedItems = Array.isArray(pendingPayment.items) ? pendingPayment.items : [];
    if (!storedItems.length) return jsonResponse({ error: "The payment has no items." }, 400);

    // PayMongo Checkout line items do not document native discount lines.
    // Keep product prices intact in Web2Table and represent the discounted
    // merchandise as one aggregate line in PayMongo, rather than silently
    // reducing the price of the first product.
    const subtotal = Math.round(Number(pendingPayment.subtotal ?? 0) * 100);
    const loyaltyDiscount = Math.round(Number(pendingPayment.loyalty_discount_amount ?? 0) * 100);
    const deliveryFee = Math.round(Number(pendingPayment.delivery_fee ?? 0) * 100);
    const expectedTotal = Math.round(Number(pendingPayment.total) * 100);

    if (
      !Number.isSafeInteger(subtotal) || subtotal < 0 ||
      !Number.isSafeInteger(loyaltyDiscount) || loyaltyDiscount < 0 || loyaltyDiscount > subtotal ||
      !Number.isSafeInteger(deliveryFee) || deliveryFee < 0 ||
      !Number.isSafeInteger(expectedTotal) || expectedTotal <= 0 ||
      subtotal - loyaltyDiscount + deliveryFee !== expectedTotal
    ) {
      console.error("PayMongo amount verification failed", {
        paymentId: pendingPayment.id,
        subtotal,
        loyaltyDiscount,
        deliveryFee,
        expectedTotal,
      });
      return jsonResponse({ error: "The payment amount could not be verified. Please try again." }, 409);
    }

    const discountedMerchandiseTotal = subtotal - loyaltyDiscount;
    const lineItems: Array<{ name: string; description: string; amount: number; currency: "PHP"; quantity: number }> = [
      {
        // PayMongo's hosted summary labels the sum of line items as "Subtotal".
        // Use one all-in line item so customers do not see the delivery fee
        // separately and mistake the displayed subtotal for an extra charge.
        name: deliveryFee > 0 ? "Order total (delivery included)" : "Order total",
        description: [
          `Food subtotal PHP ${(subtotal / 100).toFixed(2)}`,
          loyaltyDiscount > 0 ? `Loyalty discount -PHP ${(loyaltyDiscount / 100).toFixed(2)}` : "",
          deliveryFee > 0 ? `Delivery fee PHP ${(deliveryFee / 100).toFixed(2)} (included)` : "",
        ].filter(Boolean).join(" | "),
        amount: expectedTotal,
        currency: "PHP",
        quantity: 1,
      },
    ];

    if (expectedTotal <= 0 || discountedMerchandiseTotal + deliveryFee !== expectedTotal) {
      return jsonResponse({ error: "The discounted payment amount could not be verified. Please try again." }, 409);
    }

    const lineItemTotal = lineItems.reduce((sum, item) => sum + item.amount * item.quantity, 0);
    if (lineItemTotal !== expectedTotal) {
      console.error("PayMongo amount verification failed", {
        paymentId: pendingPayment.id,
        lineItemTotal,
        expectedTotal,
        subtotal: pendingPayment.subtotal,
        deliveryFee: pendingPayment.delivery_fee,
        loyaltyDiscount: pendingPayment.loyalty_discount_amount,
      });
      return jsonResponse({ error: "The payment amount could not be verified. Please try again." }, 409);
    }

    const response = await fetch("https://api.paymongo.com/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${paymongoSecretKey}:`)}`,
        "Content-Type": "application/json",
        "Idempotency-Key": isGitHubPagesTest
          ? `online-payment-${pendingPayment.id}-github-pages`
          : `online-payment-${pendingPayment.id}`,
        ...(linkedPayMongoAccountId ? { "Account-ID": linkedPayMongoAccountId } : {}),
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: lineItems,
            payment_method_types: paymentMethodTypes,
            description: [
              `Online payment for ${pendingPayment.reference_number}`,
              `Subtotal PHP ${Number(pendingPayment.subtotal).toFixed(2)}`,
              loyaltyDiscount > 0 ? `Loyalty discount -PHP ${(loyaltyDiscount / 100).toFixed(2)}` : "",
              deliveryFee > 0 ? `Delivery fee PHP ${(deliveryFee / 100).toFixed(2)}` : "",
            ].filter(Boolean).join(" | "),
            reference_number: pendingPayment.reference_number,
            success_url: `${siteBaseUrl}?payment=processing&reference=${encodeURIComponent(pendingPayment.reference_number)}#checkout`,
            cancel_url: `${siteBaseUrl}?payment=not_completed#checkout`,
            send_email_receipt: false,
            show_description: true,
            show_line_items: false,
            metadata: {
              payment_id: pendingPayment.id,
              reference_number: pendingPayment.reference_number,
              restaurant_id: pendingPayment.restaurant_id,
            },
          },
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("PayMongo checkout creation failed", payload);
      const paymongoError = payload?.errors?.[0];
      const detail = typeof paymongoError?.detail === "string" ? paymongoError.detail : "";
      const code = typeof paymongoError?.code === "string" ? paymongoError.code : "";
      return jsonResponse({
        error: detail || "Unable to start online payment. Please try again.",
        ...(code ? { code } : {}),
      }, 502);
    }

    const checkoutUrl = payload?.data?.attributes?.checkout_url;
    if (!checkoutUrl) {
      console.error("PayMongo response did not include checkout_url", payload);
      return jsonResponse({ error: "Online payment could not be started." }, 502);
    }

    await adminClient
      .from("pending_online_payments")
      .update({ checkout_session_id: payload?.data?.id ?? null, checkout_url: checkoutUrl })
      .eq("id", pendingPayment.id)
      .eq("status", "pending");

    return jsonResponse({ checkoutUrl }, 200);
  } catch (error) {
    console.error("create-paymongo-checkout error", error);
    return jsonResponse({ error: "Unable to start online payment. Please try again." }, 500);
  }
});
