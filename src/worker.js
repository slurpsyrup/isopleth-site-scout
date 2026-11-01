// Site Scout Worker: serves the static app (Workers Static Assets) and proxies two read-only calls to Isopleth.
// The Isopleth key lives only here, as the ISOPLETH_KEY secret. The browser never sees it.
//
//   GET /api/point?lat=..&lng=..   -> POST /v1/fetch   (the fields in public/fields.js; 1 lookup per new point)
//   GET /api/geocode?q=..          -> POST /v1/geocode (free, Census-backed)
//   GET /api/health                -> {ok, key_set}
//
// Protection, cheapest first: edge cache -> KV cache -> envelope check -> per-IP rate limits -> Census land check
// -> Isopleth. Only a cache miss that passes every check spends a lookup.
import { FIELDS } from "../public/fields.js";
import { round5, validLatLng, inEnvelope } from "../public/coords.js";
import { API_BASE, fetchBody } from "../public/request.js";
import { CACHE_TTL_S, PARTIAL_TTL_S, UA, OUTSIDE, pointKey, json, err, upstreamError, limited, inUSState, isOutsideUS } from "./lib.js";

function edgeCache() {
  return typeof caches !== "undefined" && caches.default ? caches.default : null;
}

function cacheReq(key) {
  return new Request(`https://site-scout.cache/${encodeURIComponent(key)}`);
}

