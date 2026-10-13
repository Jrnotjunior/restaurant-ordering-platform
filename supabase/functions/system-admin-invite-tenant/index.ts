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


async function cleanupTenantInvitation(
  adminClient: ReturnType<typeof createClient>,
  invitationId: string,
  invitedUserId?: string,
) {
  if (invitedUserId) {
    const { error } = await adminClient.auth.admin.deleteUser(invitedUserId, false);
    if (error) {
      console.error("Unable to remove tenant invitation Auth user:", error);
      return false;
    }
  }

  const { error: invitationDeleteError } = await adminClient
    .from("tenant_invitations")
    .delete()
    .eq("id", invitationId);

  if (invitationDeleteError) {
    console.error("Unable to remove tenant invitation record:", invitationDeleteError);
    return false;
  }
  return true;
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

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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

    // Reuse an existing Auth account when it has no restaurant yet. Auth invitations
    // cannot be sent to an email that is already registered, so those accounts need
    // a tenant invitation record plus a secure password-recovery access email.
    let existingAuthUser: any = null;
    for (let page = 1; page <= 20 && !existingAuthUser; page += 1) {
      const { data: usersPage, error: usersError } = await adminClient.auth.admin.listUsers({ page, perPage: 500 });
      if (usersError) throw usersError;
      existingAuthUser = usersPage.users.find((user) => (user.email ?? "").toLowerCase() === email) ?? null;
      if (usersPage.users.length < 500) break;
    }

    if (existingAuthUser) {
      const { data: ownedRestaurant, error: ownedRestaurantError } = await adminClient
        .from("restaurants")
        .select("id")
        .eq("owner_id", existingAuthUser.id)
        .limit(1)
        .maybeSingle();
      if (ownedRestaurantError) throw ownedRestaurantError;
      if (ownedRestaurant) {
        return jsonResponse({
          error: "This account already owns a restaurant. Use the existing restaurant's Owner settings instead of creating another tenant.",
        }, 409);
      }

      const metadata = existingAuthUser.user_metadata ?? {};
      if (metadata.invitation_type === "employee_staff") {
        return jsonResponse({
          error: "This email belongs to an existing staff account. Use a separate owner email or resolve the staff account first.",
        }, 409);
      }
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

    let invitedUserId: string;
    let reusedExistingAccount = false;

    if (existingAuthUser) {
      invitedUserId = existingAuthUser.id;
      reusedExistingAccount = true;
      const { error: metadataError } = await adminClient.auth.admin.updateUserById(invitedUserId, {
        user_metadata: {
          ...(existingAuthUser.user_metadata ?? {}),
          invitation_type: "tenant_owner",
          tenant_invitation_id: invitation.id,
          restaurant_name: "Web2Table",
          invitation_role: "a restaurant owner",
          account_setup: "your restaurant account",
          invitation_label: "RESTAURANT OWNER INVITATION",
        },
      });
      if (metadataError) {
        await cleanupTenantInvitation(adminClient, invitation.id);
        return jsonResponse({ error: "The existing account could not be prepared for tenant onboarding. Please try again or contact support." }, 400);
      }
    } else {
      const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
        email,
        {
          data: {
            invitation_type: "tenant_owner",
            tenant_invitation_id: invitation.id,
            restaurant_name: "Web2Table",
            invitation_role: "a restaurant owner",
            account_setup: "your restaurant account",
            invitation_label: "RESTAURANT OWNER INVITATION",
          },
        },
      );

      if (inviteError || !inviteData?.user?.id) {
        const cleanedUp = await cleanupTenantInvitation(adminClient, invitation.id);
        if (!cleanedUp) {
          return jsonResponse({ error: "The invitation could not be sent and cleanup was incomplete. Please contact support before retrying." }, 500);
        }
        return jsonResponse({ error: inviteError?.message ?? "Unable to send the tenant invitation email." }, 400);
      }
      invitedUserId = inviteData.user.id;
    }

    // Bind the invitation to the exact Auth account so it cannot be claimed by
    // another account. Existing accounts are deliberately not deleted on failure.
    const { error: bindInvitationError } = await adminClient
      .from("tenant_invitations")
      .update({ auth_user_id: invitedUserId, updated_at: new Date().toISOString() })
      .eq("id", invitation.id)
      .eq("status", "pending");

    if (bindInvitationError) {
      const cleanedUp = await cleanupTenantInvitation(adminClient, invitation.id, reusedExistingAccount ? undefined : invitedUserId);
      if (!cleanedUp) {
        return jsonResponse({ error: "The tenant invitation could not be finalized and cleanup was incomplete. Please contact support before retrying." }, 500);
      }
      return jsonResponse({ error: bindInvitationError.message }, 400);
    }

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
      const cleanedUp = await cleanupTenantInvitation(adminClient, invitation.id, invitedUserId);
      if (!cleanedUp) {
        return jsonResponse({ error: "Tenant setup failed and cleanup was incomplete. Please contact support before retrying." }, 500);
      }
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
        delivery: "supabase_invite_email",
      },
    });

    let emailSent = !reusedExistingAccount;
    if (reusedExistingAccount) {
      const configuredRedirectBase = Deno.env.get("APP_URL") ?? Deno.env.get("SITE_URL") ?? "";
      const redirectBase = configuredRedirectBase.endsWith("/") ? configuredRedirectBase.slice(0, -1) : configuredRedirectBase;
      if (!redirectBase) {
        return jsonResponse({
          success: true,
          invitation_id: invitation.id,
          email,
          restaurant_id: restaurant?.restaurant_id ?? null,
          restaurant_name: name,
          package_id: packageId,
          status: "pending",
          email_sent: false,
          warning: "The restaurant was created for the existing account, but APP_URL or SITE_URL is not configured to send a secure access email. Ask the owner to sign in with their existing account.",
          reused_existing_account: true,
        });
      }

      const mailClient = createClient(supabaseUrl, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: resetEmailError } = await mailClient.auth.resetPasswordForEmail(email, {
        redirectTo: `${redirectBase}/?invitation=1&flow=tenant-owner`,
      });
      emailSent = !resetEmailError;
      if (resetEmailError) {
        console.error("Unable to send existing tenant account access email:", resetEmailError);
      }
    }

    return jsonResponse({
      success: true,
      invitation_id: invitation.id,
      email,
      restaurant_id: restaurant?.restaurant_id ?? null,
      restaurant_name: name,
      package_id: packageId,
      status: "pending",
      email_sent: emailSent,
      reused_existing_account: reusedExistingAccount,
      delivery: reusedExistingAccount ? "supabase_password_recovery_email" : "supabase_invite_email",
      ...(emailSent ? {} : { warning: "The restaurant was created, but the secure access email could not be sent. The owner can sign in with their existing account; check the Auth email configuration before retrying." }),
    });
  } catch (error) {
    console.error("system-admin-invite-tenant error", error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Unable to invite tenant." }, 500);
  }
});
