// Which Isopleth fields Site Scout asks for, and how the panel groups and formats them.
// Edit this file to customize the app: add or remove fields (see https://isopleth.dev/docs/ for all 351 API fields),
// rename labels, or regroup cards. The Worker reads the same list, so the request and the UI never drift.
// One lookup covers up to 50 fields, so keep FIELDS.length <= 50 to spend one lookup per point.

/** @typedef {{name:string,label:string,fmt?:string,unit?:string}} FieldSpec */
/** @typedef {{id:string,title:string,icon:string,fields:FieldSpec[]}} Group */

/** @type {Group[]} */
export const GROUPS = [
  { id: "grid", title: "Grid & interconnection", icon: "bolt", fields: [
    { name: "nearest_substation_distance_m", label: "Nearest substation", fmt: "dist" },
    { name: "nearest_substation_max_voltage_kv", label: "Substation voltage", fmt: "kv" },
    { name: "nearest_transmission_line_distance_m", label: "Nearest transmission line", fmt: "dist" },
    { name: "nearest_transmission_line_voltage_kv", label: "Line voltage", fmt: "kv" },
    { name: "iso_rto", label: "Grid operator (ISO/RTO)" },
    { name: "electric_utility_service_territory", label: "Utility territory", fmt: "title" },
    { name: "interconnection_queue_active_capacity_county_mw", label: "County interconnection queue", fmt: "mw" },
    { name: "nearest_power_plant_name", label: "Nearest power plant", fmt: "title" },
    { name: "nearest_power_plant_primary_fuel", label: "Its fuel", fmt: "title" },
    { name: "nearest_power_plant_capacity_mw", label: "Its capacity", fmt: "mw" },
    { name: "nearest_gas_pipeline_distance_m", label: "Nearest gas pipeline", fmt: "dist" },
  ] },
  { id: "wind", title: "Wind resource", icon: "wind", fields: [
    { name: "wind_capacity_factor_pct", label: "Wind capacity factor", fmt: "pct" },
    { name: "mean_wind_speed_100m_ms", label: "Mean wind at 100 m", fmt: "ms" },
    { name: "prevailing_wind_direction_100m_cardinal", label: "Prevailing wind from" },
  ] },
  { id: "solar", title: "Solar resource", icon: "sun", fields: [
    { name: "ghi_annual_kwh_m2_day", label: "Sunlight (GHI)", fmt: "ghi" },
    { name: "pv_capacity_factor_pct", label: "Solar PV capacity factor", fmt: "pct" },
    { name: "pv_specific_yield_kwh_per_kw", label: "PV yield", fmt: "yield" },
  ] },
  { id: "dc", title: "Data center fit", icon: "server", fields: [
    { name: "avg_retail_electricity_price_industrial_usd_per_kwh", label: "Industrial power price", fmt: "kwh" },
    { name: "egrid_co2_output_rate_kg_per_mwh", label: "Grid CO₂ intensity", fmt: "co2" },
    { name: "free_cooling_hours_per_year_15c", label: "Free-cooling hours (≤15 °C)", fmt: "hours" },
    { name: "design_wet_bulb_temperature_0_4pct_degc", label: "Design wet-bulb (0.4%)", fmt: "degc" },
  ] },
  { id: "flood", title: "Flood & water", icon: "water", fields: [
    { name: "nfhl_flood_zone", label: "FEMA flood zone" },
    { name: "within_floodplain_polygon", label: "In 100-year floodplain", fmt: "bool" },
    { name: "fema_base_flood_elevation", label: "Base flood elevation", fmt: "ft" },
    { name: "intersects_wetland", label: "On a mapped wetland", fmt: "bool" },
    { name: "nearest_wetland_distance_m", label: "Nearest wetland", fmt: "dist" },
    { name: "wetland_type", label: "Nearest wetland type" },
    { name: "nearest_flowline_name", label: "Nearest named stream" },
  ] },
  { id: "terrain", title: "Terrain", icon: "mountain", fields: [
    { name: "elevation", label: "Elevation", fmt: "elev" },
    { name: "slope_degrees", label: "Slope", fmt: "deg" },
    { name: "aspect_cardinal", label: "Faces" },
    { name: "grading_difficulty_class", label: "Grading difficulty", fmt: "title" },
  ] },
  { id: "soil", title: "Soil & land", icon: "leaf", fields: [
    { name: "prime_farmland_classification", label: "Farmland class", fmt: "title" },
    { name: "soil_map_unit_name", label: "Soil" },
    { name: "soil_drainage_class", label: "Drainage" },
    { name: "soil_shrink_swell_class", label: "Shrink-swell" },
    { name: "cdl_class", label: "Cropland Data Layer" },
    { name: "land_use_class", label: "Land use" },
    { name: "surface_management_agency", label: "Land manager", fmt: "agency" },
    { name: "intersects_protected_area", label: "In a protected area", fmt: "bool" },
  ] },
  { id: "hazard", title: "Hazards", icon: "flame", fields: [
    { name: "wildfire_annual_frequency", label: "Wildfire events / yr (tract)", fmt: "freq" },
    { name: "tornado_annual_frequency", label: "Tornado events / yr (tract)", fmt: "freq" },
    { name: "drought_category", label: "Drought now", fmt: "drought" },
    { name: "seismic_design_category", label: "Seismic design category" },
    { name: "landslide_susceptibility_index", label: "Landslide susceptibility", fmt: "index" },
  ] },
  { id: "access", title: "Access", icon: "road", fields: [
    { name: "nearest_major_road_name", label: "Nearest major road" },
    { name: "nearest_major_road_distance_m", label: "Distance to it", fmt: "dist" },
  ] },
];

/** Location context shown in the panel header, not in a card. */
export const CONTEXT_FIELDS = ["political_county", "political_region", "political_locality"];

/** Every field the Worker requests, in a stable order (part of the cache key). */
export const FIELDS = [...CONTEXT_FIELDS, ...GROUPS.flatMap((g) => g.fields.map((f) => f.name))];

/** Big numbers at the top of the panel. */
export const HEADLINES = [
  { name: "wind_capacity_factor_pct", label: "Wind CF", fmt: "pct" },
  { name: "pv_capacity_factor_pct", label: "Solar CF", fmt: "pct" },
  { name: "nearest_substation_distance_m", label: "To substation", fmt: "dist" },
  { name: "nfhl_flood_zone", label: "Flood zone" },
];

/** "Try these" starting points. */
export const PRESETS = [
  { id: "wtx-wind", label: "West Texas wind", sub: "Howard County, TX", lat: 32.2, lng: -101.45, zoom: 11 },
  { id: "nv-solar", label: "Nevada solar", sub: "Dry Lake Valley, NV", lat: 36.45, lng: -114.92, zoom: 11 },
  { id: "va-dc", label: "Virginia data center alley", sub: "Ashburn, VA", lat: 39.0293, lng: -77.4588, zoom: 13 },
  { id: "ia-farm", label: "Iowa farmland", sub: "Story County, IA", lat: 42.1, lng: -93.55, zoom: 12 },
];
