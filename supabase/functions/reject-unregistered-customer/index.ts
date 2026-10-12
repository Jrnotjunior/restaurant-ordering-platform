import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSecretKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch { /* fall back to legacy secret */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function getPublishableKey() {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    if (keys.default) return keys.default;
  } catch { /* fall back to legacy key */ }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const secret = getSecretKey();
  const publishable = getPublishableKey();
  if (!url || !secret || !publishable) return respond({ error: "Server configuration incomplete" }, 500);

  const token = authorization.replace(/^Bearer\s+/i, "");
  const userClient = createClient(url, publishable, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return respond({ error: "Session is invalid or expired" }, 401);

  // Preserve any identity with an existing customer profile, owner/staff role,
  // system-admin access, or pending tenant invitation.
  const { data: hasRole, error: roleError } = await admin.rpc("auth_user_has_application_role", {
    p_user_id: user.id,
  });
  if (roleError) {
    console.error("reject-unregistered-customer role verification failed", roleError);
    return respond({ error: "Could not safely verify account ownership; no account was deleted" }, 500);
  }
  if (hasRole === true) {
    return respond({ deleted: false, reason: "Identity has an application account or invitation; preserved." }, 409);
  }

  // Re-check immediately before deleting to reduce registration race conditions.
  const { data: recheck, error: recheckError } = await admin.rpc("auth_user_has_application_role", {
    p_user_id: user.id,
  });
  if (recheckError || recheck === true) {
    return respond({ error: "Account status changed or could not be verified; account preserved" }, 409);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("reject-unregistered-customer deletion failed", { userId: user.id, message: deleteError.message });
    return respond({ error: "Registration was denied, but automatic account cleanup failed" }, 500);
  }

  return respond({ deleted: true, message: "Unregistered Auth identity deleted" });
});