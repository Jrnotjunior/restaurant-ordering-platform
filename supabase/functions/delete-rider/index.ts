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

function getPublishableKey() {
  const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
  return publishableKeys.default ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentication is required." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const secretKey = getSecretKey();
    const publishableKey = getPublishableKey();

    if (!supabaseUrl || !secretKey || !publishableKey) {
      return jsonResponse({ error: "Supabase server configuration is incomplete." }, 500);
    }

    const accessToken = authorization.replace(/^Bearer\s+/i, "");
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return jsonResponse({ error: "Your session is no longer valid. Please sign in again." }, 401);
    }

    const body = await request.json();
    const restaurantId = String(body.restaurantId ?? "").trim();
    const riderId = String(body.riderId ?? "").trim();

    if (!restaurantId || !riderId) {
      return jsonResponse({ error: "Restaurant and rider are required." }, 400);
    }

    const { data: rider, error: riderError } = await adminClient
      .from("restaurant_riders")
      .select("id,restaurant_id,auth_user_id,name")
      .eq("id", riderId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (riderError) throw riderError;
    if (!rider) {
      return jsonResponse({ error: "Rider not found for this restaurant." }, 404);
    }

    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .select("id")
      .eq("id", rider.restaurant_id)
      .eq("owner_id", userData.user.id)
      .maybeSingle();

    if (restaurantError) throw restaurantError;
    if (!restaurant) {
      return jsonResponse({ error: "You are not authorized to delete this rider." }, 403);
    }

    // Delete the application record first. rider_delivery_scopes are removed
    // automatically by the rider_id ON DELETE CASCADE constraint, and orders
    // keep their history because orders.rider_id uses ON DELETE SET NULL.
    const { error: deleteRiderError } = await adminClient
      .from("restaurant_riders")
      .delete()
      .eq("id", rider.id)
      .eq("restaurant_id", restaurantId);

    if (deleteRiderError) throw deleteRiderError;

    // The database relation uses ON DELETE SET NULL, so removing the rider row
    // does not remove the Supabase Auth account. Delete that account explicitly.
    if (rider.auth_user_id) {
      const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(rider.auth_user_id);
      if (deleteAuthError) {
        console.error("delete-rider auth cleanup error", deleteAuthError);
        return jsonResponse({
          error: `Rider record was deleted, but the Auth account could not be removed: ${deleteAuthError.message}`,
        }, 500);
      }
    }

    return jsonResponse({
      deleted: true,
      riderId: rider.id,
      name: rider.name,
    });
  } catch (error) {
    console.error("delete-rider error", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unable to delete rider.",
    }, 500);
  }
});
