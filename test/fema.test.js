import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { summarize, openFemaUrl, countyAt, OPENFEMA } from "../src/fema.js";

const realFetch = globalThis.fetch;
let calls;
const ROWS = [
  { disasterNumber: 4798, declarationDate: "2024-07-09T00:00:00.000Z", declarationType: "DR", incidentType: "Hurricane", declarationTitle: "HURRICANE BERYL" },
  { disasterNumber: 4798, declarationDate: "2024-07-09T00:00:00.000Z", declarationType: "DR", incidentType: "Hurricane", declarationTitle: "HURRICANE BERYL" },
  { disasterNumber: 4781, declarationDate: "2024-05-17T00:00:00.000Z", declarationType: "DR", incidentType: "Flood", declarationTitle: "SEVERE STORMS AND FLOODING" },
  { disasterNumber: 3216, declarationDate: "2005-09-02T00:00:00.000Z", declarationType: "EM", incidentType: "Hurricane", declarationTitle: "HURRICANE KATRINA EVACUATION" },
  { disasterNumber: 200, declarationDate: "1965-06-01T00:00:00.000Z", declarationType: "DR", incidentType: "Flood", declarationTitle: "FLOODING" },
];

function kv() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } };
}
function ctx() {
  const p = [];
  return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) };
}
const req = (path, ip = "1.2.3.4") => new Request(`https://scout.example${path}`, { headers: { "cf-connecting-ip": ip } });
function mock({ county = { STATE: "48", COUNTY: "201", NAME: "Harris County" }, fema = () => Response.json({ DisasterDeclarationsSummaries: ROWS }) } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("https://geocoding.geo.census.gov/")) {
      if (county === "error") throw new Error("down");
      return Response.json({ result: { geographies: { Counties: county ? [county] : [] } } });
    }
    if (u.startsWith(OPENFEMA)) return fema(u);
    throw new Error(`unexpected fetch ${u}`);
  };
}
beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test("summarize dedupes disasters and counts the last 10 years", () => {
  const s = summarize(ROWS, new Date("2026-11-01T00:00:00Z"));
  assert.equal(s.total, 4);
  assert.equal(s.major, 3);
  assert.equal(s.last_10_years, 2);
  assert.equal(s.first_year, 1965);
  assert.deepEqual(s.most_recent, { id: "DR-4798", title: "Hurricane Beryl", incident_type: "Hurricane", declaration_type: "Major disaster", date: "2024-07-09" });
  assert.deepEqual(s.top_types, [{ type: "Flood", count: 2 }, { type: "Hurricane", count: 2 }]);
  assert.equal(summarize([]).total, 0);
});

test("the OpenFEMA query filters by county FIPS and rejects anything else", () => {
  const u = new URL(openFemaUrl("48", "201"));
  assert.equal(u.searchParams.get("$filter"), "fipsStateCode eq '48' and fipsCountyCode eq '201'");
  assert.ok(!u.search.includes("+"));
  assert.throws(() => openFemaUrl("48", "201' or 1 eq 1"));
});

test("countyAt: null when no county, undefined when Census is down", async () => {
  mock({ county: false });
  assert.equal(await countyAt(29.76, -95.37), null);
  mock({ county: "error" });
  assert.equal(await countyAt(29.76, -95.37), undefined);
});

test("/api/disasters calls OpenFEMA once per county and needs no Isopleth key", async () => {
  mock();
  const e = { CACHE: kv() }, c = ctx();
  const r = await worker.fetch(req("/api/disasters?lat=29.7604&lng=-95.3698"), e, c);
  await c.done();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-scout-cache"), "miss");
  const d = await r.json();
  assert.equal(d.county.fips, "48201");
  assert.equal(d.total, 4);
  assert.match(d.source.url, /^https:\/\/www\.fema\.gov\/openfema-data-page\//);
  assert.match(d.source.disclaimer, /not endorsed by FEMA/);
  assert.equal(calls.filter((u) => u.startsWith(OPENFEMA)).length, 1);
  assert.ok(e.CACHE.m.has("fema:v1:48201"));

  calls = [];
  const r2 = await worker.fetch(req("/api/disasters?lat=29.75&lng=-95.36"), e, ctx());
  assert.equal(r2.headers.get("x-scout-cache"), "kv");
  assert.equal(calls.filter((u) => u.startsWith(OPENFEMA)).length, 0);
});

test("/api/disasters: bad input, outside the U.S., no county, limits and upstream errors", async () => {
  mock();
  assert.equal((await worker.fetch(req("/api/disasters?lat=x&lng=1"), {}, ctx())).status, 400);
  assert.equal((await worker.fetch(req("/api/disasters?lat=51.5&lng=-0.12"), {}, ctx())).status, 422);
  assert.equal(calls.length, 0);
  mock({ county: false });
  assert.equal((await worker.fetch(req("/api/disasters?lat=26&lng=-90"), {}, ctx())).status, 422);
  mock({ county: { STATE: "09", COUNTY: "110", NAME: "Capitol Planning Region" } });
  const ct = await worker.fetch(req("/api/disasters?lat=41.76&lng=-72.67"), {}, ctx());
  assert.equal(ct.status, 422);
  assert.equal((await ct.json()).error.code, "no_county_match");
  assert.ok(!calls.some((u) => u.startsWith(OPENFEMA)));
  const lim = { limit: async () => ({ success: false }) };
  assert.equal((await worker.fetch(req("/api/disasters?lat=29.76&lng=-95.37"), { DISASTER_LIMITER: lim }, ctx())).status, 429);
  mock({ fema: () => new Response("no", { status: 500 }) });
  const e = { CACHE: kv() };
  const r = await worker.fetch(req("/api/disasters?lat=29.76&lng=-95.37"), e, ctx());
  assert.equal(r.status, 503);
  assert.equal(e.CACHE.m.size, 0);
});
