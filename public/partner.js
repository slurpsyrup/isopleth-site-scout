// Optional partner link under the headline facts: "Buying this land? Get the full buyer's report" on Check the Land,
// a land report built on the Isopleth API. It opens checktheland.com/check/ with the selected point filled in.
//
// Off by default. The Worker turns it on per deploy with the CHECK_THE_LAND_CTA var ("on" or "off", in
// wrangler.jsonc): when it is "on", successful /api/point responses carry `x-scout-ctl: on` and the panel shows the
// link. Forks: leave the var "off" (the default), or delete this file, the import in app.js and the #ctl element.
export const CHECK_THE_LAND = {
  kicker: "Buying this land?",
  text: "Get the full buyer's report, $29",
  url: "https://checktheland.com/check/",
  utm: { utm_source: "sitescout", utm_medium: "referral", utm_campaign: "showcase" },
};

/** The link for one point: /check/?lat=..&lng=..&utm_*. Check the Land prefills the point and runs its free check. */
export function ctlUrl(lat, lng) {
  const q = new URLSearchParams({ lat: lat.toFixed(5), lng: lng.toFixed(5), ...CHECK_THE_LAND.utm });
  return `${CHECK_THE_LAND.url}?${q}`;
}

/** Show it only when the deploy enabled it and the point is inside a U.S. state or territory. */
export function showCtl(header, body) {
  const region = body && body.fields && body.fields.political_region;
  return header === "on" && !!region && region.status === "ok";
}
