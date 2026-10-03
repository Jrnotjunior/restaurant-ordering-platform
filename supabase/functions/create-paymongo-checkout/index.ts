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

    const { data: pendingPayment, error: paymentError } = await adminClient
      .from("pending_online_payments")
      .select("id,reference_number,customer_name,mobile_number,items,subtotal,delivery_fee,total,status,checkout_session_id,checkout_url,loyalty_discount_amount")
      .eq("id", orderId)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!pendingPayment) return jsonResponse({ error: "Pending payment not found." }, 404);
    if (pendingPayment.status !== "pending") {
      return jsonResponse({ error: "This payment is no longer awaiting payment." }, 409);
    }

    if (pendingPayment.checkout_url) {
      return jsonResponse({ checkoutUrl: pendingPayment.checkout_url }, 200);
    }

    const storedItems = Array.isArray(pendingPayment.items) ? pendingPayment.items : [];
    if (!storedItems.length) return jsonResponse({ error: "The payment has no items." }, 400);

    const loyaltyDiscount = Math.round(Number(pendingPayment.loyalty_discount_amount ?? 0) * 100);
    const productUnits: Array<{ name: string; description: string; amount: number; currency: "PHP"; quantity: number }> = [];

    for (const item of storedItems as Array<{ product_name: string; unit_price: number; quantity: number }>) {
      const unitAmount = Math.round(Number(item.unit_price) * 100);
      for (let index = 0; index < Number(item.quantity); index += 1) {
        productUnits.push({
          name: item.product_name,
          description: item.product_name,
          amount: unitAmount,
          currency: "PHP",
          quantity: 1,
        });
      }
    }

    let remainingDiscount = loyaltyDiscount;
    for (const item of productUnits) {
      if (remainingDiscount <= 0) break;
      const reduction = Math.min(item.amount, remainingDiscount);
      item.amount -= reduction;
      remainingDiscount -= reduction;
    }

    const lineItems = productUnits.filter((item) => item.amount > 0);
    if (!lineItems.length) {
      return jsonResponse({ error: "The discounted payment amount must be greater than zero." }, 409);
    }

    const deliveryFee = Math.round(Number(pendingPayment.delivery_fee ?? 0) * 100);
    if (deliveryFee > 0) {
      lineItems.push({
        name: "Delivery fee",
        description: "Restaurant delivery fee",
        amount: deliveryFee,
        currency: "PHP",
        quantity: 1,
      });
    }

    if (remainingDiscount > 0) {
      return jsonResponse({ error: "The loyalty discount could not be applied to the payment items." }, 409);
    }

    const lineItemTotal = lineItems.reduce((sum, item) => sum + item.amount * item.quantity, 0);
    if (lineItemTotal !== Math.round(Number(pendingPayment.total) * 100)) {
      return jsonResponse({ error: "The payment amount could not be verified. Please try again." }, 409);
    }

    const response = await fetch("https://api.paymongo.com/v2/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${paymongoSecretKey}:`)}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `online-payment-${pendingPayment.id}`,
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: lineItems,
            payment_method_types: ["card", "gcash", "qrph", "grab_pay", "paymaya", "billease", "dob"],
            description: `Online payment for ${pendingPayment.reference_number}`,
            reference_number: pendingPayment.reference_number,
            success_url: `${siteBaseUrl}?payment=processing&reference=${encodeURIComponent(pendingPayment.reference_number)}#checkout`,
            cancel_url: `${siteBaseUrl}?payment=not_completed#checkout`,
            send_email_receipt: false,
            show_description: true,
            show_line_items: true,
            metadata: {
              payment_id: pendingPayment.id,
              reference_number: pendingPayment.reference_number,
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
