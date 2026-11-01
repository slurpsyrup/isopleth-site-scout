// Coordinate helpers shared by the browser and the Worker.

/** Isopleth's supported envelope (from GET /v1/meta/fields `us_envelope`): CONUS, Alaska, Hawaii, PR. */
export const ENVELOPE = { latMin: 18, latMax: 72, lngMin: -180, lngMax: -65 };

/** Round to 5 decimals (~1.1 m). Used for cache keys and shareable URLs. */
export function round5(n) {
  return Math.round(Number(n) * 1e5) / 1e5;
}

export function validLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function inEnvelope(lat, lng) {
  return lat >= ENVELOPE.latMin && lat <= ENVELOPE.latMax && lng >= ENVELOPE.lngMin && lng <= ENVELOPE.lngMax;
}

/**
 * Parse pasted coordinates: "32.2, -101.45", "32.2 -101.45", "32.2°N 101.45°W", "(32.2,-101.45)".
 * Returns {lat,lng} or null when the text does not look like a coordinate pair.
 */
export function parseCoords(text) {
  if (typeof text !== "string") return null;
  const t = text.trim().replace(/[()[\]]/g, "");
  const m = t.match(/^(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s;]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lng = parseFloat(m[3]);
  if (m[2] && m[2].toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4] && m[4].toUpperCase() === "W") lng = -Math.abs(lng);
  // A US user who types "32.2, 101.45" almost always means west longitude.
  if (!m[4] && lng > 0 && inEnvelope(lat, -lng) && !inEnvelope(lat, lng)) lng = -lng;
  if (!validLatLng(lat, lng)) return null;
  return { lat: round5(lat), lng: round5(lng) };
}

/** Shareable-URL value: "32.20000,-101.45000". */
export function formatAt(lat, lng) {
  return `${round5(lat).toFixed(5)},${round5(lng).toFixed(5)}`;
}

/** Parse the `at` query value back. */
export function parseAt(v) {
  if (!v) return null;
  const [a, b] = String(v).split(",");
  const lat = parseFloat(a);
  const lng = parseFloat(b);
  return validLatLng(lat, lng) ? { lat: round5(lat), lng: round5(lng) } : null;
}
