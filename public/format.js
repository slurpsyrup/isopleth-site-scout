// Turns raw Isopleth values into short, readable strings for the panel.

const nf = (d) => new Intl.NumberFormat("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
const n0 = nf(0), n1 = nf(1), n2 = nf(2);

const DROUGHT = { D0: "D0 · Abnormally dry", D1: "D1 · Moderate", D2: "D2 · Severe", D3: "D3 · Extreme", D4: "D4 · Exceptional" };
const ACRONYMS = new Set(["LLC", "INC", "CO", "LP", "ERCOT", "PJM", "MISO", "SPP", "CAISO", "NYISO", "ISO", "USA", "US", "BLM", "USFS", "NPS", "FWS", "DOD", "BOR", "TVA", "II", "III", "IV"]);

export function titleCase(s) {
  return String(s).toLowerCase().replace(/[a-z0-9][^\s/-]*/g, (w) => {
    const up = w.toUpperCase();
    if (ACRONYMS.has(up.replace(/[^A-Z]/g, ""))) return up;
    return w[0].toUpperCase() + w.slice(1);
  });
}

export function distance(m) {
  if (m < 1000) return `${n0.format(m)} m`;
  const km = m / 1000;
  return `${(km < 10 ? n1 : n0).format(km)} km · ${(km < 16 ? n1 : n0).format(km * 0.621371)} mi`;
}

/**
 * @param {unknown} v raw value
 * @param {string|undefined} fmt formatter id from fields.js
 * @returns {string|null} null when there is no value to show
 */
export function formatValue(v, fmt) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean" || fmt === "bool") return v ? "Yes" : "No";
  if (typeof v === "number") {
    switch (fmt) {
      case "dist": return distance(v);
      case "kv": return `${n0.format(v)} kV`;
      case "mw": return `${n0.format(v)} MW`;
      case "pct": return `${n1.format(v)}%`;
      case "ms": return `${n1.format(v)} m/s`;
      case "ghi": return `${n2.format(v)} kWh/m²/day`;
      case "yield": return `${n0.format(v)} kWh/kWp/yr`;
      case "kwh": return `${n1.format(v * 100)}¢/kWh`;
      case "co2": return `${n0.format(v)} kg CO₂/MWh`;
      case "hours": return `${n0.format(v)} h/yr`;
      case "degc": return `${n1.format(v)} °C`;
      case "ft": return `${n1.format(v)} ft`;
      case "elev": return `${n0.format(v)} m · ${n0.format(v * 3.28084)} ft`;
      case "deg": return `${n1.format(v)}°`;
      case "freq": return v < 0.01 ? v.toPrecision(2) : n2.format(v);
      case "index": return n0.format(v);
      default: return Math.abs(v) >= 100 ? n0.format(v) : n2.format(v);
    }
  }
  const s = String(v);
  if (fmt === "drought") return DROUGHT[s] || (s.toLowerCase() === "none" ? "None" : s);
  if (fmt === "agency") return s === "private_or_unknown" ? "Private or unknown" : s.replace(/_/g, " ").toUpperCase();
  if (fmt === "title") return /^[A-Z0-9 .,&'-]+$/.test(s) || /^[a-z_ ]+$/.test(s) ? titleCase(s.replace(/_/g, " ")) : s;
  return s;
}

/** Short reason shown in place of a missing value, taken from Isopleth's per-field notes. */
export function missingNote(field) {
  const note = field && typeof field.notes === "string" ? field.notes : "";
  const m = note.match(/no ([a-z ]+) within ([\d,.]+) ?(m|km)\b/i);
  if (m) {
    const n = parseFloat(m[2].replace(/,/g, ""));
    const d = m[3] === "m" && n >= 1000 ? `${n / 1000} km` : `${m[2]} ${m[3]}`;
    return `No ${m[1]} within ${d}`;
  }
  if (field && field.status === "absent") return "Not mapped here";
  if (field && (field.status === "error" || field.status === "failed")) return "Source unavailable";
  return "No data";
}
