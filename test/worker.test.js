import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/worker.js";
import { pointKey, upstreamError, inUSState, FIELDS_HASH, fnv1a } from "../src/lib.js";
import { FIELDS } from "../public/fields.js";

const SAMPLE = readFileSync(new URL("./fixtures/fetch-wtx.json", import.meta.url), "utf8");
const realFetch = globalThis.fetch;
let calls;

function kv() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
}
function limiter(n) {
  let used = 0;
  return { limit: async () => ({ success: ++used <= n }) };
}
function ctx() {
  const p = [];
  return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) };
}
function env(extra = {}) {
  return { ISOPLETH_KEY: "test-key", CACHE: kv(), POINT_LIMITER: limiter(100), BURST_LIMITER: limiter(100), GEOCODE_LIMITER: limiter(100), ASSETS: { fetch: async () => new Response("asset") }, ...extra };
}
function req(path, ip = "1.2.3.4", method = "GET") {
  return new Request(`https://scout.example${path}`, { method, headers: { "cf-connecting-ip": ip } });
}
/** Route outgoing fetches: Census land check and Isopleth. */
function mockFetch({ land = true, api = () => new Response(SAMPLE, { headers: { "x-lookups-charged": "1" } }), geo } = {}) {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith("https://geocoding.geo.census.gov/")) {
      if (land === "error") throw new Error("down");
      return Response.json({ result: { geographies: land ? { States: [{ NAME: "Texas" }] } : {} } });
    }
    if (u.endsWith("/v1/fetch")) return api(init);
    if (u.endsWith("/v1/geocode")) return geo ? geo(init) : Response.json({ lat: 38.898702605245, lng: -77.035189204737, normalized_address: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500" });
    throw new Error(`unexpected fetch ${u}`);
  };
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test("cache key rounds to 5 decimals and includes the field list hash", () => {
  assert.equal(pointKey(32.2, -101.45), `pt:v1:${FIELDS_HASH}:32.20000,-101.45000`);
  assert.equal(FIELDS_HASH, fnv1a(FIELDS.join(",")));
  assert.notEqual(fnv1a("a,b"), fnv1a("a,c"));
});

test("a new point calls Isopleth once with the key server-side, then serves from KV", async () => {
  mockFetch();
  const e = env(), c = ctx();
  const r = await worker.fetch(req("/api/point?lat=32.2000001&lng=-101.45"), e, c);
  await c.done();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-scout-cache"), "miss");
  const api = calls.find((x) => x.url.endsWith("/v1/fetch"));
  assert.equal(api.init.headers.authorization, "Bearer test-key");
  const sent = JSON.parse(api.init.body);
  assert.equal(sent.lat, 32.2);
  assert.deepEqual(sent.fields, FIELDS);
  const out = await r.json();
  assert.ok(out.fields.nfhl_flood_zone);
  assert.ok(!JSON.stringify(out).includes("test-key"));
  assert.equal(e.CACHE.m.size, 1);

  calls = [];
  const r2 = await worker.fetch(req("/api/point?lat=32.2&lng=-101.45"), e, ctx());
  assert.equal(r2.headers.get("x-scout-cache"), "kv");
  assert.equal(calls.length, 0);
});

test("results with partial failures are not stored in KV", async () => {
  const partial = JSON.stringify({ ...JSON.parse(SAMPLE), partial_failures: [{ field: "elevation" }] });
  mockFetch({ api: () => new Response(partial) });
  const e = env(), c = ctx();
  const r = await worker.fetch(req("/api/point?lat=32.2&lng=-101.45"), e, c);
  await c.done();
  assert.equal(r.status, 200);
  assert.equal(e.CACHE.m.size, 0);
});

test("outside the envelope is rejected without any outgoing call", async () => {
  mockFetch();
  const r = await worker.fetch(req("/api/point?lat=51.5&lng=-0.12"), env(), ctx());
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, "outside_us");
  assert.equal(calls.length, 0);
});

test("open water inside the envelope is caught by the Census land check before spending a lookup", async () => {
  mockFetch({ land: false });
  const r = await worker.fetch(req("/api/point?lat=26&lng=-90"), env(), ctx());
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, "outside_us");
  assert.ok(!calls.some((x) => x.url.endsWith("/v1/fetch")));
});

test("if Census is down and Isopleth reports no state, the visitor sees outside_us and the point is never charged again", async () => {
  const sea = JSON.parse(SAMPLE);
  sea.fields.political_region = { value: null, status: "absent", notes: "Point is not inside a US state/territory." };
  let n = 0;
  mockFetch({ land: "error", api: () => { n++; return new Response(JSON.stringify(sea)); } });
  const e = env(), c = ctx();
  const r = await worker.fetch(req("/api/point?lat=26&lng=-90"), e, c);
  await c.done();
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, "outside_us");
  const r2 = await worker.fetch(req("/api/point?lat=26&lng=-90"), e, ctx());
  assert.equal(r2.status, 422);
  assert.equal(n, 1);
});

