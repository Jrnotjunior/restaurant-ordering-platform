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
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch {}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Authentication is required." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const secretKey = getSecretKey();
    const publishableKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!supabaseUrl || !secretKey || !publishableKey) return jsonResponse({ error: "Supabase server configuration is incomplete." }, 500);

    const token = authorization.replace(/^Bearer\s+/i, "");
    const userClient = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    if (userError || !userData.user) return jsonResponse({ error: "Your session is no longer valid. Please sign in again." }, 401);

    const { data: isOwner, error: ownerError } = await userClient.rpc("system_admin_is_owner");
    if (ownerError) return jsonResponse({ error: "Unable to verify System Administrator Owner access." }, 500);
    if (isOwner !== true) return jsonResponse({ error: "Only the System Administrator Owner can invite a new tenant." }, 403);

    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    const packageId = Number(body.package_id);

    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      return jsonResponse({ error: "Please enter a valid tenant owner email address." }, 400);
    }

    await adminClient.rpc("expire_stale_tenant_invitations");

    const { data: existingPending, error: pendingLookupError } = await adminClient
      .from("tenant_invitations")
      .select("id,restaurant_id,auth_user_id,expires_at,status")
      .eq("status", "pending")
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingLookupError) throw pendingLookupError;
    if (existingPending) {
      return jsonResponse({
        error: "A tenant invitation already exists for this email address. This flow creates one invitation only; it does not resend or replace it.",
      }, 409);
    }

    const { data: existingAccepted, error: acceptedLookupError } = await adminClient
      .from("tenant_invitations")
      .select("id,restaurant_id,auth_user_id,status")
      .eq("status", "accepted")
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (acceptedLookupError) throw acceptedLookupError;
    if (existingAccepted) {
      return jsonResponse({
        error: "This email address already owns an accepted tenant. Sign in to the existing Restaurant Owner account instead of creating another invitation.",
      }, 409);
    }

    if (name.length < 2) return jsonResponse({ error: "Restaurant name is required for a new tenant." }, 400);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return jsonResponse({ error: "Slug must use lowercase letters, numbers, and single hyphens." }, 400);
    }
    if (!Number.isInteger(packageId) || packageId < 1) return jsonResponse({ error: "A valid restaurant package is required for a new tenant." }, 400);

    const { data: invitation, error: invitationError } = await adminClient
      .from("tenant_invitations")
      .insert({ email, invited_by: userData.user.id })
      .select("id,email,expires_at")
      .single();

    if (invitationError) throw invitationError;

    // Do not use inviteUserByEmail(). Its built-in email contains a one-time
    // verification URL that security scanners can consume before the tenant.
    // generateLink() creates the Auth user/token without sending an email.
    // We return one safe Web2Table URL for the System Admin to deliver manually.
    const redirectTo = "https://jrnotjunior.github.io/restaurant-ordering-platform/?tenant-invite=1";

    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: {
        redirectTo,
        data: {
          invitation_type: "tenant_owner",
          tenant_invitation_id: invitation.id,
        },
      },
    });

    if (inviteError || !inviteData?.user?.id || !inviteData?.properties?.hashed_token) {
      await adminClient.from("tenant_invitations").delete().eq("id", invitation.id);
      return jsonResponse({ error: inviteError?.message ?? "Unable to generate the tenant invitation token." }, 400);
    }

    const invitedUserId = inviteData.user.id;
    const safeInvitationUrl =
      redirectTo + "&token_hash=" + encodeURIComponent(inviteData.properties.hashed_token) + "&type=invite";

    const { data: restaurantData, error: restaurantError } = await userClient.rpc(
      "system_admin_create_restaurant_from_invitation",
      {
        p_invitation_id: invitation.id,
        p_auth_user_id: invitedUserId,
        p_name: name,
        p_slug: slug,
        p_package_id: packageId,
      },
    );

    if (restaurantError) {
      await adminClient.auth.admin.deleteUser(invitedUserId, false);
      await adminClient.from("tenant_invitations").delete().eq("id", invitation.id);
      return jsonResponse({ error: restaurantError.message }, 400);
    }

    const restaurant = Array.isArray(restaurantData) ? restaurantData[0] : restaurantData;

    await userClient.rpc("system_admin_write_audit_log", {
      p_event_type: "ADMIN_ACTION",
      p_action: "TENANT_INVITATION_CREATED",
      p_restaurant_id: null,
      p_entity_type: "TENANT_INVITATION",
      p_entity_id: invitation.id,
      p_details: {
        email,
        restaurant_id: restaurant?.restaurant_id ?? null,
        restaurant_name: name,
        restaurant_slug: slug,
        package_id: packageId,
        invitation_id: invitation.id,
        auth_user_id: invitedUserId,
        delivery: "manual_safe_link",
      },
    });

    return jsonResponse({
      success: true,
      invitation_id: invitation.id,
      email,
      restaurant_id: restaurant?.restaurant_id ?? null,
      restaurant_name: name,
      package_id: packageId,
      status: "pending",
      manual_access_link: safeInvitationUrl,
      delivery: "manual_safe_link",
    });
  } catch (error) {
    console.error("system-admin-invite-tenant error", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unable to invite tenant." }, 500);
  }
});
