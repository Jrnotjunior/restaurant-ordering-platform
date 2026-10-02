import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const redirectTo="https://jrnotjunior.github.io/restaurant-ordering-platform/employee-invite";
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}})}
function secret(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");return keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??""}
function publishable(){const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");return keys.default??Deno.env.get("SUPABASE_ANON_KEY")??""}
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});if(req.method!=="POST")return json({error:"Method not allowed"},405);try{
const authorization=req.headers.get("Authorization");if(!authorization?.startsWith("Bearer "))return json({error:"Authentication is required."},401);
const url=Deno.env.get("SUPABASE_URL")??"", sk=secret(), pk=publishable();if(!url||!sk||!pk)return json({error:"Supabase server configuration is incomplete."},500);
const token=authorization.replace(/^Bearer\s+/i,""), userClient=createClient(url,pk,{global:{headers:{Authorization:authorization}},auth:{autoRefreshToken:false,persistSession:false}}), admin=createClient(url,sk,{auth:{autoRefreshToken:false,persistSession:false}});
const {data:userData,error:userError}=await userClient.auth.getUser(token);if(userError||!userData.user)return json({error:"Your session is no longer valid. Please sign in again."},401);
const body=await req.json(), restaurantId=String(body.restaurantId??"").trim(), name=String(body.name??"").trim(), preferredName=String(body.preferredName??name).trim(), mobileNumber=String(body.mobileNumber??"").trim(), email=String(body.email??"").trim().toLowerCase(), role=String(body.role??"").trim();
if(!restaurantId||!name||!preferredName||!mobileNumber||!email||!["cashier","kitchen","dispatcher","rider"].includes(role))return json({error:"Employee name, mobile number, email, role, and restaurant are required."},400);
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Please enter a valid employee email address."},400);
const {data:restaurant,error:restaurantError}=await admin.from("restaurants").select("id").eq("id",restaurantId).eq("owner_id",userData.user.id).eq("is_active",true).maybeSingle();if(restaurantError)throw restaurantError;if(!restaurant)return json({error:"You are not authorized to add employees to this restaurant."},403);
const {data:existing,error:existingError}=await admin.from("restaurant_staff").select("id,role,is_active").eq("restaurant_id",restaurantId).ilike("email",email).maybeSingle();if(existingError)throw existingError;if(existing)return json({error:"An employee with this email already exists for this restaurant."},409);
if(role==="kitchen"||role==="dispatcher"){const {data:shared,error:sharedError}=await admin.from("restaurant_staff").select("id").eq("restaurant_id",restaurantId).eq("role",role).eq("is_active",true).maybeSingle();if(sharedError)throw sharedError;if(shared)return json({error:`This restaurant already has an active ${role} account.`},409);}
if(role==="rider"){const {data:existingRider,error:existingRiderError}=await admin.from("restaurant_riders").select("id").eq("restaurant_id",restaurantId).ilike("email",email).maybeSingle();if(existingRiderError)throw existingRiderError;if(existingRider)return json({error:"A rider with this email already exists for this restaurant."},409);}
const {data:staff,error:staffError}=await admin.from("restaurant_staff").insert({restaurant_id:restaurantId,name,preferred_name:preferredName,mobile_number:mobileNumber,email,role}).select("id,name,mobile_number,email,role,is_active").single();if(staffError)throw staffError;
let riderId:string|null=null;let authUserId:string|null=null;
try{
if(role==="rider"){const {data:rider,error:riderError}=await admin.from("restaurant_riders").insert({restaurant_id:restaurantId,auth_user_id:null,name,mobile_number:mobileNumber,email,is_active:true}).select("id").single();if(riderError)throw riderError;riderId=rider.id;}
const {data:inviteData,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{data:{role,restaurant_id:restaurantId,staff_id:staff.id,...(riderId?{rider_id:riderId}:{}),name,mobile_number:mobileNumber},redirectTo});if(inviteError)throw inviteError;if(!inviteData.user)throw new Error("Supabase did not return the invited Auth user.");authUserId=inviteData.user.id;
const {error:linkStaffError}=await admin.from("restaurant_staff").update({auth_user_id:authUserId}).eq("id",staff.id);if(linkStaffError)throw linkStaffError;
if(riderId){const {error:linkRiderError}=await admin.from("restaurant_riders").update({auth_user_id:authUserId}).eq("id",riderId);if(linkRiderError)throw linkRiderError;}
}catch(error){await admin.from("restaurant_staff").delete().eq("id",staff.id);if(riderId)await admin.from("restaurant_riders").delete().eq("id",riderId);if(authUserId)await admin.auth.admin.deleteUser(authUserId);throw error;}
return json({staff:{...staff,auth_user_id:authUserId},rider_id:riderId,invitationSent:true},201);
}catch(error){console.error("create-staff error",error);return json({error:error instanceof Error?error.message:"Unable to create employee account."},500)}});