test("if the Census check fails, the request still goes through", async () => {
  mockFetch({ land: "error" });
  const r = await worker.fetch(req("/api/point?lat=32.2&lng=-101.45"), env(), ctx());
  assert.equal(r.status, 200);
});

test("rate limits return a friendly 429, and cache hits are never limited", async () => {
  mockFetch();
  const e = env({ BURST_LIMITER: limiter(3) });
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const r = await worker.fetch(req(`/api/point?lat=32.${i + 1}&lng=-101.45`), e, ctx());
    codes.push(r.status);
    if (r.status === 429) {
      const b = await r.json();
      assert.equal(b.error.code, "rate_limited");
      assert.match(b.error.message, /demo/i);
      assert.equal(r.headers.get("retry-after"), "60");
    }
  }
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  const hit = await worker.fetch(req("/api/point?lat=32.1&lng=-101.45"), e, ctx());
  assert.equal(hit.status, 200);
  assert.equal(hit.headers.get("x-scout-cache"), "kv");
});

test("the global ceiling returns demo_capacity without calling Isopleth", async () => {
  mockFetch();
  const r = await worker.fetch(req("/api/point?lat=33.3&lng=-101.45"), env({ GLOBAL_LIMITER: limiter(0) }), ctx());
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.code, "demo_capacity");
  assert.equal(calls.length, 0);
});

test("upstream errors map to messages a visitor can act on", async () => {
  assert.equal(upstreamError(400, { error: { code: "coord_out_of_bounds" } })[1], "outside_us");
  assert.equal(upstreamError(429, {})[1], "demo_capacity");
  assert.equal(upstreamError(402, {})[1], "demo_capacity");
  assert.equal(upstreamError(503, {})[1], "busy");
  assert.equal(upstreamError(401, {})[1], "not_configured");
  assert.equal(upstreamError(500, null)[1], "upstream_error");
  mockFetch({ api: () => Response.json({ error: { code: "rate_limited" } }, { status: 429 }) });
  const r = await worker.fetch(req("/api/point?lat=32.2&lng=-101.45"), env(), ctx());
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.code, "demo_capacity");
});

test("bad input and missing key", async () => {
  mockFetch();
  assert.equal((await worker.fetch(req("/api/point?lat=abc&lng=1"), env(), ctx())).status, 400);
  const r = await worker.fetch(req("/api/point?lat=32.2&lng=-101.45"), env({ ISOPLETH_KEY: "" }), ctx());
  assert.equal(r.status, 500);
  assert.equal((await r.json()).error.code, "not_configured");
  assert.equal((await worker.fetch(req("/api/point?lat=32.2&lng=-101.45", "x", "POST"), env(), ctx())).status, 405);
  assert.equal((await worker.fetch(req("/api/admin"), env(), ctx())).status, 404);
});

test("geocode proxies to the free endpoint, rounds and does not cache", async () => {
  mockFetch();
  const e = env();
  const r = await worker.fetch(req("/api/geocode?q=1600%20Pennsylvania%20Ave%20NW%2C%20Washington%20DC"), e, ctx());
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const d = await r.json();
  assert.equal(d.lat, 38.8987);
  assert.equal(d.lng, -77.03519);
  assert.equal(e.CACHE.m.size, 0);
  assert.equal(JSON.parse(calls[0].init.body).address, "1600 Pennsylvania Ave NW, Washington DC");
  assert.equal((await worker.fetch(req("/api/geocode?q=ab"), e, ctx())).status, 400);
  mockFetch({ geo: () => Response.json({ error: { code: "address_not_found" } }, { status: 404 }) });
  assert.equal((await worker.fetch(req("/api/geocode?q=nowhere%20at%20all"), e, ctx())).status, 404);
});

test("health reports only whether the key is set", async () => {
  const r = await worker.fetch(req("/api/health"), env(), ctx());
  const d = await r.json();
  assert.equal(d.key_set, true);
  assert.ok(!JSON.stringify(d).includes("test-key"));
});

test("non-API paths go to static assets", async () => {
  const r = await worker.fetch(req("/"), env(), ctx());
  assert.equal(await r.text(), "asset");
});

test("inUSState reads the Census States layer", async () => {
  mockFetch({ land: true });
  assert.equal(await inUSState(32.2, -101.45), true);
  mockFetch({ land: false });
  assert.equal(await inUSState(26, -90), false);
  mockFetch({ land: "error" });
  assert.equal(await inUSState(26, -90), null);
});
