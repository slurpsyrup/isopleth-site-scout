// The exact Isopleth request Site Scout makes, and the same request as cURL, Python and Node.
import { FIELDS } from "./fields.js";

export const API_BASE = "https://api.isopleth.dev";
export const MAX_WAIT_S = 15;

/** Body for POST /v1/fetch. The Worker sends exactly this. */
export function fetchBody(lat, lng, fields = FIELDS) {
  return { lat, lng, fields, max_wait_s: MAX_WAIT_S };
}

function wrapFields(fields, indent, quote) {
  const lines = [];
  let line = "";
  for (const f of fields) {
    const item = `${quote}${f}${quote}, `;
    if ((line + item).length > 88) { lines.push(line.trimEnd()); line = ""; }
    line += item;
  }
  if (line) lines.push(line.replace(/,\s*$/, ""));
  return lines.map((l) => indent + l).join("\n");
}

/** @returns {{curl:string, python:string, node:string}} */
export function snippets(lat, lng, fields = FIELDS, base = API_BASE) {
  const body = fetchBody(lat, lng, fields);
  const pretty = `{
  "lat": ${lat},
  "lng": ${lng},
  "fields": [
${wrapFields(fields, "    ", '"')}
  ],
  "max_wait_s": ${body.max_wait_s}
}`;
  const curl = `curl -s ${base}/v1/fetch \\
  -H "Authorization: Bearer $ISOPLETH_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${pretty}'`;
  const python = `import os, requests

resp = requests.post(
    "${base}/v1/fetch",
    headers={"Authorization": f"Bearer {os.environ['ISOPLETH_KEY']}"},
    json={
        "lat": ${lat},
        "lng": ${lng},
        "fields": [
${wrapFields(fields, "            ", '"')}
        ],
        "max_wait_s": ${body.max_wait_s},
    },
    timeout=60,
)
resp.raise_for_status()
for name, f in resp.json()["fields"].items():
    print(name, f["value"], f["unit"] or "", f["source"])`;
  const node = `// Node 18+ (built-in fetch), ESM
const resp = await fetch("${base}/v1/fetch", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.ISOPLETH_KEY}\`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    lat: ${lat},
    lng: ${lng},
    fields: [
${wrapFields(fields, "      ", '"')}
    ],
    max_wait_s: ${body.max_wait_s},
  }),
});
if (!resp.ok) throw new Error(\`Isopleth \${resp.status}\`);
const { fields } = await resp.json();
console.log(fields.nfhl_flood_zone.value, fields.wind_capacity_factor_pct.value);`;
  return { curl, python, node };
}
