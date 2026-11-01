// FEMA disaster history for the county under a point, from the free OpenFEMA API (no key needed).
//
//   GET /api/disasters?lat=..&lng=..
//     1. Edge cache per point (1 day)                          ── hit → done
//     2. Per-IP limit (DISASTER_LIMITER, optional binding)     ── over → 429
//     3. Census geocoder: which county is the point in?        ── none → 422
//     4. KV cache per county (1 day)                           ── hit → done
//     5. OpenFEMA DisasterDeclarationsSummaries v2 for that county, summarized
//
// This never touches your Isopleth key or quota. It is a second, independent public source shown next to the
// Isopleth facts, and an example of how to mix your own calls into the template.
import { round5, validLatLng, inEnvelope } from "../public/coords.js";
import { UA, json, err, limited } from "./lib.js";

// Required wording from https://www.fema.gov/about/openfema/terms-conditions ("Citing Data").
export const FEMA_DISCLAIMER = "This product uses the Federal Emergency Management Agency's OpenFEMA API, but is not endorsed by FEMA. The Federal Government or FEMA cannot vouch for the data or analyses derived from these data after the data have been retrieved from the Agency's website(s).";
export const FEMA_TTL_S = 24 * 3600;
export const OPENFEMA = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries";
export const OPENFEMA_PAGE = "https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2";
export const CENSUS_COUNTIES =
  "https://geocoding.geo.census.gov/geocoder/geographies/coordinates?benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json";
const TYPE_NAMES = { DR: "Major disaster", EM: "Emergency", FM: "Fire management" };

/** The OpenFEMA query for one county. FIPS codes are digits only, so they are safe to put in the filter. */
export function openFemaUrl(state, county) {
  if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county)) throw new Error("bad fips");
  const q = new URLSearchParams({
    $filter: `fipsStateCode eq '${state}' and fipsCountyCode eq '${county}'`,
    $select: "disasterNumber,declarationDate,declarationType,incidentType,declarationTitle,designatedArea",
    $orderby: "declarationDate desc",
    $top: "1000",
  });
  return `${OPENFEMA}?${q.toString().replace(/\+/g, "%20")}`;
}

/** {state, county, name} for the county containing the point, null if none, undefined if Census is unavailable. */
export async function countyAt(lat, lng, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${CENSUS_COUNTIES}&x=${lng}&y=${lat}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return undefined;
    const d = await r.json();
    const c = d && d.result && d.result.geographies && d.result.geographies.Counties;
    if (!Array.isArray(c)) return undefined;
    if (!c.length || !c[0].STATE || !c[0].COUNTY) return null;
    return { state: String(c[0].STATE), county: String(c[0].COUNTY), name: c[0].NAME || null };
  } catch {
    return undefined;
  }
}

function title(s) {
  return String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(And|Of|The|In|Or)\b/g, (m) => m.toLowerCase());
}

/** Summarize OpenFEMA rows (one per disaster per designated area) into what the panel shows. */
export function summarize(rows, now = new Date()) {
  const seen = new Map();
  for (const r of rows || []) if (r && r.disasterNumber != null && !seen.has(r.disasterNumber)) seen.set(r.disasterNumber, r);
  const list = [...seen.values()].filter((r) => r.declarationDate).sort((a, b) => String(b.declarationDate).localeCompare(String(a.declarationDate)));
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 10);
  const types = new Map();
  for (const r of list) types.set(r.incidentType, (types.get(r.incidentType) || 0) + 1);
  const r0 = list[0];
  return {
    total: list.length,
    major: list.filter((r) => r.declarationType === "DR").length,
    last_10_years: list.filter((r) => new Date(r.declarationDate) >= cutoff).length,
    first_year: list.length ? Number(String(list[list.length - 1].declarationDate).slice(0, 4)) : null,
    most_recent: r0 ? {
      id: `${r0.declarationType}-${r0.disasterNumber}`,
      title: title(r0.declarationTitle),
      incident_type: r0.incidentType,
      declaration_type: TYPE_NAMES[r0.declarationType] || r0.declarationType,
      date: String(r0.declarationDate).slice(0, 10),
    } : null,
    top_types: [...types.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 3).map(([type, count]) => ({ type, count })),
  };
}

function cacheReq(key) {
  return new Request(`https://site-scout.cache/${encodeURIComponent(key)}`);
}

export async function handleDisasters(url, request, env, ctx) {
  const lat0 = parseFloat(url.searchParams.get("lat"));
  const lng0 = parseFloat(url.searchParams.get("lng"));
  if (!validLatLng(lat0, lng0)) return err(400, "bad_point", "Send lat and lng as decimal degrees.");
  const lat = round5(lat0), lng = round5(lng0);
  if (!inEnvelope(lat, lng)) return err(422, "outside_us", "FEMA disaster history covers U.S. counties.");
  const ok = (body, how) => json(body, 200, { "cache-control": "public, max-age=3600", "x-scout-cache": how });

  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  const pkey = `fema:v1:${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache) {
    const c = await cache.match(cacheReq(pkey)).catch(() => null);
    if (c) return ok(await c.json(), "edge");
  }

  const ip = request.headers.get("cf-connecting-ip") || "anon";
  if (await limited(env.DISASTER_LIMITER, ip)) return err(429, "rate_limited", "Too many new points in a minute. Try again shortly.", { retry_after_s: 60 }, { "retry-after": "60" });

  const c = await countyAt(lat, lng);
  if (c === null) return err(422, "no_county", "That spot is not inside a U.S. county.");
  if (c === undefined) return err(503, "busy", "The Census county lookup is unavailable. Try again shortly.", { retry_after_s: 30 });

  // Census now maps Connecticut by planning region (09110-09190), but OpenFEMA files it under the former counties.
  if (c.state === "09" && Number(c.county) >= 100)
    return err(422, "no_county_match", "FEMA records Connecticut disasters by its former counties, which no longer match Census planning regions, so there's no county history to show here.", {}, { "cache-control": "public, max-age=86400" });

  const ckey = `fema:v1:${c.state}${c.county}`;
  const store = (body) => {
    const s = JSON.stringify(body);
    if (cache) ctx.waitUntil(cache.put(cacheReq(pkey), new Response(s, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${FEMA_TTL_S}` } })).catch(() => {}));
  };
  if (env.CACHE) {
    const v = await env.CACHE.get(ckey).catch(() => null);
    if (v) { const body = JSON.parse(v); store(body); return ok(body, "kv"); }
  }

  const api = openFemaUrl(c.state, c.county);
  let d;
  try {
    const r = await fetch(api, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(String(r.status));
    d = await r.json();
  } catch {
    return err(503, "busy", "OpenFEMA is not answering right now. Try again shortly.", { retry_after_s: 30 });
  }
  const rows = d && d.DisasterDeclarationsSummaries;
  if (!Array.isArray(rows)) return err(502, "upstream_error", "OpenFEMA sent an unexpected response.");
  const body = {
    county: { name: c.name, fips: `${c.state}${c.county}` },
    ...summarize(rows),
    source: { name: "FEMA OpenFEMA: Disaster Declarations Summaries", url: OPENFEMA_PAGE, api_url: api, license: "U.S. federal public domain", disclaimer: FEMA_DISCLAIMER },
    note: "County-designated federal disaster and emergency declarations since 1953. Statewide-only declarations are not counted.",
    fetched_at: new Date().toISOString(),
  };
  store(body);
  if (env.CACHE) ctx.waitUntil(env.CACHE.put(ckey, JSON.stringify(body), { expirationTtl: FEMA_TTL_S }).catch(() => {}));
  return ok(body, "miss");
}
