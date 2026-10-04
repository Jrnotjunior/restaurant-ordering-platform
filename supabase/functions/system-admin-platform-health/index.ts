import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ServiceStatus = "healthy" | "degraded" | "critical" | "unknown";
type HealthService = { key:string; name:string; status:ServiceStatus; latencyMs:number|null; message:string; details?:Record<string,unknown> };
type Incident = { severity:"info"|"warning"|"critical"; service:string; title:string; summary:string; likelyCause?:string; impact?:string; recommendation?:string };

function jsonResponse(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});}
function getSecretKey(){const keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");return keys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";}
function getPublishableKey(){const keys=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")??"{}");return keys.default??Deno.env.get("SUPABASE_ANON_KEY")??"";}

async function timedFetch(url:string,init?:RequestInit){
  const started=Date.now();
  try{return {response:await fetch(url,init),latencyMs:Date.now()-started};}
  catch(error){return {response:null,latencyMs:Date.now()-started,error:error instanceof Error?error.message:"Request failed"};}
}

async function supabaseHealth(ref:string,token:string):Promise<HealthService>{
  if(!ref||!token)return {key:"supabase",name:"Supabase",status:"unknown",latencyMs:null,message:"Supabase Management API credentials are not configured."};
  const r=await timedFetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/health`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.response)return {key:"supabase",name:"Supabase",status:"critical",latencyMs:r.latencyMs,message:r.error??"Unable to reach Supabase Management API."};
  let payload:any=null;try{payload=await r.response.json();}catch{}
  if(!r.response.ok)return {key:"supabase",name:"Supabase",status:r.response.status===429?"degraded":"critical",latencyMs:r.latencyMs,message:`Supabase Management API returned HTTP ${r.response.status}.`,details:{httpStatus:r.response.status}};
  const services=Array.isArray(payload)?payload:(payload?.services??[]);
  const unhealthy=services.filter((x:any)=>{const status=String(x?.status??"").toUpperCase();return status&&status!=="ACTIVE_HEALTHY";});
  return {key:"supabase",name:"Supabase",status:unhealthy.length?"degraded":"healthy",latencyMs:r.latencyMs,message:unhealthy.length?`${unhealthy.length} Supabase service(s) are not reporting ACTIVE_HEALTHY.`:"Supabase services are reporting healthy status.",details:{serviceCount:services.length,unhealthyCount:unhealthy.length,services:services.slice(0,20)}};
}

async function webAppHealth(url:string):Promise<HealthService>{
  if(!url)return {key:"web_app",name:"Web App — Hostinger",status:"unknown",latencyMs:null,message:"Hostinger web app URL is not configured."};
  const r=await timedFetch(url,{method:"GET",redirect:"follow",headers:{"User-Agent":"Web2Table-Platform-Health/1.0"}});
  if(!r.response)return {key:"web_app",name:"Web App — Hostinger",status:"critical",latencyMs:r.latencyMs,message:r.error??"Hostinger web app could not be reached."};
  return {key:"web_app",name:"Web App — Hostinger",status:r.response.ok?"healthy":r.response.status>=500?"critical":"degraded",latencyMs:r.latencyMs,message:r.response.ok?"Production web app is responding normally.":`Web app returned HTTP ${r.response.status}.`,details:{httpStatus:r.response.status,url}};
}

async function paymongoHealth(secret:string):Promise<HealthService>{
  if(!secret)return {key:"paymongo",name:"PayMongo",status:"unknown",latencyMs:null,message:"PayMongo secret key is not configured for platform monitoring."};
  const encoded=btoa(secret+":");
  const r=await timedFetch("https://api.paymongo.com/v1/payment_methods?limit=1",{headers:{Authorization:`Basic ${encoded}`,Accept:"application/json","User-Agent":"Web2Table-Platform-Health/1.0"}});
  if(!r.response)return {key:"paymongo",name:"PayMongo",status:"critical",latencyMs:r.latencyMs,message:r.error??"Unable to reach PayMongo."};
  return {key:"paymongo",name:"PayMongo",status:r.response.ok?"healthy":r.response.status===429?"degraded":"critical",latencyMs:r.latencyMs,message:r.response.ok?"PayMongo API is reachable.":`PayMongo API returned HTTP ${r.response.status}.`,details:{httpStatus:r.response.status}};
}

async function recentErrors(ref:string,token:string){
  if(!ref||!token)return {errorCount:0,errors:[] as unknown[]};
  const end=new Date(),start=new Date(end.getTime()-30*60*1000);
  const params=new URLSearchParams({sql:`select timestamp,source,log_attributes['response.status_code'] as status_code,log_attributes['request.path'] as path,event_message from logs where toInt32OrZero(log_attributes['response.status_code']) >= 400 order by timestamp desc limit 40`,iso_timestamp_start:start.toISOString(),iso_timestamp_end:end.toISOString()});
  const r=await timedFetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/analytics/endpoints/logs?${params.toString()}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!r.response?.ok)return {errorCount:0,errors:[] as unknown[]};
  try{const p=await r.response.json();const rows=Array.isArray(p)?p:(p?.result??p?.data??[]);return {errorCount:rows.length,errors:rows.slice(0,40)};}catch{return {errorCount:0,errors:[] as unknown[]};}
}

function fallbackSummary(services:HealthService[],incidents:Incident[]){if(incidents.some(x=>x.severity==="critical"))return"Critical platform issues were detected. Review the affected dependency and recent error signals before making production changes.";if(incidents.some(x=>x.severity==="warning"))return"The platform is operational but one or more dependencies need attention. Review the warnings and recent error signals.";if(services.every(x=>x.status==="healthy"))return"All monitored production dependencies are responding normally. No active incidents were detected.";return"Some dependency health information is unavailable. Configure the required monitoring credentials before treating the platform as fully healthy.";}

async function aiAnalysis(services:HealthService[],incidents:Incident[],errors:unknown[]){
  const apiKey=Deno.env.get("OPENAI_API_KEY")??"";
  if(!apiKey)return {summary:fallbackSummary(services,incidents),confidence:null,incidents};
  const model=Deno.env.get("OPENAI_HEALTH_MODEL")??"gpt-4.1-mini";
  const prompt=`You are the read-only operations analyst for Web2Table. Analyze this sanitized health snapshot. Do not invent facts or recommend destructive/automatic changes. Return ONLY JSON: {"summary":"string","confidence":0.0,"incidents":[{"severity":"info|warning|critical","service":"string","title":"string","summary":"string","likelyCause":"string","impact":"string","recommendation":"string"}]}. Keep summary under 100 words. Health snapshot: ${JSON.stringify({services:services.map(({key,name,status,latencyMs,message})=>({key,name,status,latencyMs,message})),incidents,recentErrors:errors.slice(0,30)})}`;
  try{
    const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,input:prompt,temperature:0.1})});
    if(!r.ok)throw new Error(`OpenAI returned HTTP ${r.status}`);
    const data=await r.json(),text=String(data.output_text??""),start=text.indexOf("{"),end=text.lastIndexOf("}");
    if(start<0||end<=start)throw new Error("AI response was not JSON.");
    const parsed=JSON.parse(text.slice(start,end+1));
    return {summary:typeof parsed.summary==="string"&&parsed.summary.trim()?parsed.summary.trim():fallbackSummary(services,incidents),confidence:Number.isFinite(Number(parsed.confidence))?Math.max(0,Math.min(1,Number(parsed.confidence))):null,incidents:Array.isArray(parsed.incidents)?parsed.incidents.slice(0,10):incidents};
  }catch(error){console.error("Platform health AI analysis failed",error);return {summary:fallbackSummary(services,incidents),confidence:null,incidents};}
}

Deno.serve(async(request)=>{
  if(request.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(request.method!=="POST")return jsonResponse({error:"Method not allowed"},405);
  try{
    const authorization=request.headers.get("Authorization");
    if(!authorization?.startsWith("Bearer "))return jsonResponse({error:"Authentication is required."},401);
    const supabaseUrl=Deno.env.get("SUPABASE_URL")??"",publishableKey=getPublishableKey(),secretKey=getSecretKey();
    if(!supabaseUrl||!publishableKey||!secretKey)return jsonResponse({error:"Supabase server configuration is incomplete."},500);
    const accessToken=authorization.replace(/^Bearer\\s+/i,"");
    // The Edge Function gateway has already validated the JWT. Use the server-side
    // Supabase key for the Auth lookup so verification is independent of the browser key.
    const authClient=createClient(supabaseUrl,secretKey,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:userData,error:userError}=await authClient.auth.getUser(accessToken);
    if(userError||!userData.user)return jsonResponse({error:"Your session could not be verified. Please sign in again."},401);
    const userClient=createClient(supabaseUrl,publishableKey,{global:{headers:{Authorization:authorization}},auth:{autoRefreshToken:false,persistSession:false}});
    const {data:access,error:accessError}=await userClient.rpc("system_admin_get_my_access_level");
    if(accessError)return jsonResponse({error:"Unable to verify System Administrator access."},500);
    const row=Array.isArray(access)?access[0]:access;
    if(!row||row.is_active!==true||row.status!=="active")return jsonResponse({error:"Active System Administrator access is required."},403);

    const ref=Deno.env.get("SUPABASE_PROJECT_REF")??"",managementToken=Deno.env.get("SUPABASE_MANAGEMENT_API_TOKEN")??"",hostingerUrl=Deno.env.get("HOSTINGER_WEBAPP_URL")??"",paymongoSecret=Deno.env.get("PAYMONGO_SECRET_KEY")??"";
    const [supabase,webApp,paymongo]=await Promise.all([supabaseHealth(ref,managementToken),webAppHealth(hostingerUrl),paymongoHealth(paymongoSecret)]);
    const logs=await recentErrors(ref,managementToken);
    const services=[webApp,supabase,paymongo],incidents:Incident[]=[];
    for(const service of services){
      if(service.status==="critical")incidents.push({severity:"critical",service:service.name,title:`${service.name} is unavailable`,summary:service.message,impact:"Users may be unable to use affected platform functionality.",recommendation:"Review the dependency status and recent error signals before taking action."});
      else if(service.status==="degraded")incidents.push({severity:"warning",service:service.name,title:`${service.name} is degraded`,summary:service.message,impact:"Some requests may be slower or fail intermittently.",recommendation:"Review recent logs and dependency status."});
      else if(service.status==="unknown")incidents.push({severity:"warning",service:service.name,title:`${service.name} monitoring is not configured`,summary:service.message,impact:"The System Admin cannot reliably determine this dependency's health.",recommendation:"Configure the required server-side monitoring secret."});
    }
    if(logs.errorCount>=5)incidents.push({severity:"warning",service:"Supabase Logs",title:"Elevated recent error activity",summary:`${logs.errorCount} relevant log entries were found in the recent log window.`,impact:"Affected requests may be failing even if infrastructure services remain available.",recommendation:"Inspect recent errors and correlate them with affected application flows."});
    const ai=await aiAnalysis(services,incidents,logs.errors);
    const critical=services.some(x=>x.status==="critical")||ai.incidents.some((x:Incident)=>x.severity==="critical");
    const degraded=!critical&&(services.some(x=>x.status==="degraded"||x.status==="unknown")||ai.incidents.some((x:Incident)=>x.severity==="warning"));
    const configurationWarnings=[
      !ref||!managementToken?"Supabase Management API monitoring is not configured.":"",
      !hostingerUrl?"Hostinger production URL is not configured.":"",
      !paymongoSecret?"PayMongo monitoring is not configured.":"",
      !Deno.env.get("OPENAI_API_KEY")?"OpenAI AI diagnosis is not configured; deterministic analysis is being used.":"",
    ].filter(Boolean);
    return jsonResponse({overallStatus:critical?"critical":degraded?"degraded":"healthy",generatedAt:new Date().toISOString(),services,incidents:ai.incidents,aiSummary:ai.summary,aiConfidence:ai.confidence,configurationWarnings});
  }catch(error){console.error("system-admin-platform-health error",error);return jsonResponse({error:error instanceof Error?error.message:"Unable to run platform health check."},500);}
});
