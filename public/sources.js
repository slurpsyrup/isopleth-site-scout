// Human-readable landing page for each Isopleth source id. Isopleth's per-field source_url is often a raw
// service query, an s3:// path or a large file, which is right for provenance but not for a "view source" link,
// so the panel links here and falls back to the field's https source_url for ids not listed.
export const SOURCES = {
  BLM_SMA: ["BLM Surface Management Agency", "https://gbp-blm-egis.hub.arcgis.com/datasets/blm-egis::blm-natl-sma-surface-management-agency-area-polygons/about"],
  CENSUS_GEOCODING: ["U.S. Census Geocoder", "https://geocoding.geo.census.gov/geocoder/"],
  CENSUS_TIGERWEB: ["Census TIGERweb", "https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_main.html"],
  EIA_ATLAS: ["EIA U.S. Energy Atlas", "https://atlas.eia.gov/"],
  EIA_POWER: ["EIA U.S. Energy Atlas", "https://atlas.eia.gov/"],
  EIA_ELEC_SALES_REVENUE_PRICE: ["EIA Electricity Data", "https://www.eia.gov/electricity/data.php"],
  EPA_EGRID: ["EPA eGRID", "https://www.epa.gov/egrid"],
  FEMA_NFHL: ["FEMA National Flood Hazard Layer", "https://www.fema.gov/flood-maps/national-flood-hazard-layer"],
  FEMA_NRI: ["FEMA National Risk Index", "https://www.fema.gov/flood-maps/products-tools/national-risk-index"],
  HIFLD_ISO_RTO: ["HIFLD Open Data", "https://hifld-geoplatform.hub.arcgis.com/"],
  ISOPLETH_DERIVED_SITING: ["Isopleth derived fields", "https://isopleth.dev/docs/"],
  JRC_PVGIS_NSRDB: ["NSRDB (National Solar Radiation Database)", "https://nsrdb.nlr.gov/"],
  NREL_NSRDB_GOES_TMY_V4: ["NSRDB (National Solar Radiation Database)", "https://nsrdb.nlr.gov/"],
  NREL_SOLAR_RESOURCE_V1: ["NSRDB (National Solar Radiation Database)", "https://nsrdb.nlr.gov/"],
  NREL_PVWATTS_V8: ["PVWatts", "https://pvwatts.nlr.gov/"],
  LBNL_QUEUED_UP: ["Berkeley Lab, Queued Up", "https://emp.lbl.gov/queues"],
  NREL_REV_LANDBASED_WIND_SC_2024: ["NREL reV wind supply curves (OEDI)", "https://data.openei.org/submissions/8314"],
  NREL_WIND_TOOLKIT: ["WIND Toolkit", "https://www.nlr.gov/grid/wind-toolkit"],
  OVERTURE_TRANSPORTATION: ["Overture Maps, transportation", "https://docs.overturemaps.org/guides/transportation/"],
  PAD_US: ["USGS PAD-US", "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview"],
  USDA_CDL: ["USDA Cropland Data Layer", "https://www.nass.usda.gov/Research_and_Science/Cropland/SARS1a.php"],
  USDA_SSURGO: ["USDA Web Soil Survey (SSURGO)", "https://websoilsurvey.nrcs.usda.gov/app/"],
  USDM_CURRENT: ["U.S. Drought Monitor", "https://droughtmonitor.unl.edu/"],
  USFS_LCMS: ["USFS Landscape Change Monitoring System", "https://data.fs.usda.gov/geodata/rastergateway/LCMS/"],
  USFWS_NWI: ["USFWS National Wetlands Inventory", "https://www.fws.gov/program/national-wetlands-inventory"],
  USGS_3DEP: ["USGS 3D Elevation Program", "https://www.usgs.gov/3d-elevation-program"],
  USGS_3DEP_COG: ["USGS 3D Elevation Program", "https://www.usgs.gov/3d-elevation-program"],
  USGS_DESIGNMAPS_ASCE7: ["USGS Seismic Design Maps", "https://www.usgs.gov/programs/earthquake-hazards/design-ground-motions-portal"],
  USGS_LANDSLIDE_SUSCEPTIBILITY: ["USGS landslide susceptibility", "https://www.sciencebase.gov/catalog/item/644af897d34e45f6ddcd13b3"],
  USGS_NHDPLUS_HR: ["USGS NHDPlus High Resolution", "https://www.usgs.gov/national-hydrography/nhdplus-high-resolution"],
  USGS_NHDPLUS_V2: ["EPA/USGS NHDPlus V2", "https://www.epa.gov/waterdata/nhdplus-national-hydrography-dataset-plus"],
};

/** @returns {{name:string,url:string|null}} */
export function sourceLink(id, fallbackUrl) {
  const s = SOURCES[id];
  if (s) return { name: s[0], url: s[1] };
  const ok = typeof fallbackUrl === "string" && /^https:\/\//.test(fallbackUrl) && !/\/query\b|\.(tif|zip|h5)\b|post\.rest/i.test(fallbackUrl);
  return { name: String(id || "Source").replace(/_/g, " "), url: ok ? fallbackUrl : null };
}
