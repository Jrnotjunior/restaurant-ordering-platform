import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-restaurant-domain, x-restaurant-slug","Access-Control-Allow-Methods":"POST, OPTIONS"};
const redirectTo="https://jrnotjunior.github.io/restaurant-ordering-platform/?employee-invite=1";
function json(body:Record<string,unknown>,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}})}
function secret(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");return keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??""}
function publishable(){const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");return keys.default??Deno.env.get("SUPABASE_ANON_KEY")??""}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST") return json({error:"Method not allowed"},405);
 try{
  const authorization=req.headers.get("Authorization");
  if(!authorization?.startsWith("Bearer ")) return json({error:"Authentication is required."},401);
  const url=Deno.env.get("SUPABASE_URL")??"", sk=secret(), pk=publishable();
  if(!url||!sk||!pk) return json({error:"Supabase server configuration is incomplete."},500);
  const token=authorization.replace(/^Bearer\s+/i,"");
  const userClient=createClient(url,pk,{global:{headers:{Authorization:authorization}},auth:{autoRefreshToken:false,persistSession:false}});
  const admin=createClient(url,sk,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:userData,error:userError}=await userClient.auth.getUser(token);
  if(userError||!userData.user) return json({error:"Your session is no longer valid. Please sign in again."},401);
  const body=await req.json();
  const restaurantId=String(body.restaurantId??"").trim();
  const staffId=String(body.staffId??"").trim();
  if(!restaurantId||!staffId) return json({error:"Restaurant and employee are required."},400);

  const {data:restaurant,error:restaurantError}=await admin.from("restaurants").select("id").eq("id",restaurantId).eq("owner_id",userData.user.id).eq("is_active",true).maybeSingle();
  if(restaurantError) throw restaurantError;
  if(!restaurant) return json({error:"You are not authorized to resend invitations for this restaurant."},403);

  const {data:staff,error:staffError}=await admin.from("restaurant_staff").select("id,auth_user_id,email,name,preferred_name,role,is_active").eq("id",staffId).eq("restaurant_id",restaurantId).maybeSingle();
  if(staffError) throw staffError;
  if(!staff) return json({error:"Employee record not found."},404);
  if(!staff.auth_user_id) return json({error:"This employee is missing its Auth account link."},409);
  if(!staff.is_active) return json({error:"Activate the employee before sending an invitation."},409);

  const {data:authUser,error:authError}=await admin.auth.admin.getUserById(staff.auth_user_id);
  if(authError||!authUser.user) return json({error:"The employee's Auth account could not be found."},404);

  if(authUser.user.email_confirmed_at || authUser.user.confirmed_at) {
    return json({error:"This employee has already completed the invitation and confirmed the account. No new invitation is needed."},409);
  }

  const {data:inviteData,error:inviteError}=await admin.auth.admin.inviteUserByEmail(staff.email,{
    data:{
      role:staff.role,
      restaurant_id:restaurantId,
      name:staff.name,
      preferred_name:staff.preferred_name,
      mobile_number:staff.mobile_number,
    },
    redirectTo,
  });
  if(inviteError) {
    console.error("Employee invitation resend failed:",inviteError);
    return json({error:inviteError.message},400);
  }
  return json({success:true,invitationSent:true,staffId:staff.id,authUserId:staff.auth_user_id});
 }catch(error){
  console.error("resend-staff-invitation error",error);
  return json({error:error instanceof Error?error.message:"Unable to resend employee invitation."},500);
 }
});