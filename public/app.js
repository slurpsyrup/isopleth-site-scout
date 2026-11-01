// Site Scout front end. Plain ES modules, no build step. Leaflet is loaded as a global from /vendor.
import { GROUPS, HEADLINES, PRESETS } from "./fields.js";
import { CHECK_THE_LAND, ctlUrl, showCtl } from "./partner.js";
import { formatValue, missingNote } from "./format.js";
import { sourceLink } from "./sources.js";
import { parseCoords, formatAt, parseAt, round5, inEnvelope } from "./coords.js";
import { snippets } from "./request.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mobile = matchMedia("(max-width:760px)");
const track = (name, data) => { try { window.umami && window.umami.track(name, data); } catch { /* analytics must never break the app */ } };

const ICONS = {
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  server: '<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M8 6.5h.01M8 17.5h.01"/>',
  water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  mountain: '<path d="m3 20 6-11 4 7 2-3 6 7z"/>',
  leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1 1.5 2 1.5 3 1.5-2 1.5-5 1.5-8z"/>',
  road: '<path d="M9 3 5 21M15 3l4 18M12 5v2M12 11v2M12 17v2"/>',
};
const PRESET_ICON = { "wtx-wind": "wind", "nv-solar": "sun", "va-dc": "server", "ia-farm": "leaf" };
const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ""}</svg>`;
const DATASETS = ["Reading FEMA flood maps", "Querying USDA soil surveys", "Sampling USGS 3DEP elevation", "Pulling NREL wind and solar", "Measuring HIFLD substations", "Checking NWI wetlands", "Reading the U.S. Drought Monitor", "Checking wildfire and tornado risk", "Looking up EIA power plants"];

const state = { lat: null, lng: null, data: null, ctl: null, tab: "curl", apiOpen: false, timer: null, sel: 0 };

/* ---------- Map ---------- */
const USGS = "https://basemap.nationalmap.gov/arcgis/rest/services";
const ATTR = 'Basemap <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" rel="noopener">USGS The National Map</a> · Data <a href="https://isopleth.dev/?utm_source=sitescout&amp;utm_medium=referral&amp;utm_campaign=showcase" rel="noopener">Isopleth</a>';
let map, pin, ring, ringLabel;
const layers = {};

function initMap() {
  const L = window.L;
  map = L.map("map", { zoomControl: false, attributionControl: false, worldCopyJump: true, minZoom: mobile.matches ? 2 : 3, maxZoom: 18, zoomSnap: 0.5 });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.control.attribution({ position: "bottomright", prefix: false }).addAttribution(ATTR).addTo(map);
  layers.topo = L.tileLayer(`${USGS}/USGSTopo/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 18, className: "topo-dark", crossOrigin: true });
  layers.imagery = L.tileLayer(`${USGS}/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 16, maxZoom: 18, className: "imagery-dim", crossOrigin: true });
  layers.topo.addTo(map);
  map.on("click", (e) => select(e.latlng.lat, e.latlng.lng, { via: "map" }));
  map.on("moveend", () => state.lat !== null && writeUrl());
}

function setLayer(name) {
  for (const [k, l] of Object.entries(layers)) (k === name ? l.addTo(map) : l.remove());
  document.querySelectorAll("#layers button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layer === name)));
}

function placePin(lat, lng) {
  const L = window.L;
  if (!pin) pin = L.marker([lat, lng], { icon: L.divIcon({ className: "", html: '<div class="pin"></div>', iconSize: [0, 0] }), keyboard: false, interactive: false }).addTo(map);
  else pin.setLatLng([lat, lng]);
  clearRing();
}

function clearRing() {
  if (ring) { ring.remove(); ring = null; }
  if (ringLabel) { ringLabel.remove(); ringLabel = null; }
}

function drawRing(lat, lng, m) {
  const L = window.L;
  clearRing();
  if (!(m > 0) || m > 80000) return;
  ring = L.circle([lat, lng], { radius: m, color: "#ffb84d", weight: 1.5, dashArray: "5 6", fill: false, interactive: false }).addTo(map);
  const north = L.latLng(lat + m / 111320, lng);
  ringLabel = L.marker(north, { icon: L.divIcon({ className: "ringlbl", html: "nearest substation", iconSize: [120, 14], iconAnchor: [60, 18] }), interactive: false, keyboard: false }).addTo(map);
}

/** Center the point in the part of the map the panel does not cover. */
function focus(lat, lng, zoom) {
  const z = Math.max(zoom || map.getZoom(), 5);
  const size = map.getSize();
  const panel = $("panel").getBoundingClientRect();
  let dx = 0, dy = 0;
  if (mobile.matches) dy = Math.min(panel.height, size.y * 0.6) / 2 - 20;
  else dx = -panel.right / 2;
  const p = map.project([lat, lng], z).add([dx, dy]);
  map.setView(map.unproject(p, z), z, { animate: true });
}

/* ---------- URL ---------- */
function writeUrl() {
  // Built by hand so the comma stays readable: ?at=32.20000,-101.45000&z=11
  const q = state.lat === null ? "" : `?at=${formatAt(state.lat, state.lng)}&z=${Math.round(map.getZoom())}`;
  history.replaceState(null, "", location.pathname + q);
}

/* ---------- Panel views ---------- */
function show(view) {
  for (const v of ["intro", "loading", "result", "error"]) $(v).hidden = v !== view;
  $("panel").dataset.state = view;
  if (mobile.matches) setSheet(view === "intro" ? "auto" : view === "result" ? "half" : "half");
  $("scroll").scrollTop = 0;
}

function setSheet(size) {
  const p = $("panel");
  if (size === "auto") delete p.dataset.size; else p.dataset.size = size;
  $("grip").setAttribute("aria-expanded", String(size === "full"));
}

function renderPresets() {
  const want = PRESETS.map((p) => p.id).join();
  const have = [...$("presets").querySelectorAll(".preset")].map((b) => b.dataset.id).join();
  if (want !== have) $("presets").innerHTML = PRESETS.map((p) => `<button class="preset" type="button" data-id="${p.id}"><span class="ic">${svg(PRESET_ICON[p.id])}</span><span><b>${esc(p.label)}</b><small>${esc(p.sub)}</small></span><span class="arr" aria-hidden="true">→</span></button>`).join("");
  $("presets").addEventListener("click", (e) => {
    const b = e.target.closest(".preset");
    if (!b) return;
    const p = PRESETS.find((x) => x.id === b.dataset.id);
    track("preset_click", { preset: p.id });
    select(p.lat, p.lng, { via: "preset", zoom: p.zoom, label: p.sub });
  });
}

function startLoading(lat, lng) {
  show("loading");
  $("lcoord").textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  const t0 = performance.now();
  let i = 0;
  clearInterval(state.timer);
  $("lsrc").textContent = DATASETS[0];
  state.timer = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    $("ltime").textContent = `${s.toFixed(1)} s`;
    const j = Math.floor(s / 1.6) % DATASETS.length;
    if (j !== i) { i = j; $("lsrc").textContent = DATASETS[j]; }
  }, 100);
}

function stopLoading() { clearInterval(state.timer); }

function showError(title, msg, wait) {
  stopLoading();
  show("error");
  $("etitle").textContent = title;
  $("emsg").textContent = msg;
  $("ewait").textContent = wait || "";
}

/* ---------- Lookup ---------- */
async function select(lat0, lng0, opts = {}) {
  const lat = round5(lat0);
  let lng = round5(lng0);
  if (lng < -180) lng += 360; else if (lng > 180) lng -= 360;
  const seq = ++state.sel;
  state.lat = lat; state.lng = lng; state.data = null;
  placePin(lat, lng);
  focus(lat, lng, opts.zoom || (opts.via === "map" ? map.getZoom() : 12));
  writeUrl();
  if (!inEnvelope(lat, lng)) {
    return showError("Outside the U.S.", "Site Scout covers the United States. Pick a point on U.S. land, or try one of the presets.");
  }
  if (state.ctl) state.ctl.abort();
  const ctl = (state.ctl = new AbortController());
  startLoading(lat, lng);
  let r, body;
  try {
    r = await fetch(`/api/point?lat=${lat}&lng=${lng}`, { signal: ctl.signal });
    body = await r.json().catch(() => null);
  } catch (e) {
    if (e.name === "AbortError" || seq !== state.sel) return;
    return showError("Connection problem", "We couldn't reach Site Scout. Check your connection and try again.");
  }
  if (seq !== state.sel) return;
  stopLoading();
  const cache = r.headers.get("x-scout-cache") || "";
  track("point_query", { via: opts.via || "map", cache: cache || "none", status: r.status });
  if (!r.ok || !body || !body.fields) {
    const e = (body && body.error) || {};
    const titles = { outside_us: "Outside the U.S.", rate_limited: "Slow down a moment", demo_capacity: "Demo at capacity", busy: "Sources are busy", timeout: "That took too long" };
    const wait = e.retry_after_s ? `Try again in about ${e.retry_after_s} seconds. Points someone already looked up still load instantly, so the presets keep working.` : "";
    return showError(titles[e.code] || "Something went wrong", e.message || "Isopleth could not answer for this point.", wait);
  }
  state.data = body;
  renderResult(body, cache, opts.label);
  renderCtl(showCtl(r.headers.get("x-scout-ctl"), body));
}

/* ---------- Result ---------- */
function v(body, name) { return body.fields[name] || null; }

function placeName(body, fallback) {
  const val = (n) => (v(body, n) && v(body, n).status === "ok" ? v(body, n).value : null);
  const county = val("political_county"), region = val("political_region");
  let town = val("political_locality");
  if (town && /unincorporated/i.test(town)) town = null;
  if (town && region) return { title: `${town}, ${region}`, sub: county };
  if (county || region) return { title: [county, region].filter(Boolean).join(", "), sub: null };
  return { title: fallback || "Selected point", sub: null };
}

// Plain-English gloss for FEMA zone codes in the headline tile.
function floodNote(z) {
  if (/^(X|C|B)/i.test(z)) return /0\.2|SHADED/i.test(z) ? "Moderate risk" : "Minimal risk";
  if (/^V/i.test(z)) return "Coastal high risk";
  if (/^A/i.test(z)) return "High risk (1% annual)";
  if (/^D/i.test(z)) return "Undetermined";
  return "";
}

function headlineClass(name, value) {
  if (typeof value === "number") {
    if (name === "wind_capacity_factor_pct") return value >= 35 ? "good" : value >= 25 ? "warn" : "bad";
    if (name === "pv_capacity_factor_pct") return value >= 20 ? "good" : value >= 16 ? "warn" : "bad";
    if (name === "nearest_substation_distance_m") return value <= 5000 ? "good" : value <= 16000 ? "warn" : "bad";
  }
  if (name === "nfhl_flood_zone" && typeof value === "string") return /^(X|C|B)/i.test(value) ? "good" : /^(A|V)/i.test(value) ? "bad" : "warn";
  return "";
}

function srcHtml(f) {
  const s = sourceLink(f.source, f.source_url);
  const name = esc(f.attribution || s.name);
  return `<span class="src">Source: ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${name}</a>` : name}</span>`;
}

