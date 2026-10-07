import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return json({ error: "Authentication is required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey =
    Deno.env.get("SUPABASE_ANON_KEY") ??
    (() => {
      try {
        const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
        return keys.default ?? "";
      } catch {
        return "";
      }
    })();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return json({ error: "Server-side Supabase configuration is incomplete" }, 500);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
  });

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json() as { restaurant_id?: unknown };
    const restaurantId = typeof body.restaurant_id === "string"
      ? body.restaurant_id.trim()
      : "";

    if (!restaurantId) {
      return json({ error: "Restaurant ID is required" }, 400);
    }

    // The database function performs the authoritative System Admin
    // authorization check using the caller's JWT context.
    const { data: ownerId, error: deleteError } = await userClient.rpc(
      "system_admin_delete_restaurant",
      { p_restaurant_id: restaurantId },
    );

    if (deleteError) {
      return json({ error: deleteError.message }, 400);
    }

    if (!ownerId) {
      return json({
        success: true,
        restaurant_deleted: true,
        owner_deleted: false,
      });
    }

    // Only delete the Auth account if the owner is now completely unused.
    // This check is server-side and cannot be forged by the browser.
    const { data: ownerRestaurants, error: ownerRestaurantsError } =
      await adminClient
        .from("restaurants")
        .select("id")
        .eq("owner_id", ownerId)
        .limit(1);

    if (ownerRestaurantsError) {
      return json({
        error: `Restaurant was deleted, but owner account cleanup could not be verified: ${ownerRestaurantsError.message}`,
        restaurant_deleted: true,
        owner_deleted: false,
      }, 500);
    }

    const { data: ownerInvitations, error: ownerInvitationsError } =
      await adminClient
        .from("tenant_invitations")
        .select("id")
        .eq("auth_user_id", ownerId)
        .limit(1);

    if (ownerInvitationsError) {
      return json({
        error: `Restaurant was deleted, but owner invitation cleanup could not be verified: ${ownerInvitationsError.message}`,
        restaurant_deleted: true,
        owner_deleted: false,
      }, 500);
    }

    if ((ownerRestaurants?.length ?? 0) > 0 || (ownerInvitations?.length ?? 0) > 0) {
      return json({
        success: true,
        restaurant_deleted: true,
        owner_deleted: false,
        reason: "Owner account is still used by another restaurant or invitation",
      });
    }

    const { error: authDeleteError } =
      await adminClient.auth.admin.deleteUser(ownerId);

    if (authDeleteError) {
      return json({
        error: `Restaurant was deleted, but the tenant owner Auth account could not be deleted: ${authDeleteError.message}`,
        restaurant_deleted: true,
        owner_deleted: false,
      }, 500);
    }

    return json({
      success: true,
      restaurant_deleted: true,
      owner_deleted: true,
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Unexpected deletion error",
    }, 500);
  }
});
