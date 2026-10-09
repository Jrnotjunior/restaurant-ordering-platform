import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-restaurant-domain, x-restaurant-slug",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RouteRequest = { restaurantId: string; latitude: number; longitude: number };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return json({ error: "Delivery location request is too large." }, 413);
  }

  const directionsApiToken = Deno.env.get("MAPBOX_DIRECTIONS_API_TOKEN");
  if (!directionsApiToken) return json({ error: "Delivery distance service is not configured yet." }, 503);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Delivery distance service is unavailable." }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  let payload: RouteRequest;
  try { payload = await req.json(); } catch { return json({ error: "Invalid delivery location request." }, 400); }

  const restaurantId = String(payload.restaurantId ?? "").trim();
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  if (!restaurantId || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return json({ error: "Invalid delivery location." }, 400);
  }

  const { data: restaurant, error: restaurantError } = await admin.from("restaurants")
    .select("id,is_active,delivery_location_latitude,delivery_location_longitude,delivery_base_fee,delivery_distance_increment_meters,delivery_fee_per_increment,delivery_max_distance_meters")
    .eq("id", restaurantId).single();

  if (restaurantError || !restaurant) return json({ error: "Restaurant delivery settings could not be loaded." }, 404);
  if (!restaurant.is_active) return json({ error: "Restaurant is not available." }, 409);

  const originLat = Number(restaurant.delivery_location_latitude);
  const originLng = Number(restaurant.delivery_location_longitude);
  if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) return json({ error: "This restaurant has not configured its delivery location yet." }, 409);

  const incrementMeters = Number(restaurant.delivery_distance_increment_meters);
  const feePerIncrement = Number(restaurant.delivery_fee_per_increment);
  const baseFee = Number(restaurant.delivery_base_fee);
  const maxDistanceMeters = Number(restaurant.delivery_max_distance_meters);

  const { data: cachedQuote } = await admin.from("delivery_quotes")
    .select("id,expires_at,distance_meters,delivery_fee")
    .eq("restaurant_id", restaurantId)
    .eq("customer_latitude", latitude)
    .eq("customer_longitude", longitude)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (cachedQuote) {
    const cachedDistance = Number(cachedQuote.distance_meters);
    return json({
      quoteId: cachedQuote.id,
      expiresAt: cachedQuote.expires_at,
      distanceMeters: cachedDistance,
      deliveryFee: Number(cachedQuote.delivery_fee),
      maxDistanceMeters,
      inRange: cachedDistance <= maxDistanceMeters,
      cached: true,
    });
  }

  if (!Number.isFinite(incrementMeters) || incrementMeters <= 0 || !Number.isFinite(feePerIncrement) || feePerIncrement < 0 || !Number.isFinite(baseFee) || baseFee < 0 || !Number.isFinite(maxDistanceMeters) || maxDistanceMeters <= 0) {
    return json({ error: "This restaurant has invalid delivery pricing settings." }, 409);
  }

  // Rate-limit only uncached route calculations; cached quotes remain reusable.
  // Hash the client address before sending it to the database so raw IPs are not stored.
  const clientAddress = (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0] ??
    "unknown"
  ).trim().slice(0, 128);
  const rateLimitMaterial = new TextEncoder().encode(`${restaurantId}:${clientAddress}`);
  const rateLimitDigest = await crypto.subtle.digest("SHA-256", rateLimitMaterial);
  const rateLimitKey = Array.from(new Uint8Array(rateLimitDigest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  const { data: allowed, error: rateLimitError } = await admin.rpc("consume_delivery_route_rate_limit", {
    p_rate_limit_key: rateLimitKey,
  });
  if (rateLimitError) {
    console.error("Delivery route rate limiter unavailable", rateLimitError);
    return json({ error: "Delivery distance service is temporarily unavailable. Please try again." }, 503);
  }
  if (allowed !== true) {
    return json({ error: "Too many delivery distance requests. Please wait a minute and try again." }, 429);
  }

  const coordinates = `${originLng},${originLat};${longitude},${latitude}`;
  const params = new URLSearchParams({
    access_token: directionsApiToken,
    alternatives: 'false',
    overview: 'false',
  });

  const routeResponse = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?${params.toString()}`);
  const routeBody = await routeResponse.json().catch(() => ({}));
  const distanceMeters = Number(routeBody?.routes?.[0]?.distance);

  if (!routeResponse.ok || !Number.isFinite(distanceMeters)) {
    await admin.from("system_api_usage_events").insert({
      provider: "mapbox", service: "directions", operation: "calculate_driving_distance", restaurant_id: restaurantId,
      request_count: 1, status: routeResponse.status === 429 ? "blocked" : "error", estimated_cost_usd: 0,
      metadata: { http_status: routeResponse.status },
    });
    console.error("Mapbox Directions API failed", { status: routeResponse.status, body: routeBody });
    return json({ error: "We could not calculate the delivery distance. Please try again." }, 502);
  }

  const increments = Math.ceil(distanceMeters / incrementMeters);
  const deliveryFee = Math.max(0, Number((baseFee + increments * feePerIncrement).toFixed(2)));
  const inRange = distanceMeters <= maxDistanceMeters;

  const { data: quote, error: quoteError } = await admin.from("delivery_quotes").insert({
    restaurant_id: restaurantId, customer_latitude: latitude, customer_longitude: longitude,
    distance_meters: Math.round(distanceMeters), delivery_fee: deliveryFee,
  }).select("id,expires_at").single();

  await admin.from("system_api_usage_events").insert({
    provider: "mapbox", service: "directions", operation: "calculate_driving_distance", restaurant_id: restaurantId,
    request_count: 1, status: "success", estimated_cost_usd: 0,
    metadata: { distance_meters: Math.round(distanceMeters), in_range: inRange, routing_profile: "mapbox/driving", cached: false },
  });

  if (quoteError || !quote) {
    console.error("Unable to store delivery quote", quoteError);
    return json({ error: "We calculated the delivery distance but could not save the confirmation. Please try again." }, 500);
  }

  return json({ quoteId: quote.id, expiresAt: quote.expires_at, distanceMeters: Math.round(distanceMeters), deliveryFee, maxDistanceMeters, inRange });
});