function renderCtl(on) {
  const a = $("ctl");
  if (!a) return;
  a.hidden = !on;
  if (!on) return;
  $("ctl-k").textContent = CHECK_THE_LAND.kicker;
  $("ctl-t").textContent = CHECK_THE_LAND.text;
  a.href = ctlUrl(state.lat, state.lng);
}

function renderResult(body, cache, label) {
  show("result");
  const place = placeName(body, label);
  $("place").textContent = place.title;
  $("coord").textContent = `${place.sub ? `${place.sub} · ` : ""}${state.lat.toFixed(5)}, ${state.lng.toFixed(5)}`;
  $("cache").textContent = cache === "miss" ? "live · 1 lookup" : cache ? "cached" : "";

  $("headlines").innerHTML = HEADLINES.map((h) => {
    const f = v(body, h.name);
    const val = f && f.status === "ok" ? formatValue(f.value, h.fmt) : null;
    const main = val ? (h.fmt === "dist" ? val.split(" · ")[0] : val) : "—";
    let sub = val && h.fmt === "dist" && val.includes(" · ") ? val.split(" · ")[1] : f && f.status === "ok" && h.name === "nearest_substation_distance_m" ? "" : f ? (val ? "" : missingNote(f)) : "";
    if (val && h.name === "nfhl_flood_zone") sub = floodNote(String(f.value));
    return `<div class="hl ${val ? headlineClass(h.name, f.value) : ""}"><small>${esc(h.label)}</small><b>${esc(main)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>`;
  }).join("");

  $("cards").innerHTML = GROUPS.map((g) => {
    let have = 0, lastNote = "";
    const rows = g.fields.map((spec) => {
      const f = v(body, spec.name);
      if (!f) return "";
      const val = f.status === "ok" ? formatValue(f.value, spec.fmt) : null;
      if (val) { have++; return `<div class="row"><span class="l">${esc(spec.label)}</span><span class="v">${esc(val)}</span>${srcHtml(f)}</div>`; }
      const note = missingNote(f);
      const failed = f.status === "error" || f.status === "failed";
      const short = failed ? "Unavailable" : /within/i.test(note) ? "None nearby" : "—";
      const showNote = note !== lastNote && short !== "Unavailable";
      lastNote = note;
      return `<div class="row"><span class="l">${esc(spec.label)}</span><span class="v ${failed ? "err" : "absent"}">${esc(short)}</span>${showNote && short !== "—" ? `<span class="note">${esc(note)}</span>` : ""}${srcHtml(f)}</div>`;
    }).join("");
    return `<section class="card" data-g="${esc(g.id)}"><h2><i></i>${esc(g.title)}<span>${have}/${g.fields.length}</span></h2>${rows}</section>`;
  }).join("");

  const n = Object.keys(body.fields).length;
  const sources = new Set(Object.values(body.fields).map((f) => f.source)).size;
  const when = body.fetched_at ? new Date(body.fetched_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  $("foot").innerHTML = `${n} fields from ${sources} public sources in one call${when ? `, fetched ${esc(when)}` : ""}. Data is for screening, not a survey or a flood determination. <a href="https://isopleth.dev/docs/?utm_source=sitescout&amp;utm_medium=referral&amp;utm_campaign=showcase" rel="noopener">API docs</a>`;

  const sub = v(body, "nearest_substation_distance_m");
  if (sub && sub.status === "ok") drawRing(state.lat, state.lng, sub.value);
  renderApi();
}

/* ---------- API view ---------- */
function highlightJson(s) {
  return esc(s).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b|\b(true|false|null)\b/gi, (m, str, colon, num, lit) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (num) return `<span class="n">${num}</span>`;
    return `<span class="c">${lit}</span>`;
  });
}

