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
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
  return secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function getPayMongoSecretKey() {
  return Deno.env.get("PAYMONGO_SECRET_KEY") ?? "";
}

const siteBaseUrl = "https://jrnotjunior.github.io/restaurant-ordering-platform/";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = getSecretKey();
    const paymongoSecretKey = getPayMongoSecretKey();

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase server configuration is incomplete." }, 500);
    }
    if (!paymongoSecretKey) {
      return jsonResponse({ error: "Online payment is not configured yet. Please contact the restaurant." }, 500);
    }

    const body = await request.json();
    const orderId = String(body.orderId ?? "").trim();
    if (!orderId) return jsonResponse({ error: "Order is required." }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("id,order_number,customer_name,mobile_number,payment_method,payment_status,status,delivery_fee,total")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order) return jsonResponse({ error: "Order not found." }, 404);
    if (order.payment_method !== "gcash") return jsonResponse({ error: "This order is not an online payment order." }, 400);
    if (order.payment_status !== "pending") return jsonResponse({ error: "This order is no longer awaiting payment." }, 409);

    const { data: items, error: itemsError } = await adminClient
      .from("order_items")
      .select("product_name,quantity,unit_price,line_total")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (itemsError) throw itemsError;
    if (!items?.length) return jsonResponse({ error: "The order has no items." }, 400);

    const lineItems = items.map((item) => ({
      name: item.product_name,
      description: item.product_name,
      amount: Math.round(Number(item.unit_price) * 100),
      currency: "PHP",
      quantity: Number(item.quantity),
    }));

    const deliveryFee = Math.round(Number(order.delivery_fee ?? 0) * 100);
    if (deliveryFee > 0) {
      lineItems.push({
        name: "Delivery fee",
        description: "Restaurant delivery fee",
        amount: deliveryFee,
        currency: "PHP",
        quantity: 1,
      });
    }

    const lineItemTotal = lineItems.reduce((sum, item) => sum + item.amount * item.quantity, 0);
    if (lineItemTotal !== Math.round(Number(order.total) * 100)) {
      return jsonResponse({ error: "The payment amount could not be verified. Please try again." }, 409);
    }

    const response = await fetch("https://api.paymongo.com/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${paymongoSecretKey}:`)}`,
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: lineItems,
            payment_method_types: ["card", "gcash", "qrph", "grab_pay", "paymaya", "billease", "dob"],
            description: `Online payment for order ${order.order_number}`,
            reference_number: order.order_number,
            success_url: `${siteBaseUrl}#order/${encodeURIComponent(order.order_number)}`,
            cancel_url: `${siteBaseUrl}#order/${encodeURIComponent(order.order_number)}`,
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            metadata: {
              order_id: order.id,
              order_number: order.order_number,
            },
          },
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error("PayMongo checkout creation failed", payload);
      return jsonResponse({ error: "Unable to start online payment. Please try again." }, 502);
    }

    const checkoutUrl = payload?.data?.attributes?.checkout_url;
    if (!checkoutUrl) {
      console.error("PayMongo response did not include checkout_url", payload);
      return jsonResponse({ error: "Online payment could not be started." }, 502);
    }

    return jsonResponse({ checkoutUrl }, 200);
  } catch (error) {
    console.error("create-paymongo-checkout error", error);
    return jsonResponse({ error: "Unable to start online payment. Please try again." }, 500);
  }
});
