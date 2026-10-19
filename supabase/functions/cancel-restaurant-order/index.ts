import { createClient } from "npm:@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-restaurant-domain","Access-Control-Allow-Methods":"POST, OPTIONS"};
const out=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
function serviceKey(){try{return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}").default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??""}catch{return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??""}}
function payKey(env:"test"|"live"){if(env==="live"){const k=Deno.env.get("PAYMONGO_LIVE_SECRET_KEY")??"";if(k)return k;const old=Deno.env.get("PAYMONGO_SECRET_KEY")??"";return old.startsWith("sk_live_")?old:""}return Deno.env.get("PAYMONGO_TEST_SECRET_KEY")??Deno.env.get("PAYMONGO_SECRET_KEY")??""}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors}); if(req.method!=="POST")return out({error:"Method not allowed"},405);
 try{
  const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"").trim(),url=Deno.env.get("SUPABASE_URL")??"",anon=Deno.env.get("SUPABASE_ANON_KEY")??"",key=serviceKey();
  if(!token||!url||!anon||!key)return out({error:"Please sign in again."},401);
  const user=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{autoRefreshToken:false,persistSession:false}});
  const {data:u,error:ue}=await user.auth.getUser(token);if(ue||!u.user)return out({error:"Your session has expired."},401);
  const body=await req.json().catch(()=>({})),id=String(body.orderId??"").trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return out({error:"A valid order is required."},400);
  const db=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:o,error:oe}=await db.from("orders").select("id,restaurant_id,status,payment_status,paymongo_payment_id,order_number").eq("id",id).maybeSingle();if(oe)throw oe;if(!o)return out({error:"Order not found."},404);
  const {data:rest,error:re}=await db.from("restaurants").select("owner_id").eq("id",o.restaurant_id).maybeSingle();if(re)throw re;
  let ok=rest?.owner_id===u.user.id;
  if(!ok){const {data:staff,error:se}=await db.from("restaurant_staff").select("role").eq("restaurant_id",o.restaurant_id).eq("auth_user_id",u.user.id).eq("is_active",true).eq("role","cashier").maybeSingle();if(se)throw se;ok=!!staff}
  if(!ok)return out({error:"Only the restaurant owner or an active cashier can cancel orders."},403);
  if(o.status!=="pending")return out({error:"This order can only be cancelled before it is confirmed or sent to the kitchen."},409);
  const paid=o.payment_status==="paid"&&!!String(o.paymongo_payment_id??"").trim();
  if(o.payment_status==="paid"&&!paid)return out({error:"Missing PayMongo payment reference. Contact support for refund assistance."},409);
  if(!["pending","paid"].includes(o.payment_status))return out({error:"This payment is not eligible for cancellation."},409);
  const initial=paid?"pending":"not_required";
  const {data:changed,error:ce}=await db.from("orders").update({status:"cancelled",cancellation_refund_status:initial,cancellation_refund_error:null,updated_at:new Date().toISOString()}).eq("id",id).eq("restaurant_id",o.restaurant_id).eq("status","pending").select("id").maybeSingle();
  if(ce)throw ce;if(!changed)return out({error:"Order status changed. Refresh and check its current status."},409);
  if(!paid)return out({cancelled:true,refundStatus:"not_required",message:"Order cancelled. No online refund was needed."});
  // Resolve the PayMongo environment for this restaurant before issuing a refund.
  // Refunds use the stored PayMongo payment ID, regardless of whether the customer used
  // GrabPay, Maya, GCash, cards, or another supported PayMongo payment method.
  const configuredEnv=String(Deno.env.get("PAYMONGO_ENVIRONMENT")??"").trim();
  const legacyKey=Deno.env.get("PAYMONGO_SECRET_KEY")??"";
  let env:"test"|"live" = configuredEnv==="live" || configuredEnv==="test"
    ? configuredEnv
    : legacyKey.startsWith("sk_live_") ? "live" : "test";
  let {data:conn,error:co}=await db.from("restaurant_paymongo_accounts").select("paymongo_account_id,connection_status,environment").eq("restaurant_id",o.restaurant_id).eq("environment",env).maybeSingle();
  if(co)throw co;
  // If environment was not explicitly configured, fall back to the restaurant's active
  // connection instead of accidentally calling the wrong PayMongo environment.
  if(!conn && configuredEnv!=="live" && configuredEnv!=="test" && !legacyKey){
    const {data:connections,error:connectionsError}=await db.from("restaurant_paymongo_accounts").select("paymongo_account_id,connection_status,environment").eq("restaurant_id",o.restaurant_id).eq("connection_status","active");
    if(connectionsError)throw connectionsError;
    const selected=connections?.find((entry:any)=>entry.environment==="test")??connections?.find((entry:any)=>entry.environment==="live");
    if(selected){conn=selected;env=selected.environment as "test"|"live";}
  }
  const secret=payKey(env);
  const failed=async(msg:string)=>{await db.from("orders").update({cancellation_refund_status:"failed",cancellation_refund_error:msg.slice(0,500),updated_at:new Date().toISOString()}).eq("id",id);return out({cancelled:true,refundStatus:"failed",message:"Order cancelled, but the automatic refund failed. Please arrange/check the refund in PayMongo."})};
  if(!secret)return await failed("PayMongo secret key is not configured for this environment.");
  const isTestSimulation=env==="test"&&conn?.onboarding_step==="test_simulation";
  const acct=String(conn?.paymongo_account_id??"").trim();
  if(conn&&((!isTestSimulation&&conn.connection_status!=="active")||(isTestSimulation&&conn.connection_status!=="pending")||!acct))return await failed("Restaurant PayMongo account is not active.");
  const headers:Record<string,string>={Authorization:"Basic "+btoa(secret+":"),"Content-Type":"application/json",...(acct?{"Account-ID":acct}:{})};
  try{
   await db.from("orders").update({cancellation_refund_status:"processing"}).eq("id",id);
   const pr=await fetch("https://api.paymongo.com/v1/payments/"+encodeURIComponent(o.paymongo_payment_id),{headers}),pd=await pr.json().catch(()=>null);
   if(!pr.ok||pd?.data?.attributes?.status!=="paid"||pd?.data?.id!==o.paymongo_payment_id)throw new Error("Unable to verify a refundable paid PayMongo payment.");
   const amount=Number(pd.data.attributes.amount);if(!Number.isSafeInteger(amount)||amount<100)throw new Error("Invalid PayMongo payment amount.");
   const rr=await fetch("https://api.paymongo.com/v1/refunds",{method:"POST",headers:{...headers,"Idempotency-Key":"cashier-cancel-refund-"+id},body:JSON.stringify({data:{attributes:{amount,payment_id:o.paymongo_payment_id,reason:"requested_by_customer",notes:"Restaurant cancelled Web2Table order "+o.order_number}}})}),rd=await rr.json().catch(()=>null);
   if(!rr.ok)throw new Error(String(rd?.errors?.[0]?.detail??rd?.errors?.[0]?.code??"PayMongo rejected the refund.").slice(0,450));
   const refundId=String(rd?.data?.id??""),state=String(rd?.data?.attributes?.status??"");if(!refundId||!["pending","processing","succeeded"].includes(state))throw new Error("PayMongo returned an unknown refund status.");
   const {error:up}=await db.from("orders").update({paymongo_refund_id:refundId,cancellation_refund_status:state,cancellation_refund_error:null,payment_status:state==="succeeded"?"refunded":"paid",updated_at:new Date().toISOString()}).eq("id",id);if(up)throw up;
   return out({cancelled:true,refundStatus:state,message:state==="succeeded"?"Order cancelled and refund submitted successfully.":"Order cancelled. PayMongo refund is processing."});
  }catch(e){return await failed(e instanceof Error?e.message:"PayMongo refund failed.")}
 }catch(e){console.error("cancel-restaurant-order error",e);return out({error:"Unable to cancel this order right now. Please try again."},500)}
});