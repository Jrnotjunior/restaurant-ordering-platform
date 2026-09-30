import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const riderInviteRedirectTo = "https://jrnotjunior.github.io/restaurant-ordering-platform/?invite=1";

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
    const name = String(body.name ?? "").trim();
    const mobileNumber = String(body.mobileNumber ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const scopes = [...new Set(
      (Array.isArray(body.scopes) ? body.scopes : [])
        .map((scope: unknown) => String(scope).trim())
        .filter(Boolean),
    )];

    if (!restaurantId || !name || !mobileNumber || !email) {
      return jsonResponse({ error: "Rider name, mobile number, email, and restaurant are required." }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "Please enter a valid rider email address." }, 400);
    }

    const { data: restaurant, error: restaurantError } = await adminClient
      .from("restaurants")
      .select("id")
      .eq("id", restaurantId)
      .eq("owner_id", userData.user.id)
      .maybeSingle();

    if (restaurantError) throw restaurantError;
    if (!restaurant) {
      return jsonResponse({ error: "You are not authorized to add riders to this restaurant." }, 403);
    }

    const { data: existingRider, error: existingRiderError } = await adminClient
      .from("restaurant_riders")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .ilike("email", email)
      .maybeSingle();

    if (existingRiderError) throw existingRiderError;
    if (existingRider) {
      return jsonResponse({ error: "A rider with this email already exists for this restaurant." }, 409);
    }

    // Create the restaurant record first. The Auth invitation is sent only after
    // this succeeds, so a failed invitation does not leave an orphaned rider row.
    const { data: rider, error: riderError } = await adminClient
      .from("restaurant_riders")
      .insert({
        restaurant_id: restaurantId,
        name,
        mobile_number: mobileNumber,
        email,
      })
      .select("id,name,mobile_number,email")
      .single();

    if (riderError) throw riderError;

    let authUserId: string | null = null;

    try {
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: {
          role: "rider",
          restaurant_id: restaurantId,
          rider_id: rider.id,
          name,
          mobile_number: mobileNumber,
        },
        redirectTo: riderInviteRedirectTo,
      });

      if (inviteError) throw inviteError;
      if (!inviteData.user) throw new Error("Supabase did not return the invited Auth user.");

      authUserId = inviteData.user.id;

      const { error: linkError } = await adminClient
        .from("restaurant_riders")
        .update({ auth_user_id: authUserId })
        .eq("id", rider.id)
        .eq("restaurant_id", restaurantId);

      if (linkError) throw linkError;

      if (scopes.length) {
        const { error: scopeError } = await adminClient
          .from("rider_delivery_scopes")
          .insert(scopes.map((scope_name) => ({ rider_id: rider.id, scope_name })));

        if (scopeError) throw scopeError;
      }
    } catch (error) {
      await adminClient.from("rider_delivery_scopes").delete().eq("rider_id", rider.id);
      await adminClient.from("restaurant_riders").delete().eq("id", rider.id);
      if (authUserId) {
        await adminClient.auth.admin.deleteUser(authUserId);
      }
      throw error;
    }

    return jsonResponse({
      rider: {
        ...rider,
        auth_user_id: authUserId,
      },
      invitationSent: true,
    }, 201);
  } catch (error) {
    console.error("create-rider error", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unable to create rider account.",
    }, 500);
  }
});