async function handlePoint(url, request, env, ctx) {
  const lat0 = parseFloat(url.searchParams.get("lat"));
  const lng0 = parseFloat(url.searchParams.get("lng"));
  if (!validLatLng(lat0, lng0)) return err(400, "bad_point", "Send lat and lng as decimal degrees.");
  const lat = round5(lat0);
  const lng = round5(lng0);
  const key = pointKey(lat, lng);
  const hit = { "cache-control": "public, max-age=3600" };

  const outside = () => err(422, "outside_us", "That spot is open water or outside the U.S. Site Scout covers U.S. land and state waters.", {}, { "cache-control": "public, max-age=86400" });
  const cache = edgeCache();
  if (cache) {
    const c = await cache.match(cacheReq(key));
    if (c && c.status === 422) return outside();
    if (c) return new Response(c.body, { status: 200, headers: { ...Object.fromEntries(c.headers), ...hit, "x-scout-cache": "edge" } });
  }
  if (env.CACHE) {
    const v = await env.CACHE.get(key).catch(() => null);
    if (v === OUTSIDE) return outside();
    if (v) {
      if (cache) ctx.waitUntil(cache.put(cacheReq(key), new Response(v, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${CACHE_TTL_S}` } })));
      return new Response(v, { headers: { "content-type": "application/json; charset=utf-8", ...hit, "x-scout-cache": "kv" } });
    }
  }

  if (!inEnvelope(lat, lng)) return err(422, "outside_us", "Site Scout covers the United States. Pick a point on U.S. land.");
  if (!env.ISOPLETH_KEY) return err(500, "not_configured", "Set the ISOPLETH_KEY secret: npx wrangler secret put ISOPLETH_KEY");

  const ip = request.headers.get("cf-connecting-ip") || "anon";
  if ((await limited(env.BURST_LIMITER, ip)) || (await limited(env.POINT_LIMITER, ip))) {
    return err(429, "rate_limited", "The free demo allows a few new points a minute per visitor. Points already looked up, like the presets, still load. Try again in a minute, or get a free key and query as much as your plan allows.", { retry_after_s: 60, limit_per_min: Number(env.POINT_LIMIT_PER_MIN || 6) }, { "retry-after": "60" });
  }

  // Ceiling across all visitors, so a launch spike can't crowd the shared Isopleth capacity paying users rely on.
  if (await limited(env.GLOBAL_LIMITER, "all")) {
    return err(503, "demo_capacity", "The free demo is busy right now. Points already looked up (like the presets) still load instantly. Try a new point in a minute, or grab a free key and run your own.", { retry_after_s: 60 }, { "retry-after": "60" });
  }

  const land = await inUSState(lat, lng);
  if (land === false) return outside();

  let r;
  try {
    r = await fetch(`${env.ISOPLETH_API_BASE || API_BASE}/v1/fetch`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.ISOPLETH_KEY}`, "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify(fetchBody(lat, lng)),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    return err(504, "timeout", "The data sources took too long. Try again in a few seconds.", { retry_after_s: 5 });
  }
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!r.ok || !body) {
    const [s, code, msg, extra] = upstreamError(r.status, body);
    return err(s, code, msg, extra || {});
  }

  // Backstop for when the Census pre-check was unavailable: Isopleth itself says the point is in no state.
  if (isOutsideUS(body)) {
    if (cache) ctx.waitUntil(cache.put(cacheReq(key), outside()));
    if (env.CACHE) ctx.waitUntil(env.CACHE.put(key, OUTSIDE, { expirationTtl: CACHE_TTL_S }).catch(() => {}));
    return outside();
  }
  const partial = Array.isArray(body.partial_failures) && body.partial_failures.length > 0;
  const ttl = partial ? PARTIAL_TTL_S : CACHE_TTL_S;
  if (cache) ctx.waitUntil(cache.put(cacheReq(key), new Response(text, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}` } })));
  if (env.CACHE && !partial) ctx.waitUntil(env.CACHE.put(key, text, { expirationTtl: CACHE_TTL_S }).catch(() => {}));
  return new Response(text, { headers: { "content-type": "application/json; charset=utf-8", ...hit, "x-scout-cache": "miss", "x-scout-land": String(land), "x-lookups-charged": r.headers.get("x-lookups-charged") || "" } });
}

async function handleGeocode(url, request, env) {
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 4 || q.length > 200) return err(400, "bad_query", "Type a U.S. street address, like 1600 Pennsylvania Ave NW, Washington, DC.");
  if (!env.ISOPLETH_KEY) return err(500, "not_configured", "Set the ISOPLETH_KEY secret: npx wrangler secret put ISOPLETH_KEY");
  const ip = request.headers.get("cf-connecting-ip") || "anon";
  if (await limited(env.GEOCODE_LIMITER, ip)) return err(429, "rate_limited", "Too many searches in a minute. Try again shortly.", { retry_after_s: 60 }, { "retry-after": "60" });
  let r;
  try {
    r = await fetch(`${env.ISOPLETH_API_BASE || API_BASE}/v1/geocode`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.ISOPLETH_KEY}`, "content-type": "application/json", "user-agent": UA },
      body: JSON.stringify({ address: q }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return err(504, "timeout", "The geocoder took too long. Try again, or paste coordinates.");
  }
  const d = await r.json().catch(() => null);
  if (r.status === 404 || (d && d.error && d.error.code === "address_not_found"))
    return err(404, "not_found", "No match for that address. Try adding the city and state, or paste coordinates.");
  if (!r.ok || !d || !Number.isFinite(d.lat)) return err(502, "geocode_failed", "Address search is unavailable right now. Paste coordinates or tap the map.");
  // Addresses are not cached or logged.
  return json({ lat: round5(d.lat), lng: round5(d.lng), label: d.normalized_address || q, precision_note: d.precision_note || null }, 200, { "cache-control": "no-store" });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return err(405, "method_not_allowed", "GET only.", {}, { allow: "GET" });
      if (url.pathname === "/api/point") {
        const res = await handlePoint(url, request, env, ctx);
        // Optional partner link (public/partner.js), set per deploy and never stored in the caches.
        if (res.status === 200) res.headers.set("x-scout-ctl", env.CHECK_THE_LAND_CTA === "on" ? "on" : "off");
        return res;
      }
      if (url.pathname === "/api/geocode") return handleGeocode(url, request, env);
      if (url.pathname === "/api/health") return json({ ok: true, key_set: Boolean(env.ISOPLETH_KEY), fields: FIELDS.length }, 200, { "cache-control": "no-store" });
      return err(404, "not_found", "Unknown endpoint.");
    }
    return env.ASSETS.fetch(request);
  },
};
