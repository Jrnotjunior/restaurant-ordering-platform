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
    const { data: ownerHasRole, error: ownerRoleError } = await adminClient.rpc(
      "auth_user_has_application_role",
      { p_user_id: ownerId },
    );

    if (ownerRoleError) {
      return json({
        error: `Restaurant was deleted, but owner account role cleanup could not be verified: ${ownerRoleError.message}`,
        restaurant_deleted: true,
        owner_deleted: false,
      }, 500);
    }

    if (ownerHasRole === true) {
      return json({
        success: true,
        restaurant_deleted: true,
        owner_deleted: false,
        reason: "Owner account is still used by another application role or pending invitation",
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
