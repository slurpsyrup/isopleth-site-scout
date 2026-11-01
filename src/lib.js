// Site Scout Worker helpers. They live here, not in worker.js, because a Worker module may only export handlers.
// See worker.js for the request flow.
import { FIELDS } from "../public/fields.js";

export const CACHE_VERSION = "v1";
export const CACHE_TTL_S = 7 * 24 * 3600; // complete results
export const PARTIAL_TTL_S = 3600; // results where a source timed out: retry sooner
export const CENSUS_STATES =
  "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?benchmark=Public_AR_Current&vintage=Current_Current&layers=States&format=json";
export const OUTSIDE = "OUTSIDE_US"; // KV marker for a point known to be outside every U.S. state
export const UA = "isopleth-site-scout/1.0 (+https://github.com/slurpsyrup/isopleth-site-scout)";

/** FNV-1a, so the cache key changes whenever the field list changes. */
export function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const FIELDS_HASH = fnv1a(FIELDS.join(","));

export function pointKey(lat, lng) {
  return `pt:${CACHE_VERSION}:${FIELDS_HASH}:${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...headers },
  });
}

export function err(status, code, message, extra = {}, headers = {}) {
  return json({ error: { code, message, ...extra } }, status, { "cache-control": "no-store", ...headers });
}

/** Map an Isopleth error to a message a demo visitor can act on. */
export function upstreamError(status, body) {
  const code = body && body.error && body.error.code;
  if (code === "coord_out_of_bounds") return [422, "outside_us", "Site Scout covers the United States. Pick a point on U.S. land."];
  if (status === 429 || status === 402 || code === "daily_cap_reached" || code === "quota_exhausted")
    return [503, "demo_capacity", "The free demo is at capacity right now. Try again in a minute, or get your own free key and run it yourself.", { retry_after_s: 60 }];
  if (status === 503 || status === 504) return [503, "busy", "The data sources are busy. Try again in a few seconds.", { retry_after_s: 5 }];
  if (status === 401 || status === 403) return [500, "not_configured", "This deployment's Isopleth key is missing or invalid."];
  return [502, "upstream_error", "Isopleth could not answer for this point. Try again or pick another spot."];
}

export async function limited(limiter, key) {
  if (!limiter || typeof limiter.limit !== "function") return false; // binding not configured (e.g. local tests)
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch {
    return false; // fail open on limiter errors; Isopleth's own plan limits still apply
  }
}

/** true = U.S. land/state waters, false = not in any state, null = unknown (Census down: let Isopleth decide). */
export async function inUSState(lat, lng, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${CENSUS_STATES}&x=${lng}&y=${lat}`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const states = d && d.result && d.result.geographies && d.result.geographies.States;
    return Array.isArray(states) && states.length > 0;
  } catch {
    return null;
  }
}


/** True when Isopleth's own Census lookup found no state at the point (open water, Canada, Mexico...). */
export function isOutsideUS(body) {
  const r = body && body.fields && body.fields.political_region;
  return Boolean(r && r.status === "absent" && /not inside a US state/i.test(r.notes || ""));
}