function apiText(tab) {
  if (tab === "json") return state.data ? JSON.stringify(state.data, null, 2) : "// The response appears here after a lookup.";
  return snippets(state.lat ?? 32.2, state.lng ?? -101.45)[tab];
}

function renderApi() {
  if (!state.apiOpen) return;
  const t = apiText(state.tab);
  $("code").firstChild.innerHTML = state.tab === "json" ? highlightJson(t) : esc(t);
  document.querySelectorAll(".tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
}

/* ---------- Search ---------- */
async function search(q) {
  q = q.trim();
  if (!q) return;
  const c = parseCoords(q);
  if (c) return select(c.lat, c.lng, { via: "coords", zoom: 13 });
  showToast("Searching…");
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    const d = await r.json().catch(() => null);
    if (!r.ok || !d || !Number.isFinite(d.lat)) return showToast((d && d.error && d.error.message) || "No match for that address.", 4500);
    hideToast();
    $("q").blur();
    select(d.lat, d.lng, { via: "address", zoom: 15 });
  } catch {
    showToast("Address search is unavailable. Paste coordinates or tap the map.", 4500);
  }
}

let toastT;
function showToast(msg, ms = 0) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastT);
  if (ms) toastT = setTimeout(hideToast, ms);
}
function hideToast() { $("toast").classList.remove("on"); }

