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

    const { data: isOwner, error: ownerError } = await userClient.rpc("system_admin_is_owner");
    if (ownerError) {
      console.error("system-admin-delete-staff owner check error", ownerError);
      return jsonResponse({ error: "Unable to verify System Administrator Owner access." }, 500);
    }

    if (isOwner !== true) {
      return jsonResponse({
        error: "Only the System Administrator Owner can permanently delete staff.",
      }, 403);
    }

    const body = await request.json();
    const staffId = String(body.staffId ?? "").trim();

    if (!staffId) {
      return jsonResponse({ error: "Staff ID is required." }, 400);
    }

    const { data: staff, error: staffError } = await adminClient
      .from("restaurant_staff")
      .select("id, restaurant_id, auth_user_id, name, email, role, is_active")
      .eq("id", staffId)
      .maybeSingle();

    if (staffError) throw staffError;
    if (!staff) {
      return jsonResponse({ error: "Staff member not found." }, 404);
    }

    if (staff.role === "rider") {
      const { count, error: assignmentError } = await adminClient
        .from("delivery_assignments")
        .select("id", { count: "exact", head: true })
        .eq("rider_id", staff.id)
        .in("status", ["assigned", "delivering", "arrived"]);

      if (assignmentError) throw assignmentError;

      if ((count ?? 0) > 0) {
        return jsonResponse({
          error: `This rider cannot be deleted because they have ${count} active delivery assignment(s). Complete or reassign the delivery first.`,
        }, 409);
      }
    }

    const { error: deleteStaffError } = await userClient.rpc(
      "system_admin_delete_restaurant_staff",
      { p_staff_id: staff.id },
    );

    if (deleteStaffError) {
      return jsonResponse({ error: deleteStaffError.message }, 400);
    }

    if (staff.auth_user_id) {
      const { data: hasOtherRole, error: roleCheckError } = await adminClient.rpc(
        "auth_user_has_application_role",
        { p_user_id: staff.auth_user_id },
      );

      if (roleCheckError) {
        console.error("system-admin-delete-staff role check error", roleCheckError);
        return jsonResponse({
          error: `Staff record was permanently deleted, but the Auth account role could not be verified: ${roleCheckError.message}`,
          staffDeleted: true,
          authDeleted: false,
        }, 500);
      }

      if (hasOtherRole !== true) {
        const { error: deleteAuthError } = await adminClient.auth.admin.deleteUser(
          staff.auth_user_id,
          false,
        );

        if (deleteAuthError) {
          console.error("system-admin-delete-staff auth cleanup error", deleteAuthError);
          return jsonResponse({
            error: `Staff record was permanently deleted, but the Auth account could not be removed: ${deleteAuthError.message}`,
            staffDeleted: true,
            authDeleted: false,
          }, 500);
        }
      }
    }

    return jsonResponse({
      deleted: true,
      staffId: staff.id,
      authUserId: staff.auth_user_id,
      name: staff.name,
      email: staff.email,
      role: staff.role,
    });
  } catch (error) {
    console.error("system-admin-delete-staff error", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unable to permanently delete staff.",
    }, 500);
  }
});
