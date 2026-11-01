import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELDS, GROUPS, HEADLINES, PRESETS, CONTEXT_FIELDS } from "../public/fields.js";
import { parseCoords, round5, inEnvelope, formatAt, parseAt, validLatLng } from "../public/coords.js";
import { fetchBody, snippets, MAX_WAIT_S } from "../public/request.js";
import { formatValue, distance, missingNote, titleCase } from "../public/format.js";
import { sourceLink, SOURCES } from "../public/sources.js";
import { readFileSync } from "node:fs";

test("field list fits in one lookup and has no duplicates", () => {
  assert.ok(FIELDS.length <= 50, `${FIELDS.length} fields`);
  assert.equal(new Set(FIELDS).size, FIELDS.length);
  for (const h of HEADLINES) assert.ok(FIELDS.includes(h.name), h.name);
  for (const c of CONTEXT_FIELDS) assert.ok(FIELDS.includes(c));
  for (const g of GROUPS) assert.ok(g.fields.length > 0 && g.title && g.icon);
});

test("every requested field exists in the Isopleth catalog snapshot and is not held", () => {
  const meta = JSON.parse(readFileSync(new URL("./fixtures/meta-fields.json", import.meta.url)));
  const names = new Set(meta.map((f) => f.name));
  for (const f of FIELDS) assert.ok(names.has(f), `unknown field ${f}`);
  const held = new Set(meta.filter((f) => f.api_available === false).map((f) => f.name));
  for (const f of FIELDS) assert.ok(!held.has(f), `held field ${f}`);
});

test("presets are inside the U.S. envelope", () => {
  assert.ok(PRESETS.length >= 3);
  for (const p of PRESETS) assert.ok(inEnvelope(p.lat, p.lng), p.id);
});

test("coordinates parse in common forms", () => {
  assert.deepEqual(parseCoords("32.2, -101.45"), { lat: 32.2, lng: -101.45 });
  assert.deepEqual(parseCoords("32.2 -101.45"), { lat: 32.2, lng: -101.45 });
  assert.deepEqual(parseCoords("39.0293° N, 77.4588° W"), { lat: 39.0293, lng: -77.4588 });
  assert.deepEqual(parseCoords("36.45, 114.92"), { lat: 36.45, lng: -114.92 });
  assert.equal(parseCoords("1600 Pennsylvania Ave NW"), null);
  assert.equal(parseCoords("123 Main St, 45678"), null);
});

test("rounding, envelope and share URL", () => {
  assert.equal(round5(32.1234567), 32.12346);
  assert.ok(validLatLng(0, 0));
  assert.ok(!validLatLng(91, 0));
  assert.ok(!validLatLng(NaN, 0));
  assert.ok(inEnvelope(32.2, -101.45));
  assert.ok(inEnvelope(61.2, -149.9)); // Alaska
  assert.ok(inEnvelope(21.3, -157.8)); // Hawaii
  assert.ok(!inEnvelope(51.5, -0.12)); // London
  assert.ok(!inEnvelope(-33.9, 151.2));
  assert.equal(formatAt(32.2, -101.45), "32.20000,-101.45000");
  assert.deepEqual(parseAt("32.20000,-101.45000"), { lat: 32.2, lng: -101.45 });
  assert.equal(parseAt("abc"), null);
  assert.equal(parseAt(""), null);
});

test("request body and snippets", () => {
  const b = fetchBody(32.2, -101.45);
  assert.equal(b.lat, 32.2);
  assert.equal(b.fields.length, FIELDS.length);
  assert.equal(b.max_wait_s, MAX_WAIT_S);
  const s = snippets(32.2, -101.45);
  for (const k of ["curl", "python", "node"]) {
    assert.match(s[k], /ISOPLETH_KEY/);
    assert.match(s[k], /\/v1\/fetch/);
    assert.match(s[k], /nfhl_flood_zone/);
    assert.doesNotMatch(s[k], /isp_(live|test)_[A-Za-z0-9]/);
  }
  assert.match(s.curl, /\$ISOPLETH_KEY/);
  // The cURL body must be valid JSON equal to what the Worker sends.
  const body = s.curl.slice(s.curl.indexOf("-d '") + 4, s.curl.lastIndexOf("'"));
  assert.deepEqual(JSON.parse(body), b);
});

test("value formatting", () => {
  assert.equal(formatValue(4366, "dist"), "4.4 km · 2.7 mi");
  assert.equal(formatValue(850, "dist"), "850 m");
  assert.equal(formatValue(44.83, "pct"), "44.8%");
  assert.equal(formatValue(0.0712, "kwh"), "7.1¢/kWh");
  assert.equal(formatValue(true, "bool"), "Yes");
  assert.equal(formatValue(false), "No");
  assert.equal(formatValue(null, "pct"), null);
  assert.equal(formatValue("D2", "drought"), "D2 · Severe");
  assert.equal(formatValue("ONCOR ELECTRIC DELIVERY COMPANY LLC", "title"), "Oncor Electric Delivery Company LLC");
  assert.equal(formatValue("private_or_unknown", "agency"), "Private or unknown");
  assert.equal(formatValue(800, "elev"), "800 m · 2,625 ft");
  assert.equal(distance(20000), "20 km · 12 mi");
  assert.equal(titleCase("ercot"), "ERCOT");
  assert.equal(missingNote({ status: "absent", notes: "no transmission line within 2000 m" }), "No transmission line within 2 km");
  assert.equal(missingNote({ status: "absent", notes: "no wetland within 500 m" }), "No wetland within 500 m");
  assert.equal(missingNote({ status: "absent" }), "Not mapped here");
  assert.equal(missingNote({ status: "error" }), "Source unavailable");
});

test("source links are https landing pages, never raw query endpoints", () => {
  for (const [id, [name, url]] of Object.entries(SOURCES)) {
    assert.ok(name, id);
    assert.match(url, /^https:\/\//, id);
    assert.doesNotMatch(url, /\/query\b|\.tif\b|\.zip\b/i, id);
  }
  assert.equal(sourceLink("NOPE", "https://x.example/FeatureServer/0/query").url, null);
  assert.equal(sourceLink("NOPE", "s3://bucket/x").url, null);
  assert.equal(sourceLink("NOPE", "https://example.gov/data").url, "https://example.gov/data");
});

test("index.html pre-renders the same presets as fields.js", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/class="preset" type="button" data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, PRESETS.map((p) => p.id));
});

test("the Check the Land link carries the point and the showcase UTM tags, and shows only for U.S. points", async () => {
  const { ctlUrl, showCtl } = await import("../public/partner.js");
  const u = new URL(ctlUrl(32.2, -101.45));
  assert.equal(u.origin + u.pathname, "https://checktheland.com/check/");
  assert.deepEqual(Object.fromEntries(u.searchParams), { lat: "32.20000", lng: "-101.45000", utm_source: "sitescout", utm_medium: "referral", utm_campaign: "showcase" });
  const us = { fields: { political_region: { status: "ok", value: "Texas" } } };
  assert.equal(showCtl("on", us), true);
  assert.equal(showCtl("off", us), false);
  assert.equal(showCtl(null, us), false);
  assert.equal(showCtl("on", { fields: { political_region: { status: "absent", value: null } } }), false);
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /<a id="ctl"[^>]*hidden>/);
});

test("the template ships with the partner link off", () => {
  const w = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(w, /"CHECK_THE_LAND_CTA": "off"/);
});