/* ---------- Wire up ---------- */
function reset() {
  if (state.ctl) state.ctl.abort();
  state.sel++;
  stopLoading();
  state.lat = state.lng = null; state.data = null;
  if (pin) { pin.remove(); pin = null; }
  clearRing();
  writeUrl();
  show("intro");
}

function init() {
  initMap();
  renderPresets();
  $("search").addEventListener("submit", (e) => { e.preventDefault(); search($("q").value); });
  $("close").addEventListener("click", reset);
  $("eback").addEventListener("click", reset);
  $("share").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); showToast("Link copied", 1800); } catch { showToast(location.href, 4000); }
  });
  $("apitoggle").addEventListener("click", () => {
    state.apiOpen = !state.apiOpen;
    $("apitoggle").setAttribute("aria-checked", String(state.apiOpen));
    $("api").hidden = !state.apiOpen;
    if (state.apiOpen) { renderApi(); track("api_view_toggle", { open: true }); }
  });
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[role=tab]");
    if (!b) return;
    state.tab = b.dataset.tab;
    renderApi();
  });
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(apiText(state.tab)); $("copy").textContent = "Copied"; setTimeout(() => ($("copy").textContent = "Copy"), 1500); } catch { /* clipboard blocked */ }
  });
  $("layers").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setLayer(b.dataset.layer); });
  $("grip").addEventListener("click", () => {
    const p = $("panel");
    if (p.dataset.state === "intro") return;
    setSheet(p.dataset.size === "full" ? "peek" : p.dataset.size === "peek" ? "half" : "full");
  });
  $("signup").addEventListener("click", () => track("signup_click", { from: "header" }));
  $("fork").addEventListener("click", () => track("fork_click", { from: "header" }));
  $("ctl")?.addEventListener("click", () => track("ctl_click", { from: "panel" }));

  const u = new URL(location.href);
  const at = parseAt(u.searchParams.get("at"));
  const z = Math.min(18, Math.max(3, parseInt(u.searchParams.get("z"), 10) || 12));
  if (at) {
    map.setView([at.lat, at.lng], z);
    select(at.lat, at.lng, { via: "link", zoom: z });
  } else {
    const ph = Math.round($("panel").getBoundingClientRect().height);
    map.fitBounds([[24.5, -125], [49.5, -66.5]], { paddingTopLeft: mobile.matches ? [8, 70] : [470, 70], paddingBottomRight: mobile.matches ? [8, Math.min(ph, innerHeight - 160)] : [20, 20] });
  }
}

if (window.L) init(); else window.addEventListener("load", init, { once: true });
