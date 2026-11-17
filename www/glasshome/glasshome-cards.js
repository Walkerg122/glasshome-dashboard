/*
 * Glass Home: a dark "glass" dashboard for Home Assistant.
 * https://github.com/<your-account>/glasshome-dashboard (MIT licence)
 *
 * One Lovelace resource (this file) holds every card. Your own settings live in the dashboard, in a
 * glasshome: section (see config/glasshome-config.example.yaml). Dashboards refer to those settings with
 * [[tokens]] such as entity: "[[weather.entity]]"; a card whose settings are missing shows a setup
 * placeholder instead of an error, and a card for a feature that is switched off is left out.
 * Nothing here stores or needs a token or password: every call uses the signed-in user's own
 * Home Assistant connection.
 */

// ================================================================== configuration
// Your settings live in the dashboard itself, as a top-level `glasshome:` section (in YAML mode usually
// `glasshome: !include config.yaml`). They are read over the signed-in user's own Home Assistant
// connection (websocket lovelace/config), so nothing about your home is served as a public file from
// /config/www. glasshome-news.js uses the same loader; whichever module loads first starts it.
const GH_URL = import.meta.url;
const GH_ASSETS = new URL(".", GH_URL).href;
const ghDashPath = () => location.pathname.split("/")[1] || "lovelace";
window.GlassHomeLoadConfig = window.GlassHomeLoadConfig || (async (path) => {
  let hass = null;
  for (let t = 0; t < 300 && !hass; t++) {
    const el = document.querySelector("home-assistant");
    if (el && el.hass && el.hass.connection) hass = el.hass;
    else await new Promise((r) => setTimeout(r, 100));
  }
  if (!hass) return { cfg: {}, src: null, path };
  try {
    const lv = await hass.connection.sendMessagePromise({ type: "lovelace/config", url_path: path === "lovelace" ? null : path, force: true }); // force: re-read a YAML dashboard from disk so edits to its included config.yaml apply on reload
    const g = lv && lv.glasshome;
    if (g && typeof g === "object" && !Array.isArray(g)) return { cfg: g, src: "dashboard", path };
  } catch (e) { /* not a dashboard (e.g. a settings page) or no access */ }
  return { cfg: {}, src: null, path };
});
window.GlassHomeConfigReady = window.GlassHomeConfigReady || window.GlassHomeLoadConfig(ghDashPath());
const GH_LOADED = await window.GlassHomeConfigReady;
// demo: true fills in a fictional home (see "demo mode" below); your own sections still win
// "Explore the demo" on the welcome screen shows the demo in this browser tab only (sessionStorage),
// whatever the settings say; it never changes the saved settings.
const GH_EXPLORE_KEY = `glasshome.explore.${GH_LOADED.path}`;
const ghExploring = (() => { try { return sessionStorage.getItem(GH_EXPLORE_KEY) === "1"; } catch (e) { return false; } })();
const GH_DEMO = GH_LOADED.cfg.demo === true || ghExploring;
let GH_CFG = GH_LOADED.cfg;
const GH_CFG_SRC = GH_LOADED.src;
const GH_CFG_FOUND = GH_CFG_SRC === "dashboard";
if (!GH_CFG_FOUND) console.info("Glass Home: this dashboard has no glasshome: section yet, so cards show setup placeholders. See docs/configuration.md.");
window.GlassHomeConfig = GH_CFG;

// Resources are shared by every dashboard. If this page was first opened on another dashboard and the
// user then moved to a Glass Home one without reloading, the settings in memory belong to the wrong
// dashboard: check once per dashboard and reload when they differ.
const GH_CHECKED = new Set([GH_LOADED.path]);
function ghCheckDashboard() {
  const path = ghDashPath();
  if (GH_CHECKED.has(path)) return;
  GH_CHECKED.add(path);
  window.GlassHomeLoadConfig(path).then((r) => {
    const key = `glasshome.reloaded.${path}`;
    if (JSON.stringify(r.cfg) === JSON.stringify(GH_LOADED.cfg)) return;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch (e) { return; }
    location.reload();
  });
}


// ================================================================== setup model (pure functions)
// Everything the setup wizard and the Settings page decide is worked out here, without the page:
// what kind of device an entity is, which rooms and devices this Home Assistant has, how a wizard
// draft becomes the dashboard's glasshome: settings (and back), and the built-in Open-Meteo weather.
// tests/js/setup-model.test.mjs runs these functions on their own (between the MODEL markers).
// @@MODEL-START
const GHS_VERSION = 1;
const GHS_STEPS = ["welcome", "profile", "weather", "connect", "rooms", "devices", "personalise", "features", "done"];
const GHS_ROOM_SUGGESTIONS = [
  ["Living Room", "mdi:sofa-outline"], ["Kitchen", "mdi:silverware-fork-knife"], ["Bedroom", "mdi:bed-outline"], ["Bathroom", "mdi:shower"],
  ["Dining Room", "mdi:table-chair"], ["Office", "mdi:desk"], ["Hallway", "mdi:door"], ["Garden", "mdi:flower-outline"],
  ["Garage", "mdi:garage"], ["Utility Room", "mdi:washing-machine"],
];
const GHS_ROOM_ICONS = ["mdi:sofa-outline", "mdi:silverware-fork-knife", "mdi:bed-outline", "mdi:bed-king-outline", "mdi:shower", "mdi:table-chair", "mdi:desk",
  "mdi:door", "mdi:stairs", "mdi:flower-outline", "mdi:garage", "mdi:washing-machine", "mdi:human-child", "mdi:television", "mdi:home-outline", "mdi:tree-outline"];
const GHS_PAGES = [
  { id: "media", title: "Media", icon: "mdi:television-play", feature: "media|spotify|music" },
  { id: "security", title: "Security", icon: "mdi:shield-home-outline", feature: "cctv" },
  { id: "lights", title: "Lights", icon: "mdi:lightbulb-outline", feature: "lighting" },
  { id: "home", title: "Home", icon: "mdi:home-outline" },
  { id: "climate", title: "Climate", icon: "mdi:thermometer", feature: "climate" },
  { id: "devices", title: "Plan", icon: "mdi:floor-plan", feature: "floorplan" },
  { id: "energy", title: "Energy", icon: "mdi:lightning-bolt", feature: "energy" },
];
const GHS_FEATURE_DEFAULTS = {
  weather: true, lighting: true, climate: true, news: true, presence: false, heating_hive: false, energy: false, media: false,
  spotify: false, music: false, tv_power: false, cctv: false, laundry: false, bins: false, floorplan: false,
};
// Music services for the Media page. Spotify has its own card; the others play through any Home Assistant
// media player (Music Assistant, Apple TV or HomePod, Sonos, Plex...) with the music card.
const GHS_MUSIC = {
  spotify: { name: "Spotify", icon: "mdi:spotify" },
  apple_music: { name: "Apple Music", icon: "mdi:apple" },
  music_assistant: { name: "Music", icon: "mdi:music-box-multiple-outline" },
  other: { name: "Music", icon: "mdi:music" },
};
// Scene buttons matched to scenes by their names ("Movie night" -> the film button)
const GHS_SCENE_WORDS = {
  bright: /\b(bright|energi[sz]e|concentrate|daylight|read(ing)?)\b/i,
  relax: /\b(relax(ing)?|chill|cos[iy]|calm|soft)\b/i,
  evening: /\b(evening|dinner|dusk|dim(med)?)\b/i,
  night: /\b(night ?light|night|sleep|bed ?time|nightlight)\b/i,
  film: /\b(film|movie|cinema|tv|watch(ing)?)\b/i,
  all_off: /\b(all ?off|everything ?off|lights ?off|leaving|away)\b/i,
};
function ghsSceneMatch(states = {}, current = {}) {
  const out = { ...current };
  const scenes = Object.keys(states).filter((id) => id.startsWith("scene.")).sort();
  const used = new Set(Object.values(out).filter(Boolean));
  const label = (id) => `${(states[id].attributes && states[id].attributes.friendly_name) || ""} ${id.slice(6).replace(/_/g, " ")}`;
  // the most specific words first, so "Movie night" goes to film rather than night
  for (const k of ["film", "all_off", "bright", "relax", "evening", "night"]) {
    if (out[k]) continue;
    const hit = scenes.find((id) => !used.has(id) && GHS_SCENE_WORDS[k].test(label(id)));
    if (hit) { out[k] = hit; used.add(hit); }
  }
  return out;
}
// "GBP" -> "£" (for labels); unknown codes are shown as they are
function ghsCurrencySymbol(code, locale) {
  try {
    const p = new Intl.NumberFormat(locale || "en-GB", { style: "currency", currency: code }).formatToParts(1).find((x) => x.type === "currency");
    return p ? p.value : code;
  } catch (e) { return code; }
}
const GHS_CURRENCIES = ["GBP", "EUR", "USD", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "JPY", "INR", "ZAR", "BRL", "MXN", "SGD", "HKD"];
const GHS_SCENES = ["bright", "relax", "evening", "night", "film", "all_off"];

// What an entity is, how the dashboard shows it, and what it can do. null: not shown in setup.
const GHS_SENSOR_CLASSES = { temperature: ["Temperature", "mdi:thermometer"], humidity: ["Humidity", "mdi:water-percent"], power: ["Power", "mdi:flash"],
  energy: ["Energy", "mdi:lightning-bolt"], illuminance: ["Light level", "mdi:brightness-5"], carbon_dioxide: ["CO₂", "mdi:molecule-co2"], pm25: ["Air quality", "mdi:air-filter"] };
const GHS_BINARY_CLASSES = { door: ["Door", "mdi:door"], window: ["Window", "mdi:window-closed-variant"], motion: ["Motion", "mdi:motion-sensor"],
  occupancy: ["Presence", "mdi:home-account"], presence: ["Presence", "mdi:home-account"], smoke: ["Smoke alarm", "mdi:smoke-detector"], moisture: ["Leak", "mdi:water-alert"],
  opening: ["Opening", "mdi:door-open"], garage_door: ["Garage door", "mdi:garage"] };
function ghsKind(id, attrs = {}) {
  const d = String(id).split(".")[0], dc = attrs.device_class, f = Number(attrs.supported_features) || 0;
  const modes = attrs.supported_color_modes || [];
  switch (d) {
    case "light": {
      const c = ["On / off"];
      if (modes.some((m) => m !== "onoff")) c.push("Brightness");
      if (modes.some((m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m))) c.push("Colour");
      if (modes.includes("color_temp")) c.push("Warmth");
      return { type: "Light", group: "lights", icon: "mdi:lightbulb-outline", card: "light", controls: c };
    }
    case "switch": return dc === "outlet"
      ? { type: "Smart plug", group: "plugs", icon: "mdi:power-socket-uk", card: "switch", controls: ["On / off"] }
      : { type: "Switch", group: "plugs", icon: "mdi:toggle-switch-outline", card: "switch", controls: ["On / off"] };
    case "climate": return { type: "Thermostat", group: "climate", icon: "mdi:thermostat", card: "thermostat", controls: ["Target temperature", "Mode"] };
    case "water_heater": return { type: "Water heater", group: "climate", icon: "mdi:water-boiler", card: "tile", controls: ["Mode"] };
    case "fan": return { type: "Fan", group: "climate", icon: "mdi:fan", card: "tile", controls: ["On / off"].concat(f & 1 ? ["Speed"] : []) };
    case "media_player": return dc === "speaker"
      ? { type: "Speaker", group: "media", icon: "mdi:speaker", card: "media", controls: ["Play / pause", "Volume"] }
      : { type: dc === "tv" ? "TV" : "Media player", group: "media", icon: dc === "tv" ? "mdi:television" : "mdi:cast", card: "media", controls: ["Play / pause", "Volume"] };
    case "remote": return { type: "Remote", group: "media", icon: "mdi:remote", card: "tile", controls: ["Power"] };
    case "camera": return { type: "Camera", group: "security", icon: "mdi:cctv", card: "camera", controls: ["Live view"] };
    case "lock": return { type: "Lock", group: "security", icon: "mdi:lock-outline", card: "tile", controls: ["Lock / unlock"] };
    case "alarm_control_panel": return { type: "Alarm", group: "security", icon: "mdi:shield-home-outline", card: "tile", controls: ["Arm / disarm"] };
    case "cover": {
      const blind = ["blind", "shade", "shutter", "curtain", "awning"].includes(dc);
      return { type: blind ? "Blinds" : dc === "garage" ? "Garage door" : "Cover", group: "covers", icon: blind ? "mdi:blinds" : dc === "garage" ? "mdi:garage" : "mdi:window-shutter",
        card: "tile", controls: ["Open / close"].concat(f & 4 ? ["Position"] : []) };
    }
    case "vacuum": return { type: "Vacuum", group: "appliances", icon: "mdi:robot-vacuum", card: "tile", controls: ["Start / dock"] };
    case "sensor": {
      const k = GHS_SENSOR_CLASSES[dc];
      return k ? { type: k[0], group: "sensors", icon: k[1], card: "sensor", controls: [] } : null;
    }
    case "binary_sensor": {
      const k = GHS_BINARY_CLASSES[dc];
      return k ? { type: k[0], group: "sensors", icon: k[1], card: "sensor", controls: [] } : null;
    }
    case "weather": return { type: "Weather", group: "weather", icon: "mdi:weather-partly-cloudy", card: "weather", controls: [] };
    case "person": return { type: "Person", group: "people", icon: "mdi:account", card: "tile", controls: [] };
    case "scene": return { type: "Scene", group: "scenes", icon: "mdi:palette-outline", card: "scene", controls: ["Activate"] };
    default: return null;
  }
}
const GHS_UNAVAILABLE = ["unavailable", "unknown"];

// Every device-like entity in this Home Assistant, with its room from the area registry. hass.entities,
// hass.devices and hass.areas are Home Assistant's own registry views (no extra permissions).
function ghsDiscover(hass) {
  const ents = (hass && hass.entities) || {}, devs = (hass && hass.devices) || {}, areas = (hass && hass.areas) || {};
  const out = [];
  for (const [id, st] of Object.entries((hass && hass.states) || {})) {
    const reg = ents[id] || {};
    if (reg.hidden || reg.entity_category) continue;
    const a = st.attributes || {};
    const kind = ghsKind(id, a);
    if (!kind) continue;
    const dev = reg.device_id ? devs[reg.device_id] : null;
    const areaId = reg.area_id || (dev && dev.area_id) || null;
    out.push({
      id, kind, name: a.friendly_name || id, icon: a.icon || kind.icon,
      area: areaId, areaName: areaId && areas[areaId] ? areas[areaId].name : "",
      source: reg.platform || "", device: dev ? dev.name_by_user || dev.name || "" : "",
      // scenes, scripts and buttons that have never run report "unknown": that's not offline
      online: /^(scene|script|button|input_button)\./.test(id) ? st.state !== "unavailable" : !GHS_UNAVAILABLE.includes(st.state), state: st.state,
    });
  }
  return out.sort((x, y) => x.name.localeCompare(y.name));
}

// Rooms from Home Assistant's areas, in area order, each with the devices assigned to it there
function ghsRoomsFromAreas(hass, devices) {
  const areas = Object.values((hass && hass.areas) || {});
  const icon = (a) => a.icon || (GHS_ROOM_SUGGESTIONS.find(([n]) => n.toLowerCase() === String(a.name).toLowerCase()) || [])[1] || "mdi:home-outline";
  return areas.map((a) => ({
    key: `area_${a.area_id}`, name: a.name, icon: icon(a), visible: true, area_id: a.area_id,
    entities: devices.filter((d) => d.area === a.area_id && !["weather", "people", "scenes"].includes(d.kind.group)).map((d) => d.id),
  })).filter((r) => r.name);
}

const ghsSlug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "room";
const ghsUniqueKey = (rooms, name) => {
  const base = ghsSlug(name);
  let k = base, n = 2;
  while (rooms.some((r) => r.key === k)) k = `${base}_${n++}`;
  return k;
};

function ghsNewDraft(tz) {
  return {
    v: GHS_VERSION, step: "welcome", visited: [],
    household: { greeting: "", name: "", locale: "", timezone: tz || "", clock: "24", temperature_unit: "C", distance_unit: "km", show_greeting: true, currency: "" },
    weather: { source: "", entity: "", place: null },
    rooms: [], devices: {},
    appearance: { background: "aurora", home: "home", fit: "reflow", pages: {}, titles: {} },
    features: { ...GHS_FEATURE_DEFAULTS },
    choices: { thermostat: "", temperature: "", heater_switch: "", heater_power: "", tv: "", tv_remote: "", spotify: "", cameras: [], person: "", scenes: {},
      news_todo: "", spotify_device: "", music_service: "", music_player: "",
      bins: { source: "", start: "", every_days: 7, pattern: "grey | blue, green", events: [], file: "", map: {}, labels: {}, calendar: "", reminder_hour: 18 },
      energy: { supplier: "", method: "", electricity: {}, gas: {} } },
  };
}

const ghsIs = (id, domain) => typeof id === "string" && id.startsWith(`${domain}.`);
const ghsUniq = (a) => [...new Set(a.filter(Boolean))];
const ghsBinPattern = (text) => String(text || "").split("|").map((w) => w.split(",").map((b) => b.trim().toLowerCase()).filter(Boolean)).filter((w) => w.length);

// Auto-detected integration setups that need more than one entity
function ghsDetectEnergy(states) {
  const ids = Object.keys(states || {});
  const pick = (re) => ids.find((i) => re.test(i)) || "";
  const e = (k) => pick(new RegExp(`^sensor\\.octopus_energy_electricity_[0-9a-z]+_[0-9]+_${k}$`));
  const g = (k) => pick(new RegExp(`^sensor\\.octopus_energy_gas_[0-9a-z]+_[0-9]+_${k}$`));
  const demand = e("current_demand");
  if (!demand && !e("current_accumulative_consumption")) return null;
  const meter = (id, from, to) => (id ? id.replace(/^sensor\./, "octopus_energy:").replace(from, to) : "");
  const out = { electricity: { demand, today_kwh: e("current_accumulative_consumption"), today_cost: e("current_accumulative_cost"), rate: e("current_rate"),
    standing: e("current_standing_charge") } };
  out.electricity.stat_kwh = meter(out.electricity.today_kwh, "current_accumulative_consumption", "previous_accumulative_consumption");
  out.electricity.stat_cost = meter(out.electricity.today_cost, "current_accumulative_cost", "previous_accumulative_cost");
  const gk = g("current_accumulative_consumption_kwh");
  if (gk) {
    out.gas = { today_kwh: gk, today_cost: g("current_accumulative_cost"), rate: g("current_rate"), standing: g("current_standing_charge") };
    out.gas.stat_kwh = meter(gk, "current_accumulative_consumption_kwh", "previous_accumulative_consumption_kwh");
    out.gas.stat_cost = meter(out.gas.today_cost, "current_accumulative_cost", "previous_accumulative_cost");
  }
  return out;
}
function ghsDetectLaundry(states) {
  const ids = Object.keys(states || {});
  const m = ids.map((i) => /^sensor\.(.+)_machine_state$/.exec(i)).find((x) => x && states[`sensor.${x[1]}_job_state`]);
  if (!m) return null;
  const p = m[1], has = (i) => (states[i] ? i : "");
  const helpers = ["input_text.laundry_current_cycle", "input_boolean.laundry_finished"].every((i) => states[i]);
  return {
    helpers,
    config: {
      machine_state: `sensor.${p}_machine_state`, job_state: `sensor.${p}_job_state`, completion_time: has(`sensor.${p}_completion_time`),
      power: has(`sensor.${p}_power`), energy: has(`sensor.${p}_energy`), water_consumption: has(`sensor.${p}_water_consumption`),
      course: has(`select.${p}`), spin_level: has(`select.${p}_spin_level`), water_temperature: has(`select.${p}_water_temperature`),
      rinse_cycles: has(`number.${p}_rinse_cycles`), bubble_soak: has(`switch.${p}_bubble_soak`), child_lock: has(`binary_sensor.${p}_child_lock`),
      remote_control: has(`binary_sensor.${p}_remote_control`),
      current_cycle: "input_text.laundry_current_cycle", finished: "input_boolean.laundry_finished",
      log: ["input_text.laundry_wash_log_1", "input_text.laundry_wash_log_2", "input_text.laundry_wash_log_3"],
    },
  };
}
function ghsDetectHive(states, entities, thermostat) {
  const reg = entities || {};
  const climate = thermostat && reg[thermostat] && reg[thermostat].platform === "hive" ? thermostat
    : Object.keys(states || {}).find((i) => i.startsWith("climate.") && reg[i] && reg[i].platform === "hive");
  if (!climate) return null;
  const base = climate.slice(8), has = (i) => (states[i] ? i : "");
  const helpers = ["schedule.heating_schedule", "automation.heating_schedule_control", "input_number.heating_comfort", "input_number.heating_eco"].every((i) => states[i]);
  return {
    helpers,
    config: { title: "Thermostat", climate, current: has(`sensor.${base}_current_temperature`), target: has(`sensor.${base}_target_temperature`),
      boiler: has(`binary_sensor.${base}_state`), boost: has(`binary_sensor.${base}_boost`),
      hub: Object.keys(states).find((i) => /^binary_sensor\..*hive.*hub.*status$/.test(i)) || "", battery: has(`sensor.${base}_battery_level`),
      schedule: "schedule.heating_schedule", control: "automation.heating_schedule_control", comfort: "input_number.heating_comfort", eco: "input_number.heating_eco" },
  };
}

// Draft -> the dashboard's glasshome: settings. `prev` is the current settings: anything the wizard
// does not manage (floorplan.arch, news.custom, bins.types, ...) is kept as it was.
function ghsBuildConfig(draft, prev = {}, ctx = {}) {
  const states = ctx.states || {}, entities = ctx.entities || {};
  const d = draft, H = d.household || {}, C = d.choices || {}, F = { ...GHS_FEATURE_DEFAULTS, ...(d.features || {}) };
  const cfg = JSON.parse(JSON.stringify(prev || {}));
  delete cfg.demo;
  const was = cfg.setup && cfg.setup.complete === true && cfg.setup.completed;
  cfg.setup = { complete: true, version: GHS_VERSION, completed: was || ctx.now || new Date().toISOString() };
  cfg.household = { ...(cfg.household || {}), name: H.name || "", greeting: H.greeting || "" };
  for (const k of ["locale", "timezone"]) { if (H[k]) cfg.household[k] = H[k]; else delete cfg.household[k]; }
  cfg.household.clock = H.clock === "12" ? 12 : 24;
  cfg.household.temperature_unit = H.temperature_unit === "F" ? "°F" : "°C";
  cfg.household.distance_unit = H.distance_unit === "mi" ? "mi" : "km";
  cfg.household.show_greeting = H.show_greeting !== false;
  if (/^[A-Z]{3}$/.test(H.currency || "")) cfg.household.currency = H.currency; else delete cfg.household.currency;

  // weather
  const W = d.weather || {};
  if (W.source === "open_meteo" && W.place && Number.isFinite(+W.place.latitude) && Number.isFinite(+W.place.longitude)) {
    cfg.weather = { provider: "open_meteo", entity: GHS_OM_ENTITY, place: { name: String(W.place.name || "My location"), label: String(W.place.label || W.place.name || ""),
      latitude: Math.round(+W.place.latitude * 100) / 100, longitude: Math.round(+W.place.longitude * 100) / 100 } };
  } else if (W.source === "entity" && W.entity) cfg.weather = { entity: W.entity };
  else delete cfg.weather;
  F.weather = !!cfg.weather && F.weather !== false;

  // rooms, names and icons
  const devs = d.devices || {};
  const shown = (id) => !(devs[id] && devs[id].hidden);
  const named = (id) => (devs[id] && (devs[id].name || devs[id].icon) ? { entity: id, ...(devs[id].name ? { name: devs[id].name } : {}), ...(devs[id].icon ? { icon: devs[id].icon } : {}) } : id);
  const isLight = (id) => ghsIs(id, "light") || (ghsIs(id, "switch") && !!(devs[id] && devs[id].as_light));
  const rooms = (d.rooms || []).filter((r) => r.visible !== false && r.name);
  cfg.rooms = rooms.map((r) => {
    const ids = (r.entities || []).filter(shown);
    const lights = ids.filter(isLight);
    return { name: r.name, icon: r.icon || "mdi:home-outline", ...(r.area_id ? { area: r.area_id } : {}), lights, entities: ids.map(named) };
  }).filter((r) => r.entities.length || r.lights.length);
  if (!cfg.rooms.length) delete cfg.rooms;
  // rooms with no devices yet are not shown, but kept so Settings still lists them
  const emptyRooms = rooms.filter((r) => !(r.entities || []).some(shown))
    .map((r) => ({ name: r.name, icon: r.icon || "mdi:home-outline", ...(r.area_id ? { area: r.area_id } : {}) }));
  if (emptyRooms.length) cfg.setup.empty_rooms = emptyRooms;
  // hidden rooms are not shown, but kept here so Settings can bring them back (the cards ignore this)
  const hiddenRooms = (d.rooms || []).filter((r) => r.visible === false && r.name)
    .map((r) => ({ name: r.name, icon: r.icon || "mdi:home-outline", ...(r.area_id ? { area: r.area_id } : {}), entities: [...(r.entities || [])] }));
  if (hiddenRooms.length) cfg.setup.hidden_rooms = hiddenRooms;
  const overrides = {};
  for (const [id, o] of Object.entries(devs)) {
    if (!o) continue;
    const v = {};
    if (o.name) v.name = String(o.name);
    if (o.icon) v.icon = String(o.icon);
    if (o.hidden) v.hidden = true;
    if (Object.keys(v).length) overrides[id] = v;
  }
  if (Object.keys(overrides).length) cfg.devices = overrides; else delete cfg.devices;

  // lighting: everything light-like in a shown room; favourites first (up to 4 on the homepage)
  const allIds = ghsUniq(rooms.flatMap((r) => (r.entities || []).filter(shown)));
  const lightIds = allIds.filter(isLight);
  const favs = allIds.filter((id) => devs[id] && devs[id].favourite);
  const favLights = favs.filter(isLight);
  const top = ghsUniq([...favLights, ...lightIds]).slice(0, 4);
  if (lightIds.length) {
    cfg.lighting = { ...(cfg.lighting || {}), all: lightIds, lights: top };
    const pw = top.map((id) => (devs[id] && devs[id].power) || null);
    if (pw.some(Boolean)) cfg.lighting.power = pw; else delete cfg.lighting.power;
  } else delete cfg.lighting;
  if (favs.length) cfg.favourites = favs; else delete cfg.favourites;
  F.lighting = !!cfg.lighting && F.lighting !== false;

  // scenes
  const sc = {};
  for (const k of GHS_SCENES) if (C.scenes && C.scenes[k]) sc[k] = C.scenes[k];
  if (Object.keys(sc).length) cfg.scenes = sc; else delete cfg.scenes;

  // climate
  const thermostat = C.thermostat || allIds.find((id) => ghsIs(id, "climate")) || "";
  if (thermostat) {
    cfg.climate = { thermostat };
    if (C.temperature) cfg.climate.temperature = C.temperature;
    if (C.heater_switch) cfg.climate.heater = { switch: C.heater_switch, ...(C.heater_power ? { power: C.heater_power } : {}) };
  } else delete cfg.climate;
  F.climate = !!cfg.climate && F.climate !== false;
  if (F.heating_hive) {
    const hive = ghsDetectHive(states, entities, thermostat);
    if (hive && hive.helpers) cfg.heating = hive.config; else F.heating_hive = false;
  }
  if (!F.heating_hive) delete cfg.heating;

  // media
  const tv = C.tv || (F.media ? allIds.find((id) => ghsIs(id, "media_player")) : "") || "";
  if (tv) {
    cfg.media = { ...(cfg.media || {}), tv, tv_cast: (cfg.media && cfg.media.tv_cast && cfg.media.tv === tv) ? cfg.media.tv_cast : tv };
    if (C.tv_remote) cfg.media.tv_remote = C.tv_remote; else if (!(prev.media && prev.media.tv === tv)) delete cfg.media.tv_remote;
    if (C.spotify) cfg.media.spotify = C.spotify; else delete cfg.media.spotify;
  } else if (C.spotify) cfg.media = { spotify: C.spotify };
  else delete cfg.media;
  // Spotify plays on one Spotify Connect device (a speaker, TV or this tablet's browser)
  if (cfg.media && cfg.media.spotify && C.spotify_device) cfg.media.spotify_device = String(C.spotify_device).slice(0, 80);
  else if (cfg.media && !cfg.media.spotify) { delete cfg.media.spotify_device; delete cfg.media.spotify_device_label; delete cfg.media.spotify_device_note; }
  // music: Spotify (above) or another service through a Home Assistant media player
  const MS = GHS_MUSIC[C.music_service] ? C.music_service : "";
  if (MS && MS !== "spotify" && C.music_player) cfg.media = { ...(cfg.media || {}), music: { service: MS, player: C.music_player } };
  else if (MS === "spotify" && cfg.media) cfg.media.music = { service: "spotify" };
  else if (cfg.media) delete cfg.media.music;
  F.media = !!(cfg.media && cfg.media.tv) && !!F.media;
  F.spotify = !!(cfg.media && cfg.media.spotify && cfg.media.spotify_device) && !!F.spotify && MS !== "apple_music" && MS !== "music_assistant" && MS !== "other";
  F.music = !!(cfg.media && cfg.media.music && cfg.media.music.player) && !!F.music;
  F.tv_power = F.media && !!F.tv_power && !!(cfg.media.tv_remote && states["script.glasshome_tv_power"]);
  if (F.tv_power) cfg.media.tv_power_script = "script.glasshome_tv_power";

  // cameras
  const cams = (C.cameras || []).filter(Boolean);
  if (cams.length) cfg.cctv = { cameras: cams.map((id) => ({ entity: id, name: (devs[id] && devs[id].name) || (states[id] && states[id].attributes && states[id].attributes.friendly_name) || id })) };
  else delete cfg.cctv;
  F.cctv = !!cfg.cctv && !!F.cctv;

  // presence
  // whether someone is home is only shown when Home or away is switched on
  if (C.person && F.presence) cfg.presence = { person: C.person }; else delete cfg.presence;
  F.presence = !!cfg.presence && !!F.presence;

  // news (needs the Glass Home News integration's action)
  if (F.news && ctx.services && !(ctx.services.glasshome_news && ctx.services.glasshome_news.fetch)) F.news = false;
  if (F.news) cfg.news = { ...(cfg.news || {}), todo: C.news_todo || (cfg.news && cfg.news.todo) || "todo.glasshome_news" };
  else delete cfg.news;

  // energy: Octopus is found from its entity names; any other meter is chosen in Settings -> Energy.
  // The settings are kept while the feature is off, so switching it back on needs nothing new.
  const E = C.energy || {};
  const method = E.method || (ghsDetectEnergy(states) ? "octopus" : "");
  if (method !== "keep") {
    const en = method === "octopus" ? ghsDetectEnergy(states) : method ? ghsEnergyFromMap(E) : null;
    const apps = cfg.energy && cfg.energy.appliances;
    if (en) cfg.energy = { ...en, method, ...(E.supplier ? { supplier: E.supplier } : {}), ...(apps ? { appliances: apps } : {}) };
    else delete cfg.energy;
  }
  F.energy = !!(cfg.energy && cfg.energy.electricity) && !!F.energy;
  if (F.laundry) { const la = ghsDetectLaundry(states); if (la && la.helpers) cfg.laundry = la.config; else F.laundry = false; }
  if (!F.laundry) delete cfg.laundry;

  // bins: the council's calendar (a file, or a Home Assistant calendar), your own dates, or a repeating
  // rotation. Kept while the feature is off.
  const B = C.bins || {};
  const src = B.source || (/^\d{4}-\d{2}-\d{2}$/.test(B.start || "") ? "rotation" : "");
  if (src !== "keep") {
    const bins = { ...(cfg.bins || {}) };
    const prevTypes = bins.types || {};
    for (const k of ["rotation", "schedule", "calendar", "source", "file", "types", "reminder_hour"]) delete bins[k];
    let used = [];
    if (src === "rotation" && /^\d{4}-\d{2}-\d{2}$/.test(B.start || "") && ghsBinPattern(B.pattern).length) {
      bins.rotation = { start: B.start, every_days: Math.max(1, Math.min(28, Number(B.every_days) || 7)), pattern: ghsBinPattern(B.pattern), weeks: 156 };
      used = bins.rotation.pattern.flat();
    } else if ((src === "file" || src === "dates") && (B.events || []).length) {
      const sch = ghsBinsSchedule(B.events, B.map || {});
      if (Object.keys(sch).length) { bins.schedule = sch; used = Object.values(sch).flat(); if (src === "file" && B.file) bins.file = String(B.file).slice(0, 80); }
    } else if (src === "calendar" && /^calendar\.[a-z0-9_]+$/.test(B.calendar || "")) {
      const map = Object.fromEntries(Object.entries(B.map || {}).map(([k, v]) => [ghsBinKey(k), [].concat(v).filter((id) => GHS_BIN_COLOURS[id])]));
      bins.calendar = { entity: B.calendar, map };
      used = Object.values(map).flat();
    }
    if (bins.rotation || bins.schedule || bins.calendar) {
      bins.source = src;
      const types = ghsBinTypes(used, B.labels || {}, prevTypes);
      if (Object.keys(types).length) bins.types = types;
      const h = Number(B.reminder_hour);
      if (Number.isFinite(h) && h !== 18) bins.reminder_hour = Math.max(12, Math.min(23, Math.round(h))); else delete bins.reminder_hour;
      cfg.bins = bins;
    } else delete cfg.bins;
  }
  F.bins = !!(cfg.bins && (cfg.bins.rotation || cfg.bins.schedule || cfg.bins.calendar)) && !!F.bins;

  cfg.features = Object.fromEntries(Object.keys(GHS_FEATURE_DEFAULTS).map((k) => [k, !!F[k]]));

  // appearance and navigation
  const A = d.appearance || {};
  const pagesOn = A.pages || {};
  const pages = GHS_PAGES.filter((p) => pagesOn[p.id] !== false);
  cfg.navigation = { ...(cfg.navigation || {}), home: pages.some((p) => p.id === A.home) ? A.home : "home" };
  if (pages.length !== GHS_PAGES.length) cfg.navigation.pages = pages; else delete cfg.navigation.pages;
  // your own names for the pages in the bottom bar (blank = the usual name)
  const titles = {};
  for (const p of GHS_PAGES) {
    const t = String((A.titles || {})[p.id] || "").replace(/[<>]/g, "").trim().slice(0, 16);
    if (t && t !== p.title) titles[p.id] = t;
  }
  if (Object.keys(titles).length) cfg.navigation.titles = titles; else delete cfg.navigation.titles;
  cfg.layout = { ...(cfg.layout || {}), fit: A.fit === "scale" ? "scale" : "reflow" };
  cfg.appearance = { background: A.background === "plain" ? "plain" : "aurora" };
  return cfg;
}

// glasshome: settings -> a draft (Settings page, and re-running the wizard over an existing setup)
function ghsDraftFromConfig(cfg = {}, tz) {
  const d = ghsNewDraft(tz);
  const H = cfg.household || {};
  Object.assign(d.household, {
    greeting: H.greeting || "", name: H.name || "", locale: H.locale || "", timezone: H.timezone || d.household.timezone,
    clock: String(H.clock) === "12" ? "12" : "24", temperature_unit: /F/.test(H.temperature_unit || "") ? "F" : "C",
    distance_unit: H.distance_unit === "mi" ? "mi" : "km", show_greeting: H.show_greeting !== false, currency: /^[A-Z]{3}$/.test(H.currency || "") ? H.currency : "",
  });
  const W = cfg.weather || {};
  if (W.provider === "open_meteo" && W.place) d.weather = { source: "open_meteo", entity: "", place: { ...W.place } };
  else if (W.entity) d.weather = { source: "entity", entity: W.entity, place: null };
  d.devices = JSON.parse(JSON.stringify(cfg.devices || {}));
  d.rooms = (cfg.rooms || []).map((r, i) => {
    const ents = (r.entities || []).map((e) => (e && typeof e === "object" ? e.entity : e)).filter(Boolean);
    for (const e of r.entities || []) if (e && typeof e === "object" && e.entity && (e.name || e.icon)) d.devices[e.entity] = { ...(d.devices[e.entity] || {}), ...(e.name ? { name: e.name } : {}), ...(e.icon ? { icon: e.icon } : {}) };
    return { key: r.area ? `area_${r.area}` : `${ghsSlug(r.name)}_${i}`, name: r.name || "", icon: r.icon || "mdi:home-outline", visible: true, ...(r.area ? { area_id: r.area } : {}),
      entities: ghsUniq([...ents, ...(r.lights || [])]) };
  });
  for (const r of (cfg.setup && cfg.setup.empty_rooms) || []) {
    if (!r || !r.name || d.rooms.some((x) => x.name === r.name)) continue;
    d.rooms.push({ key: r.area ? `area_${r.area}` : `${ghsSlug(r.name)}_${d.rooms.length}`, name: r.name, icon: r.icon || "mdi:home-outline", visible: true,
      ...(r.area ? { area_id: r.area } : {}), entities: [] });
  }
  for (const r of (cfg.setup && cfg.setup.hidden_rooms) || []) {
    if (!r || !r.name || d.rooms.some((x) => x.name === r.name)) continue;
    d.rooms.push({ key: r.area ? `area_${r.area}` : `${ghsSlug(r.name)}_${d.rooms.length}`, name: r.name, icon: r.icon || "mdi:home-outline", visible: false,
      ...(r.area ? { area_id: r.area } : {}), entities: ghsUniq((r.entities || []).filter((e) => typeof e === "string")) });
  }
  for (const id of cfg.favourites || []) d.devices[id] = { ...(d.devices[id] || {}), favourite: true };
  const L = cfg.lighting || {};
  // settings saved by the wizard list favourites; older hand-written ones only have the homepage lights
  (L.lights || []).forEach((id, i) => {
    if (!id) return;
    if (!cfg.favourites) d.devices[id] = { ...(d.devices[id] || {}), favourite: true };
    if (L.power && L.power[i]) d.devices[id] = { ...(d.devices[id] || {}), power: L.power[i] };
  });
  for (const id of L.all || []) if (ghsIs(id, "switch")) d.devices[id] = { ...(d.devices[id] || {}), as_light: true };
  d.features = { ...GHS_FEATURE_DEFAULTS, ...(cfg.features || {}) };
  const C = d.choices;
  const cl = cfg.climate || {};
  C.thermostat = cl.thermostat || ""; C.temperature = cl.temperature || "";
  C.heater_switch = (cl.heater && cl.heater.switch) || ""; C.heater_power = (cl.heater && cl.heater.power) || "";
  const M = cfg.media || {};
  C.tv = M.tv || ""; C.tv_remote = M.tv_remote || ""; C.spotify = M.spotify || "";
  C.cameras = ((cfg.cctv && cfg.cctv.cameras) || []).map((c) => (c && typeof c === "object" ? c.entity : c)).filter(Boolean);
  C.person = (cfg.presence && cfg.presence.person) || "";
  C.scenes = { ...(cfg.scenes || {}) };
  C.news_todo = (cfg.news && cfg.news.todo) || "";
  C.spotify_device = M.spotify_device || "";
  C.music_service = (M.music && GHS_MUSIC[M.music.service] && M.music.service) || (M.spotify ? "spotify" : "");
  C.music_player = (M.music && M.music.player) || "";
  const Bc = cfg.bins || {}, R = Bc.rotation;
  if (R) Object.assign(C.bins, { start: R.start || "", every_days: R.every_days || 7, pattern: (R.pattern || []).map((w) => w.join(", ")).join(" | ") });
  C.bins.source = Bc.source || (Bc.calendar ? "calendar" : Bc.schedule ? "dates" : R ? "rotation" : "");
  if (Bc.schedule) {
    C.bins.events = Object.entries(Bc.schedule).map(([date, ids]) => ({ date, summary: [].concat(ids).join(" + ") }));
    C.bins.map = Object.fromEntries(Object.values(Bc.schedule).map((ids) => [ghsBinKey([].concat(ids).join(" + ")), [].concat(ids)]));
  }
  if (Bc.calendar) { C.bins.calendar = Bc.calendar.entity || ""; C.bins.map = { ...(Bc.calendar.map || {}) }; }
  C.bins.file = Bc.file || "";
  C.bins.reminder_hour = Number.isFinite(Number(Bc.reminder_hour)) ? Number(Bc.reminder_hour) : 18;
  C.bins.labels = Object.fromEntries(Object.entries(Bc.types || {}).filter(([id]) => GHS_BIN_COLOURS[id]).map(([id, t]) => [id, { name: t.name || "", waste: t.waste || "" }]));
  const En = cfg.energy;
  if (En && En.electricity) {
    const back = (s = {}) => {
      const o = {};
      for (const k of ["demand", "today_kwh", "today_cost", "rate", "standing"]) if (s[k] && !/^sensor\.glasshome_/.test(s[k])) o[k] = s[k];
      const meter = s.today_from || (s.stat_kwh && s.stat_kwh !== s.today_kwh && /^sensor\./.test(s.stat_kwh) ? s.stat_kwh : "");
      if (meter) o.meter = meter;
      if (s.stat_cost && s.stat_cost !== s.today_cost && /^sensor\./.test(s.stat_cost)) o.cost_meter = s.stat_cost;
      return o;
    };
    C.energy = { supplier: En.supplier || "", method: En.method || "keep", electricity: back(En.electricity), gas: back(En.gas) };
  }
  const N = cfg.navigation || {};
  d.appearance = { background: (cfg.appearance && cfg.appearance.background) === "plain" ? "plain" : "aurora", home: N.home || "home",
    fit: (cfg.layout && cfg.layout.fit) === "scale" ? "scale" : "reflow",
    pages: N.pages ? Object.fromEntries(GHS_PAGES.map((p) => [p.id, N.pages.some((x) => x.id === p.id)])) : {},
    titles: { ...(N.titles || {}) } };
  return d;
}

// What still stops the setup from being saved (the rest is optional)
function ghsProblems(draft) {
  const p = [];
  const W = draft.weather || {};
  if (W.source === "open_meteo" && !(W.place && Number.isFinite(+W.place.latitude))) p.push({ step: "weather", text: "Choose a place for the weather, or pick a weather entity." });
  if (W.source === "entity" && !W.entity) p.push({ step: "weather", text: "Choose a weather entity, or search for a place." });
  const names = (draft.rooms || []).map((r) => String(r.name || "").trim().toLowerCase());
  if (names.some((n) => !n)) p.push({ step: "rooms", text: "Every room needs a name." });
  if (new Set(names).size !== names.length) p.push({ step: "rooms", text: "Two rooms have the same name." });
  const F = draft.features || {}, C = draft.choices || {};
  if (F.presence && !C.person) p.push({ step: "features", text: "Home or away is on: choose the person, or switch it off." });
  if (F.cctv && !(C.cameras || []).length) p.push({ step: "features", text: "Cameras is on: choose at least one camera, or switch it off." });
  return p;
}

// A small YAML writer for the settings (plain objects, lists, strings, numbers, booleans and null)
function ghsToYaml(v, ind = "") {
  const q = (s) => (/^[A-Za-z0-9_][A-Za-z0-9_ .\/@-]*$/.test(s) && !/^(true|false|null|yes|no|on|off|~|-?\d+(\.\d+)?)$/i.test(s) && !/\s$/.test(s) ? s : JSON.stringify(s));
  const scalar = (x) => (x === null || x === undefined ? "null" : typeof x === "string" ? q(x) : String(x));
  const isObj = (x) => x && typeof x === "object";
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    if (v.every((x) => !isObj(x))) return `[${v.map(scalar).join(", ")}]`;
    return v.map((x) => {
      if (!isObj(x)) return `\n${ind}- ${scalar(x)}`;
      const inner = ghsToYaml(x, `${ind}  `);
      return `\n${ind}- ${inner.replace(/^\n\s*/, "")}`;
    }).join("");
  }
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (!keys.length) return "{}";
    return keys.map((k) => {
      const x = v[k], key = /^[A-Za-z0-9_]+$/.test(k) ? k : JSON.stringify(k);
      if (isObj(x) && (Array.isArray(x) ? x.some(isObj) : Object.keys(x).length)) return `\n${ind}${key}:${ghsToYaml(x, `${ind}  `)}`;
      return `\n${ind}${key}: ${isObj(x) ? ghsToYaml(x, `${ind}  `) : scalar(x)}`;
    }).join("");
  }
  return scalar(v);
}

// ------------------------------------------------------------------ built-in weather (Open-Meteo)
// Open-Meteo (open-meteo.com) is free for non-commercial use without a key. The browser asks it for the
// forecast at the saved place (rounded to about 1 km); nothing else is sent.
const GHS_OM_ENTITY = "weather.glasshome_forecast";
const GHS_OM_HOURLY = "temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,is_day";
const GHS_OM_DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,wind_gusts_10m_max,uv_index_max,sunrise,sunset";
const GHS_OM_CURRENT = "temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day";
function ghsOpenMeteoUrl(place, units = {}) {
  const p = new URLSearchParams({
    latitude: (Math.round(+place.latitude * 100) / 100).toFixed(2), longitude: (Math.round(+place.longitude * 100) / 100).toFixed(2),
    current: GHS_OM_CURRENT, hourly: GHS_OM_HOURLY, daily: GHS_OM_DAILY, timezone: "auto", forecast_days: "7", forecast_hours: "48",
    temperature_unit: units.temperature === "°F" ? "fahrenheit" : "celsius", wind_speed_unit: units.distance === "mi" ? "mph" : "kmh",
    precipitation_unit: "mm", timeformat: "unixtime",
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}
const ghsGeocodeUrl = (q, lang = "en") => `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: String(q).trim().slice(0, 80), count: "8", language: lang, format: "json" })}`;
const ghsPlaceLabel = (r) => [r.name, r.admin1 && r.admin1 !== r.name ? r.admin1 : "", r.country].filter(Boolean).join(", ");
// WMO weather code -> Home Assistant weather condition
function ghsWmo(code, day = true) {
  const c = Number(code);
  if (c === 0 || c === 1) return day ? "sunny" : "clear-night";
  if (c === 2) return "partlycloudy";
  if (c === 3) return "cloudy";
  if (c === 45 || c === 48) return "fog";
  if ([51, 53, 55, 61, 63, 80, 81].includes(c)) return "rainy";
  if ([65, 82].includes(c)) return "pouring";
  if ([56, 57, 66, 67].includes(c)) return "snowy-rainy";
  if ([71, 73, 75, 77, 85, 86].includes(c)) return "snowy";
  if ([95, 96, 99].includes(c)) return "lightning-rainy";
  return "exceptional";
}
function ghsOpenMeteoParse(j, place, units = {}) {
  if (!j || !j.current || !j.hourly || !j.daily) throw new Error("Open-Meteo sent an incomplete forecast");
  const cu = j.current, H = j.hourly, D = j.daily;
  const iso = (t) => new Date(t * 1000).toISOString();
  const r1 = (x) => (x == null || Number.isNaN(+x) ? null : Math.round(+x * 10) / 10);
  const hour = H.time.findIndex((t) => t >= cu.time - 3599);
  const hourly = H.time.map((t, i) => ({
    datetime: iso(t), condition: ghsWmo(H.weather_code[i], H.is_day[i] === 1), temperature: r1(H.temperature_2m[i]), apparent_temperature: r1(H.apparent_temperature[i]),
    dew_point: r1(H.dew_point_2m[i]), humidity: H.relative_humidity_2m[i], precipitation: r1(H.precipitation[i]), precipitation_probability: H.precipitation_probability[i],
    cloud_coverage: H.cloud_cover[i], wind_speed: r1(H.wind_speed_10m[i]), wind_bearing: H.wind_direction_10m[i], wind_gust_speed: r1(H.wind_gusts_10m[i]),
    uv_index: r1(H.uv_index[i]), is_daytime: H.is_day[i] === 1,
  })).filter((x) => new Date(x.datetime).getTime() >= cu.time * 1000 - 3599e3);
  const daily = D.time.map((t, i) => ({
    datetime: iso(t), condition: ghsWmo(D.weather_code[i], true), temperature: r1(D.temperature_2m_max[i]), templow: r1(D.temperature_2m_min[i]),
    precipitation: r1(D.precipitation_sum[i]), precipitation_probability: D.precipitation_probability_max[i], wind_speed: r1(D.wind_speed_10m_max[i]),
    wind_bearing: D.wind_direction_10m_dominant[i], wind_gust_speed: r1(D.wind_gusts_10m_max[i]), uv_index: r1(D.uv_index_max[i]),
    sunrise: D.sunrise ? iso(D.sunrise[i]) : undefined, sunset: D.sunset ? iso(D.sunset[i]) : undefined,
  }));
  const tu = units.temperature === "°F" ? "°F" : "°C", wu = units.distance === "mi" ? "mph" : "km/h";
  const attributes = {
    friendly_name: (place && place.name) || "Weather", temperature: r1(cu.temperature_2m), apparent_temperature: r1(cu.apparent_temperature), dew_point: r1(cu.dew_point_2m),
    humidity: cu.relative_humidity_2m, cloud_coverage: cu.cloud_cover, pressure: r1(cu.pressure_msl), wind_bearing: cu.wind_direction_10m,
    wind_speed: r1(cu.wind_speed_10m), wind_gust_speed: r1(cu.wind_gusts_10m), uv_index: hour >= 0 ? r1(H.uv_index[hour]) : null,
    precipitation_probability: hour >= 0 ? H.precipitation_probability[hour] : null,
    temperature_unit: tu, pressure_unit: "hPa", wind_speed_unit: wu, precipitation_unit: "mm", visibility_unit: units.distance === "mi" ? "mi" : "km",
    attribution: "Weather data by Open-Meteo.com", supported_features: 3, glasshome_provider: "open_meteo",
  };
  return { state: ghsWmo(cu.weather_code, cu.is_day === 1), attributes, daily, hourly, updated: cu.time * 1000 };
}
// ------------------------------------------------------------------ bin collections
// Bin colours the dashboard can draw. The first four are the built-in bins; the rest cover other councils.
const GHS_BIN_COLOURS = {
  grey: { name: "Grey bin", short: "Grey", waste: "General Waste", main: "#8d929e", dark: "#4f5460", lid: "#6a6f7b", glow: "160,165,180" },
  blue: { name: "Blue bin", short: "Blue", waste: "Bottles", main: "#3b82f6", dark: "#1d4ea8", lid: "#2a62c9", glow: "59,130,246" },
  green: { name: "Green bin", short: "Green", waste: "Paper Waste", main: "#2fa864", dark: "#19663a", lid: "#22854d", glow: "47,168,100" },
  brown: { name: "Brown bin", short: "Brown", waste: "Garden Waste", main: "#9a6235", dark: "#5a371b", lid: "#7a4a25", glow: "180,115,60" },
  black: { name: "Black bin", short: "Black", waste: "General Waste", main: "#43464f", dark: "#1f2127", lid: "#2f323a", glow: "130,135,150" },
  purple: { name: "Purple bin", short: "Purple", waste: "Glass", main: "#8b5cf6", dark: "#5b21b6", lid: "#6d28d9", glow: "139,92,246" },
  red: { name: "Red bin", short: "Red", waste: "Recycling", main: "#e05252", dark: "#8f2424", lid: "#b83737", glow: "224,82,82" },
  yellow: { name: "Yellow bin", short: "Yellow", waste: "Recycling", main: "#e8c22e", dark: "#8f7414", lid: "#bf9d1f", glow: "232,194,46" },
  orange: { name: "Food caddy", short: "Food", waste: "Food Waste", main: "#f08a24", dark: "#99520c", lid: "#c46c14", glow: "240,138,36" },
  white: { name: "White bin", short: "White", waste: "Recycling", main: "#e8e6ef", dark: "#9a98a6", lid: "#c4c2cf", glow: "232,230,239" },
};
const GHS_BIN_BUILTIN = ["grey", "blue", "green", "brown"];
// What a council's words most often mean, when the entry does not name a colour
const GHS_BIN_WORDS = [
  [/\b(food|caddy|kitchen)\b/, "orange"],
  [/\b(garden|green waste|grass|brown)\b/, "brown"],
  [/\bglass\b/, "purple"],
  [/\b(paper|card|cardboard)\b/, "green"],
  [/\b(recycl\w*|plastics?|cans|tins|bottles|mixed|dry)\b/, "blue"],
  [/\b(refuse|rubbish|general|residual|landfill|household|non.?recyclable|domestic|waste)\b/, "grey"],
];
const ghsBinKey = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
// The bins a calendar entry means, e.g. "Recycling and garden waste" -> ["blue", "brown"]
function ghsBinGuess(text) {
  const t = ghsBinKey(text).replace(/green waste/g, "garden");
  const colours = Object.keys(GHS_BIN_COLOURS).filter((c) => new RegExp(`\\b${c === "grey" ? "gr[ae]y" : c}\\b`).test(t));
  if (colours.length) return colours;
  const out = [];
  for (const part of t.split(/\s*(?:\band\b|&|,|\+|\/|\bplus\b)\s*/)) {
    const hit = GHS_BIN_WORDS.find(([re]) => re.test(part));
    if (hit) out.push(hit[1]);
  }
  return [...new Set(out)];
}

const GHS_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ghsIso = (y, m, d) => {
  const Y = Number(y) < 100 ? 2000 + Number(y) : Number(y), M = Number(m), D = Number(d);
  if (!(M >= 1 && M <= 12 && D >= 1 && D <= 31 && Y >= 2000 && Y <= 2100)) return "";
  const dt = new Date(Date.UTC(Y, M - 1, D));
  return dt.getUTCMonth() === M - 1 ? dt.toISOString().slice(0, 10) : "";
};
// A date written the way councils write them: 2026-11-20, 20/11/2026, 20.11.26, "Fri 20 November 2026", "20th Nov 2026"
function ghsDateFromText(s, monthFirst = false) {
  const t = String(s || "").toLowerCase();
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (m) return ghsIso(m[1], m[2], m[3]);
  m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(t);
  if (m) return monthFirst ? ghsIso(m[3], m[1], m[2]) : ghsIso(m[3], m[2], m[1]);
  m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?,?\s+(\d{4})\b/.exec(t);
  if (m && GHS_MONTHS.includes(m[2].slice(0, 3))) return ghsIso(m[3], GHS_MONTHS.indexOf(m[2].slice(0, 3)) + 1, m[1]);
  m = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(t);
  if (m && GHS_MONTHS.includes(m[1].slice(0, 3))) return ghsIso(m[3], GHS_MONTHS.indexOf(m[1].slice(0, 3)) + 1, m[2]);
  return "";
}
const ghsAddDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ghsToday = (tz) => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); } };

// iCalendar (.ics) files, the "add to calendar" download most councils offer. Repeating entries
// (RRULE: daily, weekly or monthly, with INTERVAL, COUNT, UNTIL, BYDAY and EXDATE) are expanded.
// Returns { events: [{ date, summary }], skipped } for dates from `from` to `to`.
function ghsParseIcs(text, opts = {}) {
  const from = opts.from || ghsToday(opts.tz), to = opts.to || ghsAddDays(from, 730);
  const lines = String(text || "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const unesc = (v) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
  const day = (v, params) => {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v.trim());
    if (!m) return "";
    if (m[7] && opts.tz) { // a UTC time: the collection day is the local date
      try { return new Intl.DateTimeFormat("en-CA", { timeZone: opts.tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]))); } catch (e) { /* use the date as written */ }
    }
    return ghsIso(m[1], m[2], m[3]);
  };
  const out = [];
  let ev = null, skipped = 0;
  const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const finish = (e) => {
    if (!e.start || /CANCELLED/i.test(e.status || "")) return;
    const summary = e.summary || "Collection";
    const add = (d) => { if (d >= from && d <= to && !e.ex.includes(d)) out.push({ date: d, summary }); };
    if (!e.rrule) { add(e.start); return; }
    const R = Object.fromEntries(e.rrule.split(";").map((p) => p.split("=")).filter((p) => p.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
    const step = Math.max(1, Number(R.INTERVAL) || 1), count = Number(R.COUNT) || Infinity, until = R.UNTIL ? day(R.UNTIL) : to;
    if (!["DAILY", "WEEKLY", "MONTHLY"].includes(R.FREQ)) { skipped++; add(e.start); return; }
    const byday = R.BYDAY ? R.BYDAY.split(",").map((x) => DAYS.indexOf(x.slice(-2))).filter((x) => x >= 0) : [];
    let n = 0;
    for (let i = 0; n < count && i < 2000; i++) {
      let dates;
      if (R.FREQ === "DAILY") dates = [ghsAddDays(e.start, i * step)];
      else if (R.FREQ === "WEEKLY") {
        const wk = ghsAddDays(e.start, i * 7 * step);
        if (!byday.length) dates = [wk];
        else { const dow = new Date(`${wk}T12:00:00Z`).getUTCDay(); dates = byday.map((b) => ghsAddDays(wk, (b - dow + 7) % 7)).sort(); }
      } else {
        const s = new Date(`${e.start}T12:00:00Z`); s.setUTCMonth(s.getUTCMonth() + i * step);
        dates = [s.toISOString().slice(0, 10)];
      }
      let past = false;
      for (const d of dates) {
        if (d < e.start) continue;
        if (d > until || d > to) { past = true; break; }
        if (n++ >= count) break;
        add(d);
      }
      if (past) break;
    }
  };
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { ev = { ex: [] }; continue; }
    if (/^END:VEVENT/i.test(line)) { if (ev) finish(ev); ev = null; continue; }
    if (!ev) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const head = line.slice(0, i), val = line.slice(i + 1), name = head.split(";")[0].toUpperCase();
    if (name === "DTSTART") ev.start = day(val);
    else if (name === "SUMMARY") ev.summary = unesc(val);
    else if (name === "RRULE") ev.rrule = val.trim();
    else if (name === "EXDATE") ev.ex.push(...val.split(",").map((v) => day(v)).filter(Boolean));
    else if (name === "STATUS") ev.status = val;
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { events: out.slice(0, 1000), skipped };
}

// A spreadsheet saved as CSV, or text pasted from the council's page: one collection per line, with a
// date somewhere in it and the bins in the rest ("20/11/2026, Recycling" or "Friday 20 November 2026 - Garden waste")
function ghsParseCsv(text, opts = {}) {
  const from = opts.from || ghsToday(opts.tz), to = opts.to || ghsAddDays(from, 730);
  const out = [];
  let ignored = 0;
  for (const raw of String(text || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.match(/("([^"]|"")*"|[^,;\t]+)/g) || [];
    const clean = cells.map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"').trim()).filter(Boolean);
    let date = "", rest = [];
    for (const c of clean) {
      const d = !date && ghsDateFromText(c, opts.monthFirst);
      if (d) { date = d; const left = ghsKeyWithoutDate(c); if (left) rest.push(left); } else rest.push(c);
    }
    if (!date) { date = ghsDateFromText(line, opts.monthFirst); if (date) rest = [ghsKeyWithoutDate(line)]; }
    if (!date) { ignored++; continue; }
    const summary = rest.join(" ").replace(/^[\s\-–:|]+|[\s\-–:|]+$/g, "").trim() || "Collection";
    if (date >= from && date <= to) out.push({ date, summary });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { events: out.slice(0, 1000), ignored };
}
const ghsKeyWithoutDate = (s) => String(s)
  .replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?/gi, "")
  .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, "")
  .replace(/\b\d{1,2}(st|nd|rd|th)?\s+(of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+\d{4}\b/gi, "")
  .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(st|nd|rd|th)?,?\s+\d{4}\b/gi, "")
  .replace(/\s+/g, " ").replace(/^[\s\-–:|,]+|[\s\-–:|,]+$/g, "").trim();

// The different entries in a calendar, with how often each appears and what Glass Home thinks it is
function ghsBinSummaries(events, map = {}) {
  const by = new Map();
  for (const e of events || []) {
    const k = ghsBinKey(e.summary);
    if (!by.has(k)) by.set(k, { key: k, label: e.summary, count: 0, next: e.date });
    by.get(k).count++;
  }
  return [...by.values()].map((s) => ({ ...s, bins: map[s.key] || ghsBinGuess(s.label) }));
}
// Calendar entries -> bins.schedule ({ "YYYY-MM-DD": ["blue", ...] }); entries mapped to no bins are left out
function ghsBinsSchedule(events, map = {}) {
  const out = {};
  for (const e of events || []) {
    const k = ghsBinKey(e.summary), ids = (map[k] || ghsBinGuess(e.summary)).filter((id) => GHS_BIN_COLOURS[id]);
    if (!ids.length) continue;
    out[e.date] = [...new Set([...(out[e.date] || []), ...ids])];
  }
  return Object.fromEntries(Object.keys(out).sort().map((d) => [d, out[d]]));
}
// bins.types for the bins in use: colours the dashboard does not know, and your own names for them
function ghsBinTypes(ids, labels = {}, prev = {}) {
  const out = { ...prev };
  for (const id of new Set(ids)) {
    const l = labels[id] || {}, base = GHS_BIN_COLOURS[id];
    if (!base) continue;
    const named = (l.name && l.name !== base.name) || (l.waste && l.waste !== base.waste);
    if (GHS_BIN_BUILTIN.includes(id) && !named) continue;
    out[id] = { ...base, ...(l.name ? { name: String(l.name).slice(0, 40), short: String(l.short || l.name.replace(/\s*(bin|caddy|box|bag)$/i, "")).slice(0, 20) } : {}),
      ...(l.waste ? { waste: String(l.waste).slice(0, 40) } : {}) };
  }
  return out;
}

// ------------------------------------------------------------------ energy
// Who supplies your energy, and how Home Assistant can read it. Glass Home never talks to a supplier
// itself: the meter readings come from a Home Assistant integration, set up in Home Assistant.
const GHS_ENERGY_METHODS = {
  octopus: { name: "Octopus Energy integration", detail: "Reads your smart meter and tariff from your Octopus account (HACS integration, needs your Octopus API key)." },
  glow: { name: "Smart meter through Hildebrand Glow", detail: "Works with most UK smart meters, whoever the supplier: the free Bright app reads the meter through the national smart meter network, and the Hildebrand Glow (DCC) integration from HACS brings it into Home Assistant." },
  ha_energy: { name: "My Home Assistant Energy dashboard", detail: "Uses the meters you already chose in Home Assistant's own Energy dashboard." },
  other: { name: "Choose the sensors myself", detail: "Any integration, smart plug or clamp meter (for example Shelly EM, Emporia, Glow IHD over MQTT, or your supplier's own integration where one exists)." },
};
const GHS_SUPPLIERS = [
  ["octopus", "Octopus Energy", "octopus"], ["british_gas", "British Gas", "glow"], ["edf", "EDF", "glow"], ["eon", "E.ON Next", "glow"], ["ovo", "OVO", "glow"],
  ["scottish_power", "Scottish Power", "glow"], ["uw", "Utility Warehouse", "glow"], ["so", "So Energy", "glow"], ["ecotricity", "Ecotricity", "glow"],
  ["good_energy", "Good Energy", "glow"], ["other_uk", "Another UK supplier", "glow"], ["outside_uk", "A supplier outside the UK", "ha_energy"],
];
// The live / today / cost sensors chosen in Settings -> the Energy card's settings. A total meter
// (state_class total_increasing) also gives history; without a "today" sensor, Glass Home counts today
// from Home Assistant's statistics for that meter (sensor.glasshome_*_today, made in the browser).
function ghsEnergyFromMap(E = {}) {
  const side = (s = {}, kind) => {
    const o = {};
    for (const k of kind === "electricity" ? ["demand", "today_kwh", "today_cost", "rate", "standing"] : ["today_kwh", "today_cost", "rate", "standing"]) if (s[k]) o[k] = s[k];
    const meter = s.meter || o.today_kwh;
    if (meter) o.stat_kwh = meter;
    if (s.cost_meter || o.today_cost) o.stat_cost = s.cost_meter || o.today_cost;
    if (!o.today_kwh && s.meter) { o.today_kwh = `sensor.glasshome_${kind}_today`; o.today_from = s.meter; }
    return o;
  };
  const e = side(E.electricity, "electricity");
  if (!e.demand && !e.stat_kwh) return null;
  const out = { electricity: e };
  const g = side(E.gas, "gas");
  if (g.stat_kwh) out.gas = g;
  return out;
}
// Meters from Home Assistant's Energy dashboard (energy/get_prefs) -> suggested meters
function ghsEnergyFromPrefs(prefs) {
  const src = (prefs && prefs.energy_sources) || [];
  const grid = src.find((s) => s.type === "grid") || {};
  const from = (grid.flow_from || [])[0] || (grid.stat_energy_from ? grid : {});
  const gas = src.find((s) => s.type === "gas") || {};
  const ent = (id) => (id && /^sensor\.[a-z0-9_]+$/.test(id) ? id : "");
  return {
    electricity: { meter: ent(from.stat_energy_from), cost_meter: ent(from.stat_cost), rate: ent(from.entity_energy_price) },
    gas: { meter: ent(gas.stat_energy_from), cost_meter: ent(gas.stat_cost), rate: ent(gas.entity_energy_price) },
  };
}

// ------------------------------------------------------------------ floor plans
const GHS_PLAN_BOX = [4, 4, 668, 414]; // where a floor sits on the Plan page (drawing units, about 69 to the metre)
const ghsCentroid = (poly) => {
  const n = poly.length || 1;
  return [Math.round(poly.reduce((a, p) => a + p[0], 0) / n), Math.round(poly.reduce((a, p) => a + p[1], 0) / n)];
};
// Fill in anything a floor leaves out, so a plan drawn in the editor (or by hand) always draws
function ghsNormArch(arch) {
  if (!arch || typeof arch !== "object") return null;
  const num = (v) => Number.isFinite(+v);
  const rect = (r) => Array.isArray(r) && r.length === 4 && r.every(num);
  const out = {};
  for (const [fid, A0] of Object.entries(arch)) {
    if (!/^[a-z0-9_]{1,24}$/.test(fid) || !A0 || typeof A0 !== "object") continue;
    const A = A0;
    const rooms = (A.rooms || []).filter((r) => r && Array.isArray(r.poly) && r.poly.length >= 3 && r.poly.every((p) => p.length === 2 && p.every(num)))
      .map((r, i) => ({ ...r, id: r.id || `room${i + 1}`, name: String(r.name || ""), floor: r.floor || "oak", label: Array.isArray(r.label) && r.label.length === 2 ? r.label : ghsCentroid(r.poly) }));
    const walls = (A.walls || []).filter(rect), windows = (A.windows || []).filter(rect);
    const doors = (A.doors || []).filter((d) => d && Array.isArray(d.h) && num(d.r) && num(d.a0) && num(d.a1));
    out[fid] = {
      ...A, name: String(A.name || `${fid.replace(/_/g, " ").toUpperCase()} FLOOR`), rooms, walls, windows, doors,
      sliders: (A.sliders || []).filter((s) => s && rect(s.open) && Array.isArray(s.panes)),
      outline: Array.isArray(A.outline) && A.outline.length >= 3 ? A.outline : ghsOutlineFor(rooms, walls),
      stairs: A.stairs && rect(A.stairs.box) && Array.isArray(A.stairs.treads) && Array.isArray(A.stairs.centre) && Array.isArray(A.stairs.arrow) ? A.stairs : null,
    };
  }
  return Object.keys(out).length ? out : null;
}
// The building's outline: the box around its walls and rooms (or the whole frame when there are none)
function ghsOutlineFor(rooms = [], walls = []) {
  const xs = [], ys = [];
  for (const r of rooms) for (const [x, y] of r.poly) { xs.push(x); ys.push(y); }
  for (const [x0, y0, x1, y1] of walls) { xs.push(x0, x1); ys.push(y0, y1); }
  if (!xs.length) { const [a, b, c, d] = GHS_PLAN_BOX; return [[a, b], [c, b], [c, d], [a, d]]; }
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}
// A picture of the plan, fitted inside the frame without stretching
function ghsImageFit(w, h, box = GHS_PLAN_BOX) {
  const [x0, y0, x1, y1] = box, bw = x1 - x0, bh = y1 - y0, s = Math.min(bw / w, bh / h);
  const W = Math.round(w * s), H = Math.round(h * s);
  return { x: Math.round(x0 + (bw - W) / 2), y: Math.round(y0 + (bh - H) / 2), w: W, h: H };
}
// Only pictures the browser itself re-encoded are accepted (no SVG, no outside addresses)
const ghsSafeImage = (img) => !!(img && typeof img.src === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(img.src)
  && ["x", "y", "w", "h"].every((k) => Number.isFinite(+img[k])));
// @@MODEL-END

// ================================================================== demo mode
// glasshome: { demo: true } shows a fictional home so you can try Glass Home before configuring it.
// The demo entities (all named *.demo_*) exist only in this browser tab: they are added to the cards'
// view of Home Assistant, and any action on them is handled here and never sent to Home Assistant,
// so no real device can be switched by the demo. Standard cards that render Jinja templates on the
// server, and Home Assistant's own more-info dialog, cannot see demo entities.
const GH_DEMO_CONFIG = {
  household: { name: "The Demo Family" },
  features: {
    weather: true, lighting: true, climate: true, news: true, presence: true, heating_hive: false, energy: true, media: true, spotify: false,
    tv_power: true, cctv: true, laundry: true, bins: true, floorplan: true,
  },
  weather: { entity: "weather.demo_home" },
  lighting: {
    all: ["light.demo_lounge_lamp", "light.demo_hall_ceiling", "switch.demo_kitchen_strip", "switch.demo_desk_strip"],
    lights: ["light.demo_lounge_lamp", "switch.demo_desk_strip", "light.demo_hall_ceiling", "switch.demo_kitchen_strip"],
    power: [null, "sensor.demo_desk_strip_power", null, "sensor.demo_kitchen_strip_power"],
    status_only: ["light.demo_porch"],
  },
  rooms: [
    { name: "Lounge", icon: "mdi:sofa-outline", lights: ["light.demo_lounge_lamp", "switch.demo_desk_strip"],
      entities: ["light.demo_lounge_lamp", "switch.demo_desk_strip", "media_player.demo_lounge_tv", "sensor.demo_lounge_temperature"] },
    { name: "Hall", icon: "mdi:door", lights: ["light.demo_hall_ceiling"], entities: ["light.demo_hall_ceiling", "light.demo_porch"] },
    { name: "Kitchen", icon: "mdi:silverware-fork-knife", lights: ["switch.demo_kitchen_strip"], entities: ["switch.demo_kitchen_strip", "sensor.demo_kitchen_strip_power"] },
  ],
  scenes: Object.fromEntries(["bright", "relax", "evening", "night", "film", "all_off"].map((s) => [s, `scene.demo_${s}`])),
  climate: { thermostat: "climate.demo_lounge", temperature: "sensor.demo_lounge_temperature" },
  presence: { person: "person.demo_sam" },
  news: { todo: "todo.demo_news" },
  media: { tv: "media_player.demo_lounge_tv", tv_cast: "media_player.demo_lounge_tv", tv_remote: "remote.demo_lounge_tv", tv_power_script: "script.demo_tv_power" },
  cctv: { cameras: [{ entity: "camera.demo_front_door", name: "Front door" }, { entity: "camera.demo_back_garden", name: "Back garden" }] },
  energy: {
    electricity: { demand: "sensor.demo_electricity_demand", today_kwh: "sensor.demo_electricity_today", today_cost: "sensor.demo_electricity_cost",
      rate: "sensor.demo_electricity_rate", standing: "sensor.demo_electricity_standing", stat_kwh: "demo:electricity_kwh", stat_cost: "demo:electricity_cost" },
    gas: { today_kwh: "sensor.demo_gas_today", today_cost: "sensor.demo_gas_cost", rate: "sensor.demo_gas_rate", standing: "sensor.demo_gas_standing",
      stat_kwh: "demo:gas_kwh", stat_cost: "demo:gas_cost" },
    appliances: [{ name: "Kitchen strip", icon: "mdi:led-strip-variant", power: "sensor.demo_kitchen_strip_power" }],
  },
  laundry: {
    machine_state: "sensor.demo_washer_machine_state", job_state: "sensor.demo_washer_job_state",
    completion_time: "sensor.demo_washer_completion_time", power: "sensor.demo_washer_power", energy: "sensor.demo_washer_energy",
    water_consumption: "sensor.demo_washer_water_consumption", course: "select.demo_washer_course", spin_level: "select.demo_washer_spin_level",
    water_temperature: "select.demo_washer_water_temperature", rinse_cycles: "number.demo_washer_rinse_cycles",
    bubble_soak: "switch.demo_washer_bubble_soak", child_lock: "binary_sensor.demo_washer_child_lock",
    remote_control: "binary_sensor.demo_washer_remote_control", current_cycle: "input_text.demo_laundry_current_cycle",
    finished: "input_boolean.demo_laundry_finished", log: ["input_text.demo_laundry_log_1", "input_text.demo_laundry_log_2", "input_text.demo_laundry_log_3"],
  },
  bins: { rotation: { start: "2026-01-06", every_days: 7, pattern: [["grey"], ["blue", "green"]], weeks: 156 } },
};

function ghDemoStates() {
  const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
  const S = (state, attributes = {}) => ({ state: String(state), attributes, last_changed: iso(now - 3600e3), last_updated: iso(now - 600e3), context: { id: "demo" } });
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); return d.toISOString(); };
  const up = new Date().getHours() >= 7 && new Date().getHours() < 16;
  const st = {
    "sun.sun": S(up ? "above_horizon" : "below_horizon", { friendly_name: "Sun", next_rising: at(7, 14), next_setting: at(16, 21), elevation: up ? 18 : -12 }),
    "weather.demo_home": S("partlycloudy", { friendly_name: "Home", temperature: 14, temperature_unit: "°C", wind_speed: 12, humidity: 71, supported_features: 3 }),
    "light.demo_lounge_lamp": S("on", { friendly_name: "Lounge lamp", brightness: 180, supported_color_modes: ["brightness"], color_mode: "brightness" }),
    "light.demo_hall_ceiling": S("off", { friendly_name: "Hall ceiling", supported_color_modes: ["brightness"] }),
    "light.demo_porch": S("off", { friendly_name: "Porch light", supported_color_modes: ["onoff"] }),
    "switch.demo_kitchen_strip": S("on", { friendly_name: "Kitchen strip" }),
    "switch.demo_desk_strip": S("off", { friendly_name: "Desk strip" }),
    "sensor.demo_kitchen_strip_power": S("6.4", { friendly_name: "Kitchen strip power", unit_of_measurement: "W", device_class: "power" }),
    "sensor.demo_desk_strip_power": S("0", { friendly_name: "Desk strip power", unit_of_measurement: "W", device_class: "power" }),
    "sensor.demo_lounge_temperature": S("20.4", { friendly_name: "Lounge temperature", unit_of_measurement: "°C", device_class: "temperature" }),
    "climate.demo_lounge": S("heat", { friendly_name: "Lounge thermostat", current_temperature: 20.4, temperature: 21, hvac_action: "heating", hvac_modes: ["off", "heat"], min_temp: 5, max_temp: 30, target_temp_step: 0.5, supported_features: 385 }),
    "person.demo_sam": S("home", { friendly_name: "Sam" }),
    "media_player.demo_lounge_tv": S("playing", { friendly_name: "Lounge TV", media_title: "Nature documentary", volume_level: 0.3, is_volume_muted: false, supported_features: 152463 }),
    "remote.demo_lounge_tv": S("on", { friendly_name: "Lounge TV" }),
    "script.demo_tv_power": S("off", { friendly_name: "TV power (demo)" }),
    "camera.demo_front_door": S("idle", { friendly_name: "Front door" }),
    "camera.demo_back_garden": S("idle", { friendly_name: "Back garden" }),
    "todo.demo_news": S("0", { friendly_name: "Saved news (demo)" }),
    "sensor.demo_electricity_demand": S("412", { friendly_name: "Electricity demand", unit_of_measurement: "W", device_class: "power" }),
    "sensor.demo_electricity_today": S("6.2", { unit_of_measurement: "kWh" }),
    "sensor.demo_electricity_cost": S("1.84", { unit_of_measurement: "GBP" }),
    "sensor.demo_electricity_rate": S("0.245", { unit_of_measurement: "GBP/kWh" }),
    "sensor.demo_electricity_standing": S("0.52", { unit_of_measurement: "GBP" }),
    "sensor.demo_gas_today": S("18.5", { unit_of_measurement: "kWh" }),
    "sensor.demo_gas_cost": S("1.47", { unit_of_measurement: "GBP" }),
    "sensor.demo_gas_rate": S("0.063", { unit_of_measurement: "GBP/kWh" }),
    "sensor.demo_gas_standing": S("0.31", { unit_of_measurement: "GBP" }),
    "sensor.demo_washer_machine_state": S("run", { friendly_name: "Washing machine" }),
    "sensor.demo_washer_job_state": S("wash", { friendly_name: "Washing machine job" }),
    "sensor.demo_washer_completion_time": S(iso(now + 52 * 60e3), { device_class: "timestamp" }),
    "sensor.demo_washer_power": S("180", { unit_of_measurement: "W", device_class: "power" }),
    "sensor.demo_washer_energy": S("120.4", { unit_of_measurement: "kWh", device_class: "energy" }),
    "sensor.demo_washer_water_consumption": S("8820", { unit_of_measurement: "L" }),
    "select.demo_washer_course": S("cotton", { options: ["cotton", "eco_40_60", "quick_wash"] }),
    "select.demo_washer_spin_level": S("1200", { options: ["rinse_hold", "no_spin", "400", "800", "1000", "1200", "1400"] }),
    "select.demo_washer_water_temperature": S("40", { options: ["cold", "20", "30", "40", "60", "90"] }),
    "number.demo_washer_rinse_cycles": S("2", { min: 0, max: 5, step: 1 }),
    "switch.demo_washer_bubble_soak": S("off", {}),
    "binary_sensor.demo_washer_child_lock": S("off", {}),
    "binary_sensor.demo_washer_remote_control": S("on", {}),
    "input_text.demo_laundry_current_cycle": S(`${Math.floor(now / 1000) - 1800}|120.0|8790|40|1200|2|0`, {}),
    "input_boolean.demo_laundry_finished": S("off", {}),
    "input_text.demo_laundry_log_1": S("", {}), "input_text.demo_laundry_log_2": S("", {}), "input_text.demo_laundry_log_3": S("", {}),
  };
  for (const s of ["bright", "relax", "evening", "night", "film", "all_off"]) {
    st[`scene.demo_${s}`] = S(iso(now - 86400e3), { friendly_name: s.replace("_", " ").replace(/^./, (c) => c.toUpperCase()) });
  }
  // Home Assistant's own cards (tile, entity, more-info) read stateObj.entity_id
  for (const id of Object.keys(st)) st[id].entity_id = id;
  return st;
}

if (GH_DEMO) {
  const own = ghExploring ? {} : { ...GH_CFG }; // exploring: only the fictional home, never your own settings
  delete own.demo;
  GH_CFG = { ...GH_DEMO_CONFIG, ...own, features: { ...GH_DEMO_CONFIG.features, ...(own.features || {}) } };
  window.GlassHomeConfig = GH_CFG;
}
const GH_DEMO_STATES = GH_DEMO ? ghDemoStates() : {};
const GH_DEMO_TODO = [];
let GH_DEMO_VER = 0;
const GH_LIVE = new Set();
const ghIsDemo = (id) => typeof id === "string" && id in GH_DEMO_STATES;

// ================================================================== device data adapter
// Cards never talk to a data source directly: they get Home Assistant's hass object through ghHass(),
// which adds (1) the demo entities in demo mode, (2) virtual entities such as the built-in Open-Meteo
// weather, and (3) the names and icons chosen in setup (devices: in the settings). Actions on real
// entities go to Home Assistant unchanged; a failed one is reported on screen, never shown as done.
const GH_VSTATES = {};
const GH_VFORECAST = {};
const GH_VSUBS = new Set();
const GH_OVR = GH_CFG.devices && typeof GH_CFG.devices === "object" && !Array.isArray(GH_CFG.devices) ? GH_CFG.devices : {};
const ghIsVirtual = (id) => typeof id === "string" && id in GH_VSTATES;
const ghAdapting = () => GH_DEMO || Object.keys(GH_VSTATES).length > 0 || Object.keys(GH_OVR).length > 0;
function ghExtraStates(real) {
  const out = { ...real, ...GH_DEMO_STATES, ...GH_VSTATES };
  for (const [id, o] of Object.entries(GH_OVR)) {
    const st = out[id];
    if (!st || !o || (!o.name && !o.icon)) continue;
    out[id] = { ...st, attributes: { ...st.attributes, ...(o.name ? { friendly_name: String(o.name) } : {}), ...(o.icon ? { icon: String(o.icon) } : {}) } };
  }
  return out;
}
// tells every card that holds the adapted view that it changed
function ghAdapterChanged() {
  GH_DEMO_VER++;
  setTimeout(() => {
    GH_LIVE.forEach((el) => { if (!el.isConnected) GH_LIVE.delete(el); else if (el.__ghRealHass) el.hass = el.__ghRealHass; });
    GH_CTX_SUBS.forEach((s) => s.cb(ghExtraStates(s.real), s.unsub));
  }, 0);
}
function ghSetVirtual(id, state, forecasts) {
  GH_VSTATES[id] = state;
  if (forecasts) GH_VFORECAST[id] = forecasts;
  GH_VSUBS.forEach((sub) => { if (sub.id === id && forecasts && forecasts[sub.type]) sub.cb({ type: sub.type, forecast: forecasts[sub.type] }); });
  ghAdapterChanged();
}
// a real action that fails is said on screen (the card's own optimistic state is not trusted)
function ghReportFailure(domain, service, data, target, err) {
  const ids = ghIds(data, target);
  const st = (id) => (window.GlassHomeHassRoot && window.GlassHomeHassRoot.states[id]) || null;
  const name = ids.length === 1 ? ((GH_OVR[ids[0]] && GH_OVR[ids[0]].name) || ((st(ids[0]) || {}).attributes || {}).friendly_name || ids[0]) : ids.length ? `${ids.length} devices` : `${domain}.${service}`;
  const why = (err && (err.message || err.code)) || "no answer";
  ghToast(`Couldn't ${service.replace(/_/g, " ")} ${name}: ${why}`, "warn");
}
const ghIds = (data, target) => [].concat((data && data.entity_id) || [], (target && target.entity_id) || []);

// Applies an action to demo entities; returns true when every entity it names is a demo entity.
// demo mode: an action that isn't on a demo device is never sent to Home Assistant
function ghDemoBlocked(domain, service) {
  ghToast("Demo mode: nothing is sent to your real devices. Set up your own home to control them.", "warn");
  try { console.info("Glass Home demo: blocked", `${domain || "?"}.${service || "?"}`); } catch (e) { /* no console */ }
}
function ghDemoAction(domain, service, data = {}, target = {}) {
  const ids = ghIds(data, target);
  if (!ids.length || !ids.every(ghIsDemo)) return false;
  if (domain === "todo") return true;
  const nowIso = new Date().toISOString();
  let changed = false;
  for (const id of ids) {
    const old = GH_DEMO_STATES[id], s = { ...old, attributes: { ...old.attributes }, last_updated: nowIso };
    const flip = (on) => { s.state = on ? (id.startsWith("media_player.") ? "playing" : "on") : "off"; s.last_changed = nowIso; };
    if (service === "toggle") flip(s.state === "off");
    else if (service === "turn_on") { flip(true); if (data.brightness_pct != null) s.attributes.brightness = Math.round(data.brightness_pct * 2.55); if (data.brightness != null) s.attributes.brightness = data.brightness; }
    else if (service === "turn_off") flip(false);
    else if (service === "set_temperature" && data.temperature != null) s.attributes.temperature = data.temperature;
    else if (service === "set_hvac_mode" && data.hvac_mode) s.state = data.hvac_mode;
    else if (service === "select_option" && data.option != null) s.state = String(data.option);
    else if (service === "set_value" && data.value != null) s.state = String(data.value);
    else if (service === "volume_set" && data.volume_level != null) s.attributes.volume_level = data.volume_level;
    else if (service === "media_play_pause") s.state = s.state === "playing" ? "paused" : "playing";
    else if (service === "media_pause") s.state = "paused";
    else if (service === "media_play") s.state = "playing";
    if (s.state !== old.state || JSON.stringify(s.attributes) !== JSON.stringify(old.attributes)) { GH_DEMO_STATES[id] = s; changed = true; }
  }
  if (!changed) return true;
  ghAdapterChanged();
  return true;
}
// Newer Home Assistant cards read entity states from the "states" context instead of hass. In demo mode,
// on this dashboard only, the demo entities are added to what Home Assistant provides.
const GH_CTX_SUBS = new Set();
function ghStatesContext() {
  window.addEventListener("context-request", (e) => {
    if (e.context !== "states" || e.__gh || ghDashPath() !== GH_LOADED.path || typeof e.callback !== "function") return;
    e.__gh = true;
    const sub = { cb: e.callback, real: {}, unsub: undefined };
    e.callback = (value, unsub) => {
      sub.real = value || {};
      sub.unsub = unsub;
      if (e.subscribe) { if (GH_CTX_SUBS.size > 400) GH_CTX_SUBS.clear(); GH_CTX_SUBS.add(sub); }
      sub.cb(ghExtraStates(sub.real), unsub);
    };
  }, true);
  // Those cards also call actions through the shared connection: actions that name only demo
  // entities are handled here and never reach Home Assistant.
  const root = document.querySelector("home-assistant");
  const conn = root && root.hass && root.hass.connection;
  if (conn && !conn.__ghDemo) {
    conn.__ghDemo = true;
    const send = conn.sendMessagePromise.bind(conn);
    const demoCam = /^\/api\/camera_proxy(_stream)?\/(camera\.[a-z0-9_]+)/;
    conn.sendMessagePromise = (m) => {
      if (m && m.type === "call_service" && ghDemoAction(m.domain, m.service, m.service_data || {}, m.target || {})) return Promise.resolve({ context: { id: "demo" } });
      // on the Glass Home dashboard in demo mode nothing else is sent either (other dashboards are not affected)
      if (m && (m.type === "call_service" || m.type === "execute_script") && ghDashPath() === GH_LOADED.path) { ghDemoBlocked(m.domain, m.service); return Promise.resolve({ context: { id: "demo-blocked" } }); }
      // a demo camera has no picture on the server: show the Glass Home background instead
      const cam = m && m.type === "auth/sign_path" && demoCam.exec(m.path || "");
      if (cam && ghIsDemo(cam[2])) return Promise.resolve({ path: new URL(GH_ASSETS).pathname + "bg.svg?demo=camera" });
      return send(m);
    };
  }
}
function ghDemoForecast(type) {
  const now = Date.now();
  return Array.from({ length: type === "hourly" ? 12 : 6 }, (_, i) => ({
    datetime: new Date(now + i * (type === "hourly" ? 3600e3 : 86400e3)).toISOString(),
    condition: ["partlycloudy", "rainy", "sunny", "cloudy", "sunny", "rainy"][i % 6], temperature: [15, 12, 16, 13, 17, 11][i % 6],
    templow: [8, 7, 9, 6, 10, 6][i % 6], precipitation_probability: [10, 70, 0, 20, 5, 60][i % 6], precipitation: 0 }));
}

// Without demo, virtual entities or renames the cards get Home Assistant's own object, with only the
// failure report added to its actions
const GH_GUARDED = new WeakMap();
function ghGuard(h) {
  if (!h.callService) return h;
  const hit = GH_GUARDED.get(h);
  if (hit) return hit;
  const g = { ...h, callService: (domain, service, data, target) => h.callService(domain, service, data, target).catch((e) => { ghReportFailure(domain, service, data, target, e); throw e; }) };
  GH_GUARDED.set(h, g);
  return g;
}

// The cards' view of Home Assistant: the real object, plus the demo entities in demo mode
const GH_WRAPPED = new WeakMap();
function ghHass(h) {
  if (!h || !h.states || h.__ghDemo) return h;
  if (h.connection) window.GlassHomeHassRoot = h;
  if (!ghAdapting()) return ghGuard(h);
  const hit = GH_WRAPPED.get(h);
  if (hit && hit.ver === GH_DEMO_VER) return hit.hass;
  const realWS = (m) => h.callWS(m);
  const demoWS = async (m) => {
    const ids = m && m.type === "call_service" ? ghIds(m.service_data, m.target) : [];
    if (ids.length && m.domain === "todo" && ids.every(ghIsDemo)) {
      if (m.service === "add_item") GH_DEMO_TODO.push({ uid: String(Date.now()), summary: m.service_data.item, description: m.service_data.description || "", status: "needs_action" });
      if (m.service === "remove_item") { const k = GH_DEMO_TODO.findIndex((x) => x.uid === m.service_data.item || x.summary === m.service_data.item); if (k >= 0) GH_DEMO_TODO.splice(k, 1); }
      return { response: Object.fromEntries(ids.map((id) => [id, { items: [...GH_DEMO_TODO] }])) };
    }
    if (ids.length && ghDemoAction(m.domain, m.service, m.service_data, m.target)) return { context: { id: "demo" }, response: null };
    if (GH_DEMO && m && (m.type === "call_service" || m.type === "execute_script")) { ghDemoBlocked(m.domain, m.service); return { context: { id: "demo-blocked" }, response: null }; }
    return realWS(m);
  };
  const conn = h.connection && new Proxy(h.connection, {
    get(t, k) {
      if (k === "sendMessagePromise") return demoWS;
      if (k === "subscribeMessage") return (cb, m, opts) => {
        if (m && m.type === "weather/subscribe_forecast" && ghIsDemo(m.entity_id)) { setTimeout(() => cb({ type: m.forecast_type, forecast: ghDemoForecast(m.forecast_type) }), 30); return Promise.resolve(() => {}); }
        if (m && m.type === "weather/subscribe_forecast" && ghIsVirtual(m.entity_id)) {
          const sub = { id: m.entity_id, type: m.forecast_type, cb };
          GH_VSUBS.add(sub);
          const f = GH_VFORECAST[m.entity_id];
          if (f && f[m.forecast_type]) setTimeout(() => cb({ type: m.forecast_type, forecast: f[m.forecast_type] }), 0);
          return Promise.resolve(() => { GH_VSUBS.delete(sub); });
        }
        return t.subscribeMessage(cb, m, opts);
      };
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
  const hass = {
    ...h, __ghDemo: true, connection: conn, states: ghExtraStates(h.states),
    callService: (domain, service, data, target) => {
      if (ghDemoAction(domain, service, data, target)) return Promise.resolve({ context: { id: "demo" } });
      const ids = ghIds(data, target);
      if (ids.length && ids.some(ghIsVirtual)) { ghToast("This reading is worked out by Glass Home, so it can't be switched or changed", "warn"); return Promise.resolve({ context: { id: "virtual" } }); }
      if (GH_DEMO) { ghDemoBlocked(domain, service); return Promise.resolve({ context: { id: "demo-blocked" } }); }
      return h.callService(domain, service, data, target).catch((e) => { ghReportFailure(domain, service, data, target, e); throw e; });
    },
    callWS: demoWS,
  };
  GH_WRAPPED.set(h, { ver: GH_DEMO_VER, hass });
  return hass;
}
window.GlassHomeHass = ghHass;

// Every Glass Home card goes through ghHass (called once all cards are defined, at the end of this file)
function ghWrapCards() {
  for (const name of ["hero", "pager", "nav", "chip", "light", "room", "all", "heating", "energy", "spotify", "tv-power", "camera", "laundry", "washer",
    "bin", "bin-banner", "schedule", "house", "setup", "slot", "rooms", "onboarding"]) {
    const cls = customElements.get(`glasshome-${name}-card`);
    if (!cls || cls.__ghWrapped) continue;
    cls.__ghWrapped = true;
    const d = Object.getOwnPropertyDescriptor(cls.prototype, "hass");
    if (!d || !d.set) continue;
    Object.defineProperty(cls.prototype, "hass", {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set(v) {
        this.__ghRealHass = v;
        if (ghAdapting()) GH_LIVE.add(this);
        d.set.call(this, ghHass(v));
      },
    });
  }
  // Home Assistant's own cards placed directly in the Glass Home views (media control, tiles, buttons)
  // get the demo states through their hui-card / badge wrapper, on this dashboard only.
  const wrapHA = (name) => customElements.whenDefined(name).then(() => {
    const cls = customElements.get(name);
    if (!cls || cls.__ghWrapped) return;
    let proto = cls.prototype, d;
    while (proto && !(d = Object.getOwnPropertyDescriptor(proto, "hass"))) proto = Object.getPrototypeOf(proto);
    if (!d || !d.set) return;
    cls.__ghWrapped = true;
    Object.defineProperty(cls.prototype, "hass", {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set(v) {
        const demo = ghAdapting() && ghDashPath() === GH_LOADED.path;
        this.__ghRealHass = v;
        if (demo) GH_LIVE.add(this);
        d.set.call(this, demo ? ghHass(v) : v);
      },
    });
  });
  if (ghAdapting()) {
    for (const n of ["hui-card", "hui-badge", "hui-heading-badge", "ha-more-info-dialog"]) wrapHA(n);
    ghStatesContext();
  }
}


// ================================================================== built-in weather provider
// weather: { provider: open_meteo, place: { name, latitude, longitude } } in the settings gives the
// dashboard a weather entity (weather.glasshome_forecast) that exists only in the browser, filled from
// Open-Meteo (free, no key). The cards treat it like any Home Assistant weather entity. It refreshes every
// 15 minutes while the page is open; if Open-Meteo cannot be reached the last forecast stays, marked stale.
const GH_OM = GH_CFG.weather && GH_CFG.weather.provider === "open_meteo" && GH_CFG.weather.place && !GH_DEMO ? GH_CFG.weather.place : null;
if (GH_OM) {
  const units = { temperature: (GH_CFG.household || {}).temperature_unit === "°F" ? "°F" : "°C", distance: (GH_CFG.household || {}).distance_unit === "mi" ? "mi" : "km" };
  const id = GH_CFG.weather.entity || GHS_OM_ENTITY;
  const iso = () => new Date().toISOString();
  const base = { friendly_name: GH_OM.name || "Weather", attribution: "Weather data by Open-Meteo.com", supported_features: 3, glasshome_provider: "open_meteo",
    temperature_unit: units.temperature, wind_speed_unit: units.distance === "mi" ? "mph" : "km/h" };
  let last = null, fails = 0;
  // starts as "unknown" so cards wait for it instead of showing a setup box
  ghSetVirtual(id, { entity_id: id, state: "unknown", attributes: { ...base }, last_changed: iso(), last_updated: iso(), context: { id: "glasshome" } });
  const load = async () => {
    try {
      const r = await fetch(ghsOpenMeteoUrl(GH_OM, units), { cache: "no-store", referrerPolicy: "no-referrer", credentials: "omit" });
      if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`);
      const w = ghsOpenMeteoParse(await r.json(), GH_OM, units);
      const t = new Date(w.updated).toISOString();
      last = w;
      fails = 0;
      ghSetVirtual(id, { entity_id: id, state: w.state, attributes: w.attributes, last_changed: t, last_updated: t, context: { id: "glasshome" } }, { daily: w.daily, hourly: w.hourly });
    } catch (e) {
      fails++;
      console.warn("Glass Home: built-in weather could not be updated", e);
      if (last) ghSetVirtual(id, { entity_id: id, state: last.state, attributes: { ...last.attributes, glasshome_stale: true }, last_changed: iso(), last_updated: iso(), context: { id: "glasshome" } });
      else ghSetVirtual(id, { entity_id: id, state: "unavailable", attributes: { ...base, glasshome_error: String((e && e.message) || e) }, last_changed: iso(), last_updated: iso(), context: { id: "glasshome" } });
    }
  };
  load();
  // every 15 minutes; after failures back off (up to an hour); straight away when the screen wakes
  const next = () => setTimeout(async () => { await load(); next(); }, Math.min(60, 15 * 2 ** Math.min(fails, 2)) * 60e3);
  next();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && last && Date.now() - last.updated > 30 * 60e3) load(); });
}


// A dashboard with no settings yet (or a setup that was restarted) opens the welcome screen
const ghNeedsSetup = () => !GH_DEMO && (!GH_CFG_FOUND || ghEmpty(GH_LOADED.cfg) || !!(GH_LOADED.cfg.setup && GH_LOADED.cfg.setup.complete === false));
window.GlassHomeNeedsSetup = ghNeedsSetup;

// ================================================================== messages on screen
// One small glass message at the bottom of the screen: action failures, saves, demo notes. Read out by
// screen readers (role=status). Kept on document.body so it is above every card.
let ghToastEl = null, ghToastT = 0;
function ghToast(text, kind) {
  if (!document.body) return;
  if (!ghToastEl) {
    ghToastEl = document.createElement("div");
    ghToastEl.setAttribute("role", "status");
    ghToastEl.setAttribute("aria-live", "polite");
    ghToastEl.style.cssText = "position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:9999;max-width:min(560px,88vw);"
      + "transform:translate(-50%,12px);opacity:0;pointer-events:none;transition:opacity .25s ease,transform .25s ease;box-sizing:border-box;padding:11px 18px;"
      + "border-radius:18px;font:600 14px/1.35 -apple-system,BlinkMacSystemFont,'SF Pro Text',Roboto,'Segoe UI',sans-serif;color:#fff;text-align:center;"
      + "background:linear-gradient(155deg,rgba(255,255,255,.14),rgba(255,255,255,.04)),rgba(26,20,50,.92);border:1px solid rgba(255,255,255,.17);"
      + "box-shadow:0 16px 40px rgba(4,2,16,.5),inset 0 1px 0 rgba(255,255,255,.22)";
    document.body.append(ghToastEl);
  }
  ghToastEl.textContent = text;
  ghToastEl.style.borderColor = kind === "warn" ? "rgba(255,179,64,.6)" : "rgba(255,255,255,.17)";
  ghToastEl.style.opacity = "1";
  ghToastEl.style.transform = "translate(-50%,0)";
  clearTimeout(ghToastT);
  ghToastT = setTimeout(() => { ghToastEl.style.opacity = "0"; ghToastEl.style.transform = "translate(-50%,12px)"; }, kind === "warn" ? 6000 : 3000);
}
window.GlassHomeToast = ghToast;

// ================================================================== demo flag
// In demo mode a small label stays at the top of the Glass Home dashboard, so simulated devices can
// never be mistaken for real ones. Exploring from the welcome screen adds "Set up my home" and "Exit".
function ghDemoFlag() {
  if (!GH_DEMO || document.getElementById("glasshome-demo-flag")) return;
  const el = document.createElement("div");
  el.id = "glasshome-demo-flag";
  if (!document.getElementById("glasshome-demo-flag-css")) {
    const css = document.createElement("style");
    css.id = "glasshome-demo-flag-css";
    css.textContent = "@media (max-width:599px){#glasshome-demo-flag{top:auto!important;bottom:calc(92px + env(safe-area-inset-bottom,0px))!important}}";
    document.head.append(css);
  }
  el.setAttribute("role", "note");
  el.style.cssText = "position:fixed;top:calc(6px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:9998;display:flex;align-items:center;gap:8px;"
    + "padding:4px 6px 4px 12px;border-radius:14px;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,'SF Pro Text',Roboto,'Segoe UI',sans-serif;color:#ddd6fe;"
    + "background:rgba(18,13,34,.86);border:1px solid rgba(167,139,250,.45);box-shadow:0 6px 18px rgba(4,2,16,.4);white-space:nowrap;max-width:94vw";
  const btn = "border:1px solid rgba(255,255,255,.16);background:rgba(139,92,246,.32);color:#fff;font:inherit;border-radius:10px;padding:4px 10px;cursor:pointer;min-height:28px";
  el.innerHTML = `<span>Demo · simulated devices</span>${ghExploring ? `<button type="button" data-a="setup" style="${btn}">Set up my home</button><button type="button" data-a="exit" style="${btn};background:rgba(255,255,255,.08)">Exit demo</button>` : ""}`;
  el.addEventListener("click", (e) => {
    const a = e.target.closest("button") && e.target.closest("button").dataset.a;
    if (!a) return;
    try { sessionStorage.removeItem(GH_EXPLORE_KEY); } catch (err) { /* private window */ }
    location.href = a === "setup" ? `${ghBase()}/welcome` : `${ghBase()}/home`;
  });
  const sync = () => { el.style.display = ghDashPath() === GH_LOADED.path ? "flex" : "none"; };
  window.addEventListener("location-changed", sync);
  window.addEventListener("popstate", sync);
  sync();
  document.body.append(el);
}
if (GH_DEMO) { if (document.body) setTimeout(ghDemoFlag, 0); else window.addEventListener("DOMContentLoaded", ghDemoFlag); }

// Feature switches: features.<name> in the config; these are the defaults
const GH_FEATURES = {
  weather: true, lighting: true, climate: true, news: true, presence: false, heating_hive: false, energy: false, media: false,
  spotify: false, music: false, tv_power: false, cctv: false, laundry: false, bins: false, floorplan: false,
};
const ghFeature = (name) => {
  if (!name) return true;
  if (Array.isArray(name)) return name.every(ghFeature);
  if (name.includes("|")) return name.split("|").some(ghFeature);
  if (name[0] === "!") return !ghFeature(name.slice(1));
  const f = { ...GH_FEATURES, ...(GH_CFG.features || {}) };
  return name in f ? !!f[name] : true;
};
const GH_TZ = (GH_CFG.household && GH_CFG.household.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const GH_LOCALE = (GH_CFG.household && GH_CFG.household.locale) || navigator.language || "en-GB";
// The clock follows household.timezone (else the device's zone) and household.clock (24 or 12)
const GH_CLOCK12 = String((GH_CFG.household || {}).clock) === "12";
// hours and minutes in the household's clock style (toLocaleTimeString options)
const GH_HM = { hour: GH_CLOCK12 ? "numeric" : "2-digit", minute: "2-digit", hour12: GH_CLOCK12 };
// money in the household's currency: ghMoney(1.5) -> "£1.50" / "1,50 €"; unit rates in pence or cents for GBP, EUR and USD
function ghCurrency() { const c = String((GH_CFG.household || {}).currency || "GBP").toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : "GBP"; }
function ghMoney(n, dp = 2) {
  if (n == null || isNaN(n)) return "–";
  try { return new Intl.NumberFormat(GH_LOCALE, { style: "currency", currency: ghCurrency(), minimumFractionDigits: dp, maximumFractionDigits: dp }).format(n); }
  catch (e) { return `${ghCurrency()} ${Number(n).toFixed(dp)}`; }
}
function ghCurrencySign() {
  try { const p = new Intl.NumberFormat(GH_LOCALE, { style: "currency", currency: ghCurrency() }).formatToParts(1).find((x) => x.type === "currency"); return p ? p.value : ghCurrency(); }
  catch (e) { return ghCurrency(); }
}
function ghRate(n) {
  if (n == null || isNaN(n)) return "–";
  const sub = { GBP: "p", EUR: "c", USD: "¢" }[ghCurrency()];
  return sub ? `${(n * 100).toFixed(2)}${sub}` : ghMoney(n, 4);
}
function ghTax() { const c = ghCurrency(); return ["AUD", "NZD", "INR", "SGD", "CAD"].includes(c) ? (c === "CAD" ? "tax" : "GST") : c === "USD" ? "tax" : "VAT"; }
function ghCurrencyIcon() { return { GBP: "currency-gbp", EUR: "currency-eur", USD: "currency-usd", JPY: "currency-jpy", INR: "currency-inr", CHF: "currency-fra" }[ghCurrency()] || "cash"; }
// a page's name in the bottom bar: your own (navigation.titles), else the Media page takes the music service's name
function ghPageTitle(id, fallback) {
  const t = GH_CFG.navigation && GH_CFG.navigation.titles && GH_CFG.navigation.titles[id];
  if (typeof t === "string" && t.trim()) return t.trim().slice(0, 16);
  if (id === "media") { const m = ghMusicName(); if (m) return m; }
  return fallback;
}
function ghMusicName() {
  const M = (GH_CFG.media || {}).music || {};
  const names = { spotify: "Spotify", apple_music: "Apple Music", music_assistant: "Music", other: "Music" };
  if (M.service && M.service !== "spotify" && M.player && ghFeature("music")) return names[M.service] || "Music";
  if (ghFeature("spotify") && (GH_CFG.media || {}).spotify) return "Spotify";
  return "";
}
// what the Media page offers, for its header
function ghMediaSub() {
  const parts = [];
  const m = ghMusicName();
  if (m) parts.push(m === "Music" ? "Your music" : m);
  if (ghFeature("media") && (GH_CFG.media || {}).tv) parts.push("TV controls");
  if (ghFeature("lighting") && (GH_CFG.scenes || {}).film) parts.push("mood lighting");
  return parts.join(" · ");
}
function ghTimeParts(d = new Date()) {
  try {
    const p = {};
    for (const x of new Intl.DateTimeFormat("en-GB", { timeZone: GH_TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d)) p[x.type] = x.value;
    return { h: Number(p.hour) % 24, m: Number(p.minute) };
  } catch (e) { return { h: d.getHours(), m: d.getMinutes() }; }
}
const ghClockText = (t) => (GH_CLOCK12 ? `${t.h % 12 || 12}:${String(t.m).padStart(2, "0")}` : `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}`);
// "Good morning, James" (household.greeting); the older household.name form reads "Morning, The Smiths"
function ghGreeting(part, family) {
  const hh = GH_CFG.household || {};
  if (hh.show_greeting === false) return "";
  const good = `Good ${part === "night" ? "evening" : part}`;
  if (hh.greeting) return `${good}, ${hh.greeting}`;
  const who = family || hh.name || "";
  return who ? `${part[0].toUpperCase() + part.slice(1)}, ${who}` : good;
}
// The dashboard's own address (works whatever url_path it was installed under)
const ghBase = () => `/${(location.pathname.split("/")[1] || "glass-home")}`;

// [[path.to.value]] tokens: a token that is the whole value takes the configured value as it is
// (text, number, list or object); a token inside text is replaced by the text value.
// [[?path]] is optional: when it is not configured the setting is simply left out (or empty in text).
// [[path|json]] inside text writes the value as JSON (for lists in Jinja templates).
const GH_TOKEN = /\[\[\s*(\??)([A-Za-z0-9_.-]+)(\|json)?\s*\]\]/g;
const GH_WHOLE = /^\s*\[\[\s*(\??)([A-Za-z0-9_.-]+)\s*\]\]\s*$/;
const GH_ENTITY = /^[a-z_]+\.[a-z0-9_]+$/;
const GH_DROP = Symbol("drop");
const ghGet = (path) => (path === "_page.media_sub" ? ghMediaSub() : path.startsWith("_page.") ? ghPageTitle(path.slice(6), path.slice(6).replace(/^./, (c) => c.toUpperCase()))
  : path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), GH_CFG));
const ghEmpty = (v) => v == null || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
const ghEntitiesIn = (v, out) => {
  if (typeof v === "string") { if (GH_ENTITY.test(v)) out.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => ghEntitiesIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => ghEntitiesIn(x, out));
  return out;
};
function ghResolve(value, missing, used) {
  if (typeof value === "string") {
    const whole = GH_WHOLE.exec(value);
    if (whole) {
      const v = ghGet(whole[2]);
      if (ghEmpty(v)) { if (whole[1]) return GH_DROP; missing.push(whole[2]); return value; }
      ghEntitiesIn(v, used);
      return JSON.parse(JSON.stringify(v));
    }
    return value.replace(GH_TOKEN, (m, opt, p, json) => {
      const v = ghGet(p);
      if (json) { if (ghEmpty(v) && !opt) { missing.push(p); return m; } ghEntitiesIn(v, used); return JSON.stringify(ghEmpty(v) ? [] : v); }
      if (ghEmpty(v) || typeof v === "object") { if (opt && ghEmpty(v)) return ""; missing.push(p); return m; }
      ghEntitiesIn(String(v), used);
      return String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => ghResolve(v, missing, used)).filter((v) => v !== GH_DROP);
  if (value && typeof value === "object") {
    const o = {};
    for (const [k, v] of Object.entries(value)) { const r = ghResolve(v, missing, used); if (r !== GH_DROP) o[k] = r; }
    return o;
  }
  return value;
}
// What a card needs before it is drawn: off (feature switched off, or an optional card that is not
// configured), or ready, or what is missing. feature: "!name" means "only while name is switched off".
function ghPrepare(raw, hass) {
  if (!raw || typeof raw !== "object") return { ready: true, cfg: raw };
  if (!ghFeature(raw.feature)) return { off: true };
  // unless: a config path; the card shows only while that path is still empty (used for setup prompts)
  if (raw.unless && !ghEmpty(ghGet(raw.unless))) return { off: true };
  // demo: false hides a card in demo mode (cards that read the whole house, not the configured entities)
  if (raw.demo === false && GH_DEMO) return { off: true };
  const missing = [], used = [];
  const cfg = ghResolve(raw, missing, used);
  delete cfg.feature;
  delete cfg.setup_label;
  delete cfg.optional;
  delete cfg.unless;
  delete cfg.demo;
  if (raw.optional && missing.length) return { off: true };
  const absent = hass && hass.states ? [...new Set(used)].filter((id) => !hass.states[id]) : [];
  return { ready: !missing.length && !absent.length, cfg, missing: [...new Set(missing)], absent };
}
const ghPlaceholderConfig = (raw, prep) => ({
  type: "custom:glasshome-setup-card",
  label: raw.setup_label || raw.name || raw.title || raw.heading || "",
  missing: prep.missing || [],
  absent: prep.absent || [],
});


/*
 * Glass Home House card: an interactive 2D (bird's-eye) floor plan for Home Assistant.
 *
 *   type: custom:glasshome-house-card
 *   plan_key: glasshome_floorplan        # optional: where furniture and device positions are saved
 *   tap_paths:                           # optional: entity -> dashboard path, offered from the device panel
 *     climate.living_room: /glass-home/home#climate
 *
 * The walls, doors, windows and stairs come from floorplan.arch in the glasshome: settings. Without one, a
 * fictional sample two-storey plan is shown (see docs/floorplan.md for the format). Normal mode: tap a
 * device for its live status and controls. Edit mode: arrange furniture and position devices. Each floor
 * is saved separately in Home Assistant (frontend system data, falling back to per-user data, then this browser).
 */
const WHC_VERSION = "2.0.0";

// Liquid Glass: one set of tokens for every GlassHome card. The glasshome_home theme defines them as
// --lg-* (so the theme, card-mod and these cards share one look); the values here are the same and
// are only the fallback when the theme is not applied.
//   Cards (resting surfaces): a frosted fill with a bright top-left rim, a faint lower rim and a soft
//   ambient shadow. No backdrop-filter: nothing moves behind a card, and blurring behind every card
//   is too slow for low-power tablets while swiping.
//   Floating layers (nav bar, sheets, panels, toasts): thinner glass with a real backdrop blur, because
//   content does pass behind them. Browsers without backdrop-filter get a denser fill (LG_NOBLUR).
const LG_FILL = "linear-gradient(150deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 34%, rgba(255,255,255,0.02) 62%, rgba(255,255,255,0.05) 100%), rgba(30,23,56,0.56)";
const LG_SHADOW = "inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(255,255,255,0.05), inset 0 0 14px rgba(255,255,255,0.025), 0 8px 24px rgba(6,3,20,0.30)";
const GLASS_BG = `var(--lg-fill, ${LG_FILL})`;
const GLASS_LINE = "var(--lg-border, rgba(255,255,255,0.14))";
const GLASS_BORDER = `1px solid ${GLASS_LINE}`;
const GLASS_EDGE = `var(--lg-shadow, ${LG_SHADOW})`;
const LG_FLOAT_BG = "var(--lg-float-fill, linear-gradient(155deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 45%, rgba(255,255,255,0.07) 100%), rgba(26,20,50,0.60))";
const LG_FLOAT_LINE = "var(--lg-float-border, rgba(255,255,255,0.17))";
const LG_FLOAT_SHADOW = "var(--lg-float-shadow, 0 16px 40px rgba(4,2,16,0.50), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(255,255,255,0.06))";
const LG_FLOAT_BLUR = "var(--lg-float-blur, blur(22px) saturate(175%))";
// the lit "current / on" capsule used by the nav bars
const LG_ON_BG = "linear-gradient(155deg, rgba(167,139,250,0.78) 0%, rgba(124,58,237,0.50) 55%, rgba(109,40,217,0.42) 100%)";
const LG_ON_SHADOW = "0 0 20px rgba(139,92,246,0.38), inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -1px 0 rgba(255,255,255,0.08)";
// floating glass declarations for a selector, plus the denser fill where blur is unsupported
const lgFloat = (blur = LG_FLOAT_BLUR) => `background: ${LG_FLOAT_BG}; border: 1px solid ${LG_FLOAT_LINE}; box-shadow: ${LG_FLOAT_SHADOW}; -webkit-backdrop-filter: ${blur}; backdrop-filter: ${blur};`;
const LG_NOBLUR = (sel) => `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { ${sel} { background: linear-gradient(155deg, rgba(255,255,255,0.09), rgba(255,255,255,0.03)), rgba(24,18,44,0.96); } }`;
// Shared micro-interactions, adopted into every GlassHome card's shadow root (see the end of the file).
// :where() keeps these at zero specificity, so any card's own rule still wins.
const LG_SHARED_CSS = `
  :where(button) { transition: transform 0.14s cubic-bezier(0.2, 0.8, 0.2, 1), background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease, opacity 0.2s ease; }
  :where(button):active { transform: scale(0.96); }
  :where(button, [role="button"]):focus-visible { outline: 2px solid rgba(190,160,255,0.85); outline-offset: 2px; }
  @media (hover: hover) { :where(button):hover { filter: brightness(1.08); } }
  :where(ha-card) { transition: background-color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, transform 0.14s cubic-bezier(0.2, 0.8, 0.2, 1); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: 0.01ms !important; }
    :where(button):active, :where(ha-card):active { transform: none; }
  }`;
const PURPLE = "167,139,250";
// Status colours: green connected/secure, purple active, amber heating, grey idle/off, red genuine problems
const STATUS = { green: "52,211,153", purple: PURPLE, amber: "255,179,64", grey: "142,138,160", red: "255,107,107" };

// The hero clock's typeface: Space Grotesk, self-hosted beside this file (no outside requests). Until
// it has loaded, or if it is missing, the clock uses the next font in its stack.
try {
  if (window.FontFace && document.fonts && !window.__glasshomeClockFont) {
    window.__glasshomeClockFont = true;
    const f = new FontFace("Space Grotesk", `url("${GH_ASSETS}fonts/SpaceGrotesk-latin.woff2") format("woff2")`, { weight: "300 700", display: "swap" });
    document.fonts.add(f);
    f.load().catch(() => {});
  }
} catch (e) { /* the clock falls back to the system font */ }

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ------------------------------------------------------------------ architecture
// Units are the drawings' own pixels: 69.1 px = 1 m, and both drawings share one frame so the floors
// line up. Walls are [x0, y0, x1, y1] solid runs with the windows in their gaps. Doors: hinge, leaf
// length, a0 = the open leaf as drawn, a1 = its closed position (degrees: 0 east, 90 south, 180 west, 270 north).
const PX_M = 69.1;
const ORG = [4, 4]; // outer top-left corner of the house; saved positions are centimetres from here
const toPx = (cm, axis) => ORG[axis] + (cm * PX_M) / 100;
const toCm = (px, axis) => Math.round(((px - ORG[axis]) * 1000) / PX_M) / 10;
// The frame has room under the house for the device panel and edit drawer. A plan of your own goes in
// floorplan.arch in the glasshome: settings (same shape as SAMPLE_ARCH below; see docs/floorplan.md).
// SAMPLE_ARCH is a fictional two-storey home, used only until you add your own.
const VIEW = { x: -6, y: -22, w: 680, h: 618 };

const SAMPLE_ARCH = {
  ground: {
    name: "GROUND FLOOR",
    outline: [[4, 4], [668, 4], [668, 414], [4, 414]],
    rooms: [
      { id: "living", name: "Living Room", dims: "4.10 × 5.50 m", floor: "oak", poly: [[19, 19], [300, 19], [300, 399], [19, 399]], label: [110, 200] },
      { id: "hall", name: "Hall", dims: "", floor: "oak", poly: [[307, 19], [400, 19], [400, 399], [307, 399]], label: [326, 120] },
      { id: "kitchen", name: "Kitchen", dims: "3.55 × 3.35 m", floor: "stone", poly: [[407, 19], [653, 19], [653, 250], [407, 250]], label: [490, 150] },
      { id: "utility", name: "Utility", dims: "", floor: "tile", poly: [[407, 257], [653, 257], [653, 399], [407, 399]], label: [490, 320], small: true },
    ],
    walls: [
      [4, 4, 80, 19], [220, 4, 470, 19], [600, 4, 668, 19],
      [4, 4, 19, 414], [653, 4, 668, 414],
      [4, 399, 90, 414], [230, 399, 330, 414], [384, 399, 668, 414],
      [300, 19, 307, 150], [300, 202, 307, 399],
      [400, 19, 407, 60], [400, 112, 407, 300], [400, 352, 407, 399],
      [407, 250, 653, 257],
    ],
    windows: [[80, 4, 220, 19], [470, 4, 600, 19], [90, 399, 230, 414]],
    sliders: [],
    doors: [
      { h: [332, 406], r: 50, a0: 270, a1: 0 },
      { h: [303, 152], r: 48, a0: 180, a1: 90 },
      { h: [403, 62], r: 48, a0: 0, a1: 90 },
      { h: [403, 302], r: 48, a0: 0, a1: 90 },
    ],
    stairs: {
      box: [315, 210, 392, 380], treads: [244, 278, 312, 346], centre: [353, 212, 353, 378],
      arrow: [[340, 226], [353, 214], [366, 226]], brk: null,
    },
  },
  first: {
    name: "FIRST FLOOR",
    outline: [[4, 4], [668, 4], [668, 414], [4, 414]],
    rooms: [
      { id: "bed1", name: "Bedroom 1", dims: "4.10 × 3.35 m", floor: "carpet", poly: [[19, 19], [300, 19], [300, 250], [19, 250]], label: [110, 135] },
      { id: "bed2", name: "Bedroom 2", dims: "4.10 × 2.05 m", floor: "carpet", poly: [[19, 257], [300, 257], [300, 399], [19, 399]], label: [110, 330] },
      { id: "landing", name: "Landing", dims: "", floor: "oak", poly: [[307, 19], [400, 19], [400, 399], [307, 399]], label: [318, 120] },
      { id: "bathroom", name: "Bathroom", dims: "3.55 × 2.60 m", floor: "tile", poly: [[407, 19], [653, 19], [653, 200], [407, 200]], label: [470, 140] },
      { id: "bed3", name: "Bedroom 3", dims: "3.55 × 2.80 m", floor: "carpet", poly: [[407, 207], [653, 207], [653, 399], [407, 399]], label: [490, 300] },
    ],
    walls: [
      [4, 4, 80, 19], [220, 4, 470, 19], [600, 4, 668, 19],
      [4, 4, 19, 414], [653, 4, 668, 414],
      [4, 399, 90, 414], [230, 399, 470, 414], [600, 399, 668, 414],
      [300, 19, 307, 150], [300, 198, 307, 300], [300, 348, 307, 399],
      [19, 250, 300, 257],
      [400, 19, 407, 60], [400, 108, 407, 300], [400, 348, 407, 399],
      [407, 200, 653, 207],
    ],
    windows: [[80, 4, 220, 19], [470, 4, 600, 19], [90, 399, 230, 414], [470, 399, 600, 414]],
    sliders: [],
    doors: [
      { h: [303, 151], r: 46, a0: 180, a1: 90 },
      { h: [303, 301], r: 46, a0: 180, a1: 90 },
      { h: [403, 61], r: 46, a0: 0, a1: 90 },
      { h: [403, 301], r: 46, a0: 0, a1: 90 },
    ],
    stairs: {
      box: [315, 210, 392, 380], treads: [244, 278, 312, 346], centre: [353, 212, 353, 378], edge: [313, 380, 394, 383],
      arrow: [[340, 226], [353, 214], [366, 226]], brk: null,
    },
  },
};
const SAMPLE_FITTINGS = {
  ground: [
    ["worktop", 465, 37, 110, 36, 0], ["sink", 550, 37, 60, 36, 0], ["hob", 612, 37, 66, 36, 0],
    ["washing_machine", 625, 378, 41, 41, 180],
  ],
  first: [
    ["bath", 500, 41, 98, 44, 0], ["basin", 575, 29.5, 30, 21, 0], ["toilet", 625, 43.5, 27, 49, 0],
  ],
};
const ARCH = ghsNormArch(GH_CFG.floorplan && GH_CFG.floorplan.arch) || SAMPLE_ARCH;
const FLOOR_IDS = Object.keys(ARCH);
const FLOOR_NAMES = Object.fromEntries(FLOOR_IDS.map((f) => [f, ARCH[f].name || `${f.toUpperCase()} FLOOR`]));

const pts = (p) => p.map(([x, y]) => `${x},${y}`).join(" ");
const rad = (a) => (a * Math.PI) / 180;
const inPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Solid floor colours: no textures, blur or shadows, so the tablet paints the plan cheaply
const FLOOR_FILL = { oak: "#d9b88f", stone: "#e4dbcd", tile: "#ebe8e3", carpet: "#d8cbb8" };

// Floors, room fills and stairs (drawn under the furniture)
function archFloorDrawn(fid) {
  const A = ARCH[fid], out = [];
  out.push(`<polygon points="${pts(A.outline)}" fill="#cdb89c"/>`);
  for (const r of A.rooms) out.push(`<polygon points="${pts(r.poly)}" fill="${FLOOR_FILL[r.floor] || "#d8cbb8"}"/>`);
  const s = A.stairs, [bx0, by0, bx1, by1] = s.box;
  out.push(`<rect x="${bx0}" y="${by0}" width="${bx1 - bx0}" height="${by1 - by0}" fill="#c9a77e" stroke="#5c4a3a" stroke-width="1.2"/>`);
  const st = [`M${s.centre[0]} ${s.centre[1]}V${s.centre[3]}`, ...s.treads.map((y) => `M${bx0} ${y}H${bx1}`), `M${pts(s.arrow).replace(/ /g, " L")}`];
  out.push(`<path d="${st.join("")}" stroke="#5c4a3a" stroke-width="1.1" fill="none" stroke-linejoin="round"/>`);
  if (s.brk) out.push(`<polyline points="${pts(s.brk)}" stroke="#5c4a3a" stroke-width="1.1" fill="none"/>`);
  if (s.edge) out.push(`<rect x="${s.edge[0]}" y="${s.edge[1]}" width="${s.edge[2] - s.edge[0]}" height="${s.edge[3] - s.edge[1]}" fill="#5c4a3a"/>`);
  return out.join("");
}

// Walls, windows and doors (drawn over the furniture, so pieces pushed against a wall sit neatly)
function archStructure(fid) {
  const A = ARCH[fid], out = [];
  const wall = (w, fill, dx = 0, dy = 0) => `<rect x="${w[0] + dx}" y="${w[1] + dy}" width="${w[2] - w[0]}" height="${w[3] - w[1]}" fill="${fill}"/>`;
  out.push(A.walls.map((w) => wall(w, "#2f2b36")).join(""));
  for (const [x0, y0, x1, y1] of A.windows) {
    const horiz = x1 - x0 > y1 - y0, m = horiz ? (y0 + y1) / 2 : (x0 + x1) / 2;
    out.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#f4f8fb" stroke="#2f2b36" stroke-width="1.2"/>`
      + `<rect x="${horiz ? x0 + 1.5 : m - 2}" y="${horiz ? m - 2 : y0 + 1.5}" width="${horiz ? x1 - x0 - 3 : 4}" height="${horiz ? 4 : y1 - y0 - 3}" fill="#9fd3f0"/>`
      + `<path d="${horiz ? `M${x0} ${m}H${x1}` : `M${m} ${y0}V${y1}`}" stroke="#4b8fb8" stroke-width="0.8"/>`);
  }
  for (const sl of A.sliders) {
    const [x0, y0, x1, y1] = sl.open;
    out.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#f4f8fb"/>`);
    for (const p of sl.panes) out.push(`<rect x="${p[0]}" y="${p[1]}" width="${p[2] - p[0]}" height="${p[3] - p[1]}" fill="#9fd3f0" stroke="#2f2b36" stroke-width="1.1"/>`);
  }
  for (const d of A.doors) {
    const [hx, hy] = d.h, ox = (hx + d.r * Math.cos(rad(d.a0))).toFixed(1), oy = (hy + d.r * Math.sin(rad(d.a0))).toFixed(1);
    const cx = (hx + d.r * Math.cos(rad(d.a1))).toFixed(1), cy = (hy + d.r * Math.sin(rad(d.a1))).toFixed(1);
    const sweep = ((d.a1 - d.a0 + 360) % 360) < 180 ? 0 : 1;
    out.push(`<path d="M${hx} ${hy}L${cx} ${cy}A${d.r} ${d.r} 0 0 ${sweep} ${ox} ${oy}Z" fill="rgba(255,255,255,0.22)"/>`
      + `<path d="M${cx} ${cy}A${d.r} ${d.r} 0 0 ${sweep} ${ox} ${oy}" fill="none" stroke="#6b5a49" stroke-width="0.9" stroke-dasharray="3 2.5"/>`
      + `<line x1="${hx}" y1="${hy}" x2="${ox}" y2="${oy}" stroke="#8a6440" stroke-width="3" stroke-linecap="round"/><circle cx="${hx}" cy="${hy}" r="2" fill="#2f2b36"/>`);
  }
  return out.join("");
}

function archLabels(fid) {
  return ARCH[fid].rooms.map((r) => {
    const [x, y] = r.label;
    return `<text x="${x}" y="${y}" data-min="9" font-size="${r.small ? 11 : 13}" font-weight="650" fill="#3b2f25" letter-spacing="0.3" paint-order="stroke" stroke="rgba(255,250,240,0.55)" stroke-width="3">${esc(r.name)}</text>`
      + (r.dims ? `<text class="gh-dims" x="${x}" y="${y + 15}" font-size="10" font-weight="500" fill="#6b5a49" paint-order="stroke" stroke="rgba(255,250,240,0.55)" stroke-width="3">${esc(r.dims)}</text>` : "");
  }).join("");
}

// ------------------------------------------------------------------ furniture
// Each symbol is drawn centred on 0,0 in drawing pixels, w across and d deep, with its back at -d/2.
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const R = (x, y, w, h, fill, rx = 0, extra = "") => `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(Math.max(0.5, w))}" height="${f1(Math.max(0.5, h))}" rx="${f1(rx)}" fill="${fill}"${extra}/>`;
const CI = (x, y, r, fill, extra = "") => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(Math.max(0.5, r))}" fill="${fill}"${extra}/>`;
const EL = (x, y, rx, ry, fill, extra = "") => `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${f1(Math.max(0.5, rx))}" ry="${f1(Math.max(0.5, ry))}" fill="${fill}"${extra}/>`;
const LN = (d, col = "rgba(60,40,25,0.35)", sw = 0.7) => `<path d="${d}" stroke="${col}" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`;
const EDGE = ' stroke="rgba(50,35,25,0.35)" stroke-width="0.7"';
const WOOD = "#b98a5e", WOOD_L = "#cfa47a", WOOD_D = "#8f6a47", STONE = "#efe9e0", STEEL = "#cfd5dc", WHITE = "#fbfaf7";

const sofaSym = (seats, col, colL, colD) => (w, d) => {
  const X = -w / 2, Y = -d / 2, a = Math.max(4, Math.min(14, d * 0.2)), b = Math.max(5, d * 0.28);
  const inner = w - 2 * a, n = seats || Math.max(1, Math.min(4, Math.round(inner / 40))), g = 1.2, sw = (inner - g * (n + 1)) / n;
  let s = R(X, Y, w, d, colD, 5, EDGE) + R(X + a * 0.6, Y, w - a * 1.2, b, col, 4);
  s += R(X, Y, a, d, col, 4) + R(X + w - a, Y, a, d, col, 4);
  for (let i = 0; i < n; i++) s += R(X + a + g + i * (sw + g), Y + b * 0.85, sw, d - b * 0.85 - 2, colL, 3);
  return s;
};
const bedSym = (pillows) => (w, d) => {
  const X = -w / 2, Y = -d / 2, hb = Math.max(3, d * 0.04);
  let s = R(X, Y, w, d, WOOD_D, 3, EDGE) + R(X + 2, Y + hb, w - 4, d - hb - 2, WHITE, 3);
  const pw = (w - 8 - (pillows - 1) * 3) / pillows;
  for (let i = 0; i < pillows; i++) s += R(X + 4 + i * (pw + 3), Y + hb + 3, pw, Math.min(18, d * 0.13), "#ffffff", 4, EDGE);
  s += R(X + 2, Y + d * 0.32, w - 4, d * 0.68 - 2, "#9ab6a6", 3) + R(X + 2, Y + d * 0.32, w - 4, Math.max(3, d * 0.06), "#b9cfc2", 2);
  s += R(X + 2, Y + d * 0.78, w - 4, d * 0.12, "#7f9e8d", 1);
  return s;
};
const unitTop = (w, d, top = STONE) => R(-w / 2, -d / 2, w, d, top, 1.5, EDGE) + LN(`M${f1(-w / 2)} ${f1(-d / 2 + 1.5)}H${f1(w / 2)}`, "rgba(90,70,50,0.35)", 1.2);

const FURNITURE = {
  sofa: { label: "Sofa", cat: "Living room", w: 200, d: 90, draw: sofaSym(0, "#6f86a8", "#8aa0c0", "#566b8c") },
  sofa2: { label: "Two-seat sofa", cat: "Living room", w: 160, d: 88, draw: sofaSym(2, "#6f86a8", "#8aa0c0", "#566b8c") },
  armchair: { label: "Armchair", cat: "Living room", w: 85, d: 85, draw: sofaSym(1, "#b07a5a", "#c99474", "#8e5f43") },
  coffee_table: { label: "Coffee table", cat: "Living room", w: 110, d: 60, draw: (w, d) => R(-w / 2, -d / 2, w, d, WOOD, 4, EDGE) + R(-w / 2 + 3, -d / 2 + 3, w - 6, d - 6, WOOD_L, 3) },
  side_table: { label: "Side table", cat: "Living room", w: 45, d: 45, draw: (w, d) => EL(0, 0, w / 2, d / 2, WOOD, EDGE) + EL(0, 0, w / 2 - 3, d / 2 - 3, WOOD_L) },
  tv_unit: { label: "TV unit", cat: "Living room", w: 180, d: 42, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#5b4a3c", 2, EDGE) + LN(`M${f1(-w / 6)} ${f1(-d / 2 + 2)}V${f1(d / 2 - 2)}M${f1(w / 6)} ${f1(-d / 2 + 2)}V${f1(d / 2 - 2)}`, "rgba(255,255,255,0.18)") },
  tv: { label: "TV", cat: "Living room", w: 140, d: 12, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#1d1b22", 2) + R(-w / 6, -d / 2 + d * 0.3, w / 3, d * 0.7, "#34313b", 1) },
  rug: { label: "Rug", cat: "Living room", w: 200, d: 140, under: true, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#c98b6b", 4) + R(-w / 2 + 6, -d / 2 + 6, w - 12, d - 12, "none", 3, ' stroke="#f0d9c3" stroke-width="2"') + R(-w / 2 + 12, -d / 2 + 12, w - 24, d - 24, "#b97a5a", 2) },
  floor_lamp: { label: "Floor lamp", cat: "Living room", w: 40, d: 40, draw: (w, d) => CI(0, 0, Math.min(w, d) / 2, "#f3ead6", EDGE) + CI(0, 0, Math.min(w, d) / 5, "#d9c79f") },
  bookcase: { label: "Bookcase", cat: "Living room", w: 100, d: 35, draw: (w, d) => {
    let s = R(-w / 2, -d / 2, w, d, WOOD_D, 2, EDGE), x = -w / 2 + 2;
    const cols = ["#7b5ea7", "#4f7cac", "#c46a4f", "#5f9a6e", "#d4a24c"];
    for (let i = 0; x < w / 2 - 4; i++) { const bw = 3 + (i * 7) % 4; s += R(x, -d / 2 + 2, bw, d - 6, cols[i % 5], 0.5); x += bw + 0.6; }
    return s;
  } },
  plant: { label: "Plant", cat: "Living room", w: 45, d: 45, draw: (w, d) => {
    const r = Math.min(w, d) / 2; let s = CI(0, 0, r * 0.62, "#a8775a", EDGE);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; s += EL(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.42, r * 0.26, i % 2 ? "#5f9a5e" : "#78b072", ` transform="rotate(${f1((a * 180) / Math.PI)} ${f1(Math.cos(a) * r * 0.45)} ${f1(Math.sin(a) * r * 0.45)})"`); }
    return s + CI(0, 0, r * 0.25, "#4f8a50");
  } },

  bed_double: { label: "Double bed", cat: "Bedroom", w: 150, d: 200, draw: bedSym(2) },
  bed_king: { label: "King-size bed", cat: "Bedroom", w: 165, d: 205, draw: bedSym(2) },
  bed_single: { label: "Single bed", cat: "Bedroom", w: 90, d: 200, draw: bedSym(1) },
  bedside: { label: "Bedside table", cat: "Bedroom", w: 45, d: 40, draw: (w, d) => R(-w / 2, -d / 2, w, d, WOOD, 2, EDGE) + CI(0, -d * 0.05, Math.min(w, d) * 0.25, "#f3ead6", EDGE) },
  wardrobe: { label: "Wardrobe", cat: "Bedroom", w: 120, d: 60, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#d8cfc4", 2, EDGE) + LN(`M0 ${f1(-d / 2 + 2)}V${f1(d / 2 - 2)}`, "rgba(60,40,25,0.4)") + LN(`M${f1(-w / 2 + 4)} ${f1(-d / 8)}H${f1(w / 2 - 4)}`, "rgba(60,40,25,0.3)", 0.6) + R(-w / 2, d / 2 - 2.5, w, 2.5, "#bfb3a5") },
  dresser: { label: "Chest of drawers", cat: "Bedroom", w: 90, d: 45, draw: (w, d) => R(-w / 2, -d / 2, w, d, WOOD, 2, EDGE) + R(-w / 2 + 2, d / 2 - 4, w - 4, 2.5, WOOD_D, 1) },
  dressing_table: { label: "Dressing table", cat: "Bedroom", w: 100, d: 45, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#e9e1d6", 2, EDGE) + EL(0, -d / 2 + 4, w * 0.22, 3, "#bcd7e6", EDGE) },

  worktop: { label: "Worktop", cat: "Kitchen", w: 100, d: 60, draw: (w, d) => unitTop(w, d) },
  sink: { label: "Sink unit", cat: "Kitchen", w: 80, d: 60, draw: (w, d) => {
    const bw = Math.min(w * 0.45, 60), bh = d * 0.62;
    return unitTop(w, d) + R(-w / 2 + w * 0.08, -bh / 2 + 1, bw, bh, "#c4ccd4", 4, EDGE) + R(-w / 2 + w * 0.08 + 3, -bh / 2 + 4, bw - 6, bh - 6, "#aeb8c2", 3)
      + LN(Array.from({ length: 5 }, (_, i) => `M${f1(-w / 2 + w * 0.08 + bw + 5)} ${f1(-bh / 2 + 3 + i * (bh - 6) / 4)}H${f1(w / 2 - 4)}`).join(""), "rgba(90,100,110,0.45)", 0.8)
      + CI(-w / 2 + w * 0.08 + bw / 2, -d / 2 + 4, 2.2, "#8d97a1");
  } },
  hob: { label: "Hob unit", cat: "Kitchen", w: 60, d: 60, draw: (w, d) => {
    const s = Math.min(w, d) - 6, r = s * 0.17;
    return unitTop(w, d) + R(-s / 2, -s / 2, s, s, "#24222a", 3) + [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([i, j]) => CI(i * s * 0.24, j * s * 0.24, r, "none", ' stroke="#6e6a78" stroke-width="1.4"')).join("");
  } },
  oven: { label: "Oven housing", cat: "Kitchen", w: 60, d: 60, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#3a3842", 2, EDGE) + R(-w / 2 + 3, d / 2 - 5, w - 6, 2.5, "#9aa1aa", 1) },
  fridge: { label: "Fridge", cat: "Kitchen", w: 60, d: 65, draw: (w, d) => R(-w / 2, -d / 2, w, d, STEEL, 3, EDGE) + R(-w / 2 + 3, d / 2 - 5, w * 0.5, 2.5, "#9aa1aa", 1) },
  fridge_freezer: { label: "Fridge freezer", cat: "Kitchen", w: 70, d: 70, draw: (w, d) => R(-w / 2, -d / 2, w, d, STEEL, 3, EDGE) + LN(`M0 ${f1(-d / 2 + 3)}V${f1(d / 2 - 3)}`, "rgba(60,70,80,0.35)") + R(-w / 2 + 3, d / 2 - 5, w - 6, 2.5, "#9aa1aa", 1) },
  washing_machine: { label: "Washing machine", cat: "Kitchen", w: 60, d: 60, draw: (w, d) => {
    const r = Math.min(w, d) * 0.3;
    return R(-w / 2, -d / 2, w, d, WHITE, 3, EDGE) + R(-w / 2 + 2, -d / 2 + 2, w - 4, d * 0.16, "#e6e3dd", 1.5) + CI(0, d * 0.08, r, "#dfe6ec", EDGE) + CI(0, d * 0.08, r * 0.62, "#9fb3c4");
  } },
  dishwasher: { label: "Dishwasher", cat: "Kitchen", w: 60, d: 60, draw: (w, d) => R(-w / 2, -d / 2, w, d, WHITE, 3, EDGE) + R(-w / 2 + 3, d / 2 - 6, w - 6, 3, "#c9ced4", 1) },
  kitchen_island: { label: "Island", cat: "Kitchen", w: 160, d: 90, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#5d6670", 3, EDGE) + R(-w / 2 + 2, -d / 2 + 2, w - 4, d - 4, STONE, 2) },

  toilet: { label: "Toilet", cat: "Bathroom", w: 40, d: 65, draw: (w, d) => R(-w / 2, -d / 2, w, d * 0.28, WHITE, 2.5, EDGE) + EL(0, d * 0.12, w * 0.42, d * 0.36, WHITE, EDGE) + EL(0, d * 0.14, w * 0.27, d * 0.24, "#dbe6ec") },
  basin: { label: "Basin", cat: "Bathroom", w: 55, d: 42, draw: (w, d) => R(-w / 2, -d / 2, w, d, WHITE, 5, EDGE) + EL(0, d * 0.08, w * 0.34, d * 0.3, "#dbe6ec", EDGE) + CI(0, -d / 2 + 4, 1.8, "#8d97a1") },
  bath: { label: "Bath", cat: "Bathroom", w: 170, d: 70, draw: (w, d) => R(-w / 2, -d / 2, w, d, WHITE, 6, EDGE) + R(-w / 2 + 5, -d / 2 + 5, w - 10, d - 10, "#d6e7ef", Math.min(w, d) * 0.3, EDGE) + CI(-w / 2 + 12, 0, 2, "#8d97a1") + CI(-w / 2 + 4, -d * 0.18, 1.6, "#8d97a1") + CI(-w / 2 + 4, d * 0.18, 1.6, "#8d97a1") },
  shower: { label: "Shower tray", cat: "Bathroom", w: 90, d: 90, draw: (w, d) => R(-w / 2, -d / 2, w, d, WHITE, 2, EDGE) + R(-w / 2 + 3, -d / 2 + 3, w - 6, d - 6, "#e3edf2", 1) + LN(`M${f1(-w / 2 + 3)} ${f1(-d / 2 + 3)}L${f1(w / 2 - 3)} ${f1(d / 2 - 3)}M${f1(w / 2 - 3)} ${f1(-d / 2 + 3)}L${f1(-w / 2 + 3)} ${f1(d / 2 - 3)}`, "rgba(110,140,160,0.35)", 0.6) + CI(0, 0, 3, "#9fb3c4", EDGE) + LN(`M${f1(-w / 2 + 1)} ${f1(-d / 2)}V${f1(d / 2)}`, "rgba(120,190,230,0.9)", 2) },
  towel_rail: { label: "Towel radiator", cat: "Bathroom", w: 60, d: 10, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#c9ced4", 2, EDGE) + LN(`M${f1(-w / 2 + 3)} 0H${f1(w / 2 - 3)}`, "#8d97a1", 1) },
  bath_cabinet: { label: "Bathroom cabinet", cat: "Bathroom", w: 60, d: 30, draw: (w, d) => R(-w / 2, -d / 2, w, d, WHITE, 2, EDGE) + LN(`M0 ${f1(-d / 2 + 2)}V${f1(d / 2 - 2)}`) },

  dining_table: { label: "Dining table", cat: "Dining room", w: 140, d: 90, draw: (w, d) => R(-w / 2, -d / 2, w, d, WOOD, 4, EDGE) + R(-w / 2 + 4, -d / 2 + 4, w - 8, d - 8, WOOD_L, 3) },
  round_table: { label: "Round table", cat: "Dining room", w: 100, d: 100, draw: (w, d) => EL(0, 0, w / 2, d / 2, WOOD, EDGE) + EL(0, 0, w / 2 - 4, d / 2 - 4, WOOD_L) },
  dining_chair: { label: "Dining chair", cat: "Dining room", w: 45, d: 48, draw: (w, d) => R(-w / 2, -d / 2 + d * 0.12, w, d * 0.88, "#a87c58", 4, EDGE) + R(-w / 2, -d / 2, w, d * 0.18, WOOD_D, 2) },
  sideboard: { label: "Sideboard", cat: "Dining room", w: 160, d: 45, draw: (w, d) => R(-w / 2, -d / 2, w, d, WOOD_D, 2, EDGE) + LN([-1, 0, 1].map((i) => `M${f1((i * w) / 4)} ${f1(-d / 2 + 3)}V${f1(d / 2 - 3)}`).join(""), "rgba(255,255,255,0.2)") },

  console_table: { label: "Console table", cat: "Hallway", w: 100, d: 35, draw: (w, d) => R(-w / 2, -d / 2, w, d, WOOD, 2, EDGE) + R(-w / 2 + 3, -d / 2 + 3, w - 6, d - 6, WOOD_L, 1) },
  shoe_rack: { label: "Shoe storage", cat: "Hallway", w: 80, d: 30, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#8e8794", 2, EDGE) + LN(`M${f1(-w / 2 + 3)} 0H${f1(w / 2 - 3)}`, "rgba(255,255,255,0.35)") },
  coat_stand: { label: "Coat stand", cat: "Hallway", w: 45, d: 45, draw: (w, d) => CI(0, 0, Math.min(w, d) / 2, "none", ' stroke="#6b5a49" stroke-width="2"') + CI(0, 0, 4, "#6b5a49") },
  hall_bench: { label: "Bench", cat: "Hallway", w: 100, d: 40, draw: (w, d) => R(-w / 2, -d / 2, w, d, WOOD_D, 2, EDGE) + R(-w / 2 + 3, -d / 2 + 3, w - 6, d - 6, "#9ab6a6", 3) },

  desk: { label: "Desk", cat: "General", w: 140, d: 65, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#e2d6c6", 3, EDGE) + R(-w * 0.2, -d / 2 + 3, w * 0.4, 3, "#2a2830", 1) },
  office_chair: { label: "Office chair", cat: "General", w: 60, d: 60, draw: (w, d) => CI(0, d * 0.05, Math.min(w, d) * 0.42, "#3a3842", EDGE) + R(-w * 0.32, -d / 2, w * 0.64, d * 0.2, "#2a2830", 4) + CI(0, d * 0.05, Math.min(w, d) * 0.28, "#4a4754") },
  storage_unit: { label: "Storage unit", cat: "General", w: 80, d: 40, draw: (w, d) => R(-w / 2, -d / 2, w, d, WHITE, 2, EDGE) + LN(`M${f1(-w / 4)} ${f1(-d / 2 + 2)}V${f1(d / 2 - 2)}M0 ${f1(-d / 2 + 2)}V${f1(d / 2 - 2)}M${f1(w / 4)} ${f1(-d / 2 + 2)}V${f1(d / 2 - 2)}`) },
  radiator: { label: "Radiator", cat: "General", w: 100, d: 10, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#f2f2f0", 1.5, EDGE) + LN(Array.from({ length: Math.max(2, Math.floor(w / 6)) }, (_, i) => `M${f1(-w / 2 + 3 + i * 6)} ${f1(-d / 2 + 1)}V${f1(d / 2 - 1)}`).join(""), "rgba(80,80,90,0.25)", 0.6) },
  box: { label: "Storage box", cat: "General", w: 60, d: 60, draw: (w, d) => R(-w / 2, -d / 2, w, d, "#c9a274", 2, EDGE) + LN(`M0 ${f1(-d / 2)}V${f1(d / 2)}`, "rgba(120,90,50,0.6)", 2) },
};
const FURN_CATS = ["Living room", "Bedroom", "Kitchen", "Bathroom", "Dining room", "Hallway", "General"];

// Fittings placed on a new plan: [type, centre x, centre y, width, depth (drawing px), rotation]
const SEED_PX = (GH_CFG.floorplan && GH_CFG.floorplan.fittings) || (GH_CFG.floorplan && GH_CFG.floorplan.arch ? {} : SAMPLE_FITTINGS);
const seedItems = (fid) => (SEED_PX[fid] || []).map(([type, x, y, w, d, rot], i) => ({
  id: `${fid[0]}s${i + 1}`, type, x: toCm(x, 0), y: toCm(y, 1), w: Math.round((w * 1000) / PX_M) / 10, d: Math.round((d * 1000) / PX_M) / 10, rot,
}));

// ------------------------------------------------------------------ devices
const DEV_CATS = {
  light: { label: "Light", icon: "mdi:lightbulb", col: "#ffc46b" },
  heating: { label: "Heating", icon: "mdi:thermostat", col: "#ff9f43" },
  camera: { label: "Camera", icon: "mdi:cctv", col: "#34d399" },
  door: { label: "Door sensor", icon: "mdi:door", col: "#60a5fa" },
  window: { label: "Window sensor", icon: "mdi:window-closed-variant", col: "#7dd3fc" },
  plug: { label: "Smart plug", icon: "mdi:power-socket-uk", col: "#c4b5fd" },
  washer: { label: "Washing machine", icon: "mdi:washing-machine", col: "#22d3ee" },
  temperature: { label: "Temperature", icon: "mdi:thermometer", col: "#4ade80" },
  motion: { label: "Motion", icon: "mdi:motion-sensor", col: "#f472b6" },
  media: { label: "TV / media", icon: "mdi:television", col: "#8fb4ff" },
  other: { label: "Other", icon: "mdi:devices", col: "#a29db8" },
};
const ICON_CHOICES = ["mdi:lightbulb", "mdi:ceiling-light", "mdi:lamp", "mdi:led-strip-variant", "mdi:thermostat", "mdi:radiator", "mdi:fire",
  "mdi:cctv", "mdi:door", "mdi:window-closed-variant", "mdi:power-socket-uk", "mdi:washing-machine", "mdi:thermometer",
  "mdi:motion-sensor", "mdi:television", "mdi:speaker", "mdi:router-wireless", "mdi:fan", "mdi:devices"];
const PLACEABLE = ["light", "switch", "climate", "camera", "binary_sensor", "sensor", "media_player", "fan", "cover", "lock", "water_heater", "vacuum"];
const STATUS_ONLY = (GH_CFG.floorplan && GH_CFG.floorplan.status_only) || [];
const BAD = ["unavailable", "unknown"];

function devCat(eid, st) {
  const dom = eid.split(".")[0], dc = st && st.attributes.device_class;
  if (/washing_machine|washer/.test(eid)) return "washer";
  if (dom === "light") return "light";
  if (dom === "climate" || dom === "water_heater") return "heating";
  if (dom === "camera") return "camera";
  if (dom === "binary_sensor" && ["door", "garage_door", "opening"].includes(dc)) return "door";
  if (dom === "binary_sensor" && dc === "window") return "window";
  if (dom === "binary_sensor" && ["motion", "occupancy", "presence"].includes(dc)) return "motion";
  if (dom === "sensor" && dc === "temperature") return "temperature";
  if (dom === "switch") return /heater|radiator/.test(eid) ? "heating" : "plug";
  if (dom === "media_player") return "media";
  return "other";
}

const nice = (x) => String(x).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const ICONS = {
  minus: "M19,13H5V11H19V13Z", plus: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",
  fit: "M5,5H10V7H7V10H5V5M14,5H19V10H17V7H14V5M17,14H19V19H14V17H17V14M10,17V19H5V14H7V17H10Z",
  reset: "M12,5V1L7,6L12,11V7A6,6 0 0,1 18,13A6,6 0 0,1 12,19A6,6 0 0,1 6,13H4A8,8 0 0,0 12,21A8,8 0 0,0 20,13A8,8 0 0,0 12,5Z",
  undo: "M12.5,8C9.85,8 7.45,9 5.6,10.6L2,7V16H11L7.38,12.38C8.77,11.22 10.54,10.5 12.5,10.5C16.04,10.5 19.05,12.81 20.1,16L22.47,15.22C21.08,11.03 17.15,8 12.5,8Z",
  edit: "M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z",
};
const svgIcon = (k) => `<svg viewBox="0 0 24 24" width="22" height="22"><path d="${ICONS[k]}" fill="currentColor"/></svg>`;

// Narrow screens (a foldable's cover, a phone): each card reflows its own insides when the card itself is
// narrow, measured with a container query, so the tablet (where no card is this narrow) is unchanged.
const NARROW_CSS_HOUSE = `
  :host { container-type: inline-size; }
  @container (max-width: 560px) {
    .bar { flex-wrap: wrap; }
    .seg, .tools { flex: 1 1 100%; box-sizing: border-box; }
    .tools { justify-content: space-between; }
  }`;

class GlassHomeHouseCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._plan = null;
    this._floor = FLOOR_IDS[0];
    this._edit = false;
    this._sel = null;          // { kind: "item" | "device", id }
    this._sheet = null;        // device id whose panel is open (normal mode)
    this._tab = "Furniture";
    this._cat = "Living room";
    this._search = "";
    this._drawer = true;
    this._undo = [];
    this._view = { ...VIEW };
    this._ptrs = new Map();
    this._g = null;
    this._raf = 0;
    this._store = null;
    this._status = "";
  }

  setConfig(config) {
    this._config = { plan_key: "glasshome_floorplan", storage_key: "glasshome_layout", tap_paths: {}, status_only: STATUS_ONLY, ...config };
    if (!this.shadowRoot.innerHTML) this._scaffold();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) { this._load(); return; }
    if (!this._plan || this._g || this._hidden) return;
    this._live();
  }

  // Bring markers, light tints and the open panel up to date (only when something changed)
  _live() {
    const key = this._liveKey();
    if (key === this._lastLive) return;
    this._lastLive = key;
    this._renderGlow();
    this._updateMarkers();
    if (this._sheet) this._renderSheet();
  }

  // While the pager has slid this page out of view, state changes are skipped; it catches up on return
  connectedCallback() {
    if (!this._io && "IntersectionObserver" in window) {
      this._io = new IntersectionObserver((es) => es.forEach((e) => {
        this._hidden = !e.isIntersecting;
        if (!this._hidden && this._plan && this._hass && !this._g) this._live();
      }));
      this._io.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    this._hidden = false;
    clearTimeout(this._statusTimer);
    cancelAnimationFrame(this._raf);
    cancelAnimationFrame(this._fr);
    this._raf = this._fr = 0;
  }

  getCardSize() {
    return 10;
  }

  static getStubConfig() {
    return { plan_key: "glasshome_floorplan" };
  }

  // ---------------------------------------------------------------- storage
  async _read(key) {
    for (const where of ["system", "user"]) {
      try {
        const res = await this._hass.callWS({ type: `frontend/get_${where}_data`, key });
        this._store = this._store || where;
        if (res && res.value) return { value: res.value, where };
      } catch (err) { /* try the next store */ }
    }
    try {
      const local = JSON.parse(localStorage.getItem(key) || "null");
      if (local) return { value: local, where: "local" };
    } catch (err) { /* ignore */ }
    return null;
  }

  async _load() {
    const saved = await this._read(this._config.plan_key);
    if (saved && saved.value.floors) {
      this._plan = this._normalise(saved.value);
      this._store = saved.where;
    } else {
      this._plan = this._normalise({ version: 2, floors: { ground: { items: seedItems("ground") }, first: { items: seedItems("first") } } });
      const old = await this._read(this._config.storage_key);
      if (old && Array.isArray(old.value.devices)) this._bringDevices(old.value.devices);
    }
    this._renderAll();
  }

  _normalise(p) {
    p.version = 2;
    p.floors = p.floors || {};
    for (const f of FLOOR_IDS) {
      const fl = (p.floors[f] = p.floors[f] || {});
      fl.items = Array.isArray(fl.items) ? fl.items : [];
      fl.devices = Array.isArray(fl.devices) ? fl.devices : [];
      fl.settings = { snap: true, ...(fl.settings || {}) };
    }
    return p;
  }

  // Devices placed on the previous (3D) plan come across in roughly the same spot. Its rooms were drawn
  // from the front, so its coordinates are mapped onto the traced plan and kept inside the house.
  _bringDevices(list) {
    for (const d of list) {
      if (!d.entity || !FLOOR_IDS.includes(d.floor)) continue;
      const A = ARCH[d.floor], xs = A.outline.map((p) => p[0]), ys = A.outline.map((p) => p[1]);
      let px = 18 + d.x * 74.7, py = 399 - d.y * 76;
      if (/washing_machine/.test(d.entity)) { px = 383.5; py = 39.5; }
      px = Math.min(Math.max(px, Math.min(...xs) + 10), Math.max(...xs) - 10);
      py = Math.min(Math.max(py, Math.min(...ys) + 10), Math.max(...ys) - 10);
      const rec = { id: d.id || this._newId("d"), entity: d.entity, x: toCm(px, 0), y: toCm(py, 1) };
      if (d.icon) rec.icon = d.icon;
      if (d.readout && !d.readout.startsWith("attr:")) rec.readout = d.readout;
      this._plan.floors[d.floor].devices.push(rec);
    }
  }

  _queueSave() {
    clearTimeout(this._saveTimer);
    this._setStatus("Saving…");
    this._saveTimer = setTimeout(() => this._save(), 600);
  }

  async _save() {
    const key = this._config.plan_key, value = { ...this._plan, saved: new Date().toISOString() };
    const order = this._store === "user" ? ["user", "system"] : ["system", "user"];
    for (const where of order) {
      try {
        await this._hass.callWS({ type: `frontend/set_${where}_data`, key, value });
        this._store = where;
        this._setStatus(where === "system" ? "Saved in Home Assistant" : "Saved for your Home Assistant user");
        return;
      } catch (err) { /* try the next store */ }
    }
    try {
      localStorage.setItem(key, JSON.stringify(value));
      this._store = "local";
      this._setStatus("Saved on this device only");
    } catch (err) {
      this._setStatus("Could not save");
    }
  }

  _setStatus(s) {
    this._status = s;
    const el = this.shadowRoot.getElementById("status");
    if (el) el.textContent = s;
    clearTimeout(this._statusTimer);
    if (s && !/…$/.test(s)) this._statusTimer = setTimeout(() => { if (this._status === s) this._setStatus(""); }, 3500);
  }

  _change(fn) {
    this._undo.push(JSON.stringify(this._plan));
    if (this._undo.length > 50) this._undo.shift();
    fn(this._fl());
    this._queueSave();
  }

  _fl() {
    return this._plan.floors[this._floor];
  }

  _newId(p) {
    return `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  }

  // ---------------------------------------------------------------- scaffold
  _scaffold() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px; border-radius: 26px; color: #fff; overflow: hidden; position: relative;
          background: radial-gradient(70% 60% at 50% 48%, rgba(139,92,246,0.14), transparent 70%), linear-gradient(180deg, rgba(30,24,54,0.85), rgba(16,12,30,0.92));
          border: ${GLASS_BORDER}; box-shadow: ${GLASS_EDGE}; }
        button { font: inherit; font-size: 14px; font-weight: 600; color: #fff; background: rgba(255,255,255,0.08); border: 0; border-radius: 14px;
          min-height: 44px; min-width: 44px; padding: 0 12px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
        button:active { background: rgba(255,255,255,0.16); }
        button.on { background: linear-gradient(160deg, rgba(139,92,246,0.75), rgba(109,40,217,0.55)); box-shadow: 0 0 16px rgba(139,92,246,0.3); }
        button.warn { color: #ff8a8a; }
        button:disabled { opacity: 0.35; }
        .bar { display: flex; gap: 8px; align-items: center; }
        .seg { display: flex; gap: 4px; padding: 4px; border-radius: 18px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.07); flex: 1; }
        .seg button { flex: 1; background: transparent; color: #a29db8; letter-spacing: 0.6px; font-size: 13px; }
        .seg button.on { color: #fff; background: linear-gradient(160deg, rgba(139,92,246,0.75), rgba(109,40,217,0.55)); }
        .tools { display: flex; gap: 4px; padding: 4px; border-radius: 18px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.07); }
        .tools button { background: transparent; color: #d6d1ea; padding: 0 8px; }
        .tools button.on { color: #fff; }
        .stage { position: relative; margin-top: 10px; border-radius: 18px; overflow: hidden; background: #1b1628; aspect-ratio: ${VIEW.w} / ${VIEW.h};
          user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
        .stage.noswipe { touch-action: none; }
        .stage > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
        .stage.editing #items .it { cursor: grab; }
        #items .it { pointer-events: none; }
        .stage.editing #items .it { pointer-events: auto; }
        .markers { position: absolute; inset: 0; pointer-events: none; }
        .mk { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; pointer-events: auto; cursor: pointer; }
        .mk .dot { width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 21px;
          background: rgba(32,27,48,0.92); border: 2px solid var(--c); color: var(--c); }
        /* State is shown by flat colour only: no glows, filters or transitions to repaint */
        .mk.on .dot { background: var(--c); color: #1a1426; }
        .mk.alert .dot { background: #ff6b6b; border-color: #ff6b6b; color: #fff; }
        .mk.off .dot { opacity: 0.45; border-color: #8e8aa0; color: #8e8aa0; }
        .mk .val { margin-top: 3px; padding: 1px 7px; border-radius: 9px; font-size: 11px; font-weight: 700; white-space: nowrap; color: #fff;
          background: rgba(24,19,40,0.88); border: 1px solid rgba(255,255,255,0.12); }
        .mk.sel .dot { outline: 3px solid #a78bfa; outline-offset: 3px; }
        .mk.status .dot { border-style: dashed; }
        .panel { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); width: min(400px, calc(100% - 24px)); box-sizing: border-box; padding: 14px;
          border-radius: 22px; background: linear-gradient(155deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 55%), rgba(34,27,62,0.74); border: 1px solid ${LG_FLOAT_LINE};
          box-shadow: 0 18px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.22);
          -webkit-backdrop-filter: ${LG_FLOAT_BLUR}; backdrop-filter: ${LG_FLOAT_BLUR}; }
        ${LG_NOBLUR(".panel")}
        .panel:empty { display: none; }
        .ph { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .ph .ic { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.08); color: var(--c); --mdc-icon-size: 24px; flex: none; }
        .ph .t { flex: 1; min-width: 0; }
        .ph .n { font-size: 16px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ph .s { font-size: 13px; color: #b9b3cf; margin-top: 2px; }
        .ph button { background: transparent; color: #a29db8; font-size: 20px; }
        .facts { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
        .fact { flex: 1; min-width: 90px; padding: 8px 10px; border-radius: 14px; background: rgba(255,255,255,0.06); }
        .fact b { display: block; font-size: 18px; }
        .fact span { font-size: 12px; color: #a29db8; }
        .acts { display: flex; gap: 8px; flex-wrap: wrap; }
        .acts button { flex: 1; }
        input[type=range] { width: 100%; accent-color: #a78bfa; margin: 4px 0 10px; height: 28px; }
        .note { font-size: 13px; color: #a29db8; margin: 0 0 10px; }
        .drawer { position: absolute; left: 0; right: 0; bottom: 0; max-height: 52%; display: flex; flex-direction: column; box-sizing: border-box;
          background: linear-gradient(180deg, rgba(36,29,62,0.97), rgba(20,16,36,0.98)); border-top: 1px solid rgba(255,255,255,0.14); box-shadow: 0 -12px 30px rgba(0,0,0,0.45); }
        .drawer.closed .db { display: none; }
        .dh { display: flex; gap: 6px; align-items: center; padding: 8px 10px; flex-wrap: wrap; }
        .dh .grow { flex: 1; }
        .db { overflow-y: auto; padding: 0 10px 10px; overscroll-behavior: contain; }
        .chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; scrollbar-width: none; }
        .chips button { flex: none; min-height: 36px; font-size: 13px; border-radius: 12px; }
        .lib { display: grid; grid-template-columns: repeat(auto-fill, minmax(98px, 1fr)); gap: 8px; }
        .lib button { flex-direction: column; min-height: 96px; padding: 6px; font-size: 12px; font-weight: 600; color: #e9e5f5; background: rgba(255,255,255,0.06); }
        .lib svg { width: 70px; height: 56px; }
        .list { display: flex; flex-direction: column; gap: 6px; }
        .list button { justify-content: flex-start; text-align: left; font-weight: 500; padding: 8px 12px; }
        .list ha-icon { color: var(--c); --mdc-icon-size: 22px; flex: none; }
        .list small { display: block; color: #98989f; font-weight: 400; font-size: 12px; }
        input[type=search], input[type=text], input[type=number], select { box-sizing: border-box; min-height: 44px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);
          background: rgba(0,0,0,0.25); color: #fff; font: inherit; font-size: 15px; padding: 0 12px; }
        input[type=search] { width: 100%; margin-bottom: 8px; }
        select option { background: #241d3e; }
        .form { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-bottom: 8px; }
        .form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #a29db8; }
        .form input, .form select { width: 100%; }
        .icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 6px; margin-bottom: 8px; }
        .icons button { padding: 0; --mdc-icon-size: 22px; }
        .status { font-size: 13px; color: #98989f; min-height: 18px; margin-top: 6px; padding-left: 4px; }
        .hint { font-size: 13px; color: #a29db8; padding: 4px 2px 8px; }
        ${NARROW_CSS_HOUSE}
      </style>
      <ha-card>
        <div class="bar" id="bar"></div>
        <div class="stage" id="stage">
          <svg id="svg" xmlns="http://www.w3.org/2000/svg" font-family="Inter,-apple-system,Roboto,Segoe UI,sans-serif" text-anchor="middle">
            <g id="floor"></g><g id="items"></g><g id="glows" pointer-events="none"></g><g id="arch" pointer-events="none"></g>
            <g id="labels" pointer-events="none"></g><g id="guides" pointer-events="none"></g><g id="selg"></g>
          </svg>
          <div class="markers" id="markers"></div>
          <div class="panel" id="sheet"></div>
          <div id="drawer"></div>
        </div>
        <div class="status" id="status"></div>
      </ha-card>`;
    const stage = this.shadowRoot.getElementById("stage");
    stage.addEventListener("pointerdown", (e) => this._down(e));
    stage.addEventListener("pointermove", (e) => this._move(e));
    stage.addEventListener("pointerup", (e) => this._up(e));
    stage.addEventListener("pointercancel", (e) => this._up(e, true));
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [px, py] = this._toPlan(e.clientX, e.clientY);
      this._zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, px, py);
    }, { passive: false });
    this.shadowRoot.addEventListener("click", (e) => this._click(e));
    this.shadowRoot.addEventListener("change", (e) => this._field(e));
    this.shadowRoot.addEventListener("input", (e) => {
      if (e.target.id === "search") { this._search = e.target.value; this._renderDrawer(true); }
    });
  }

  // ---------------------------------------------------------------- rendering
  _renderAll() {
    if (!this._plan) return;
    this._renderBar();
    this.shadowRoot.getElementById("floor").innerHTML = archFloor(this._floor);
    this.shadowRoot.getElementById("arch").innerHTML = archStructure(this._floor);
    this.shadowRoot.getElementById("labels").innerHTML = archLabels(this._floor);
    this._applyView();
    this._renderItems();
    this._renderGlow();
    this._renderSel();
    this._renderMarkers();
    this._renderSheet();
    this._renderDrawer();
    this._lastLive = this._liveKey();
  }

  _renderBar() {
    const floors = FLOOR_IDS.map((f) => `<button data-act="floor" data-v="${f}" class="${f === this._floor ? "on" : ""}">${FLOOR_NAMES[f]}</button>`).join("");
    const undo = this._edit ? `<button data-act="undo" title="Undo" ${this._undo.length ? "" : "disabled"}>${svgIcon("undo")}</button>` : "";
    this.shadowRoot.getElementById("bar").innerHTML = `<div class="seg">${floors}</div>
      <div class="tools">
        <button data-act="zoom" data-v="out" title="Zoom out">${svgIcon("minus")}</button>
        <button data-act="zoom" data-v="in" title="Zoom in">${svgIcon("plus")}</button>
        <button data-act="fit" title="Fit to screen">${svgIcon("fit")}</button>
        <button data-act="reset" title="Reset view">${svgIcon("reset")}</button>
        ${undo}
        ${this._edit ? `<button data-act="building" title="Walls, rooms and plan picture">${svgIcon("edit")}Building</button>` : ""}
        <button data-act="edit" class="${this._edit ? "on" : ""}" title="Edit mode">${svgIcon("edit")}${this._edit ? "Done" : "Edit"}</button>
      </div>`;
  }

  _px(o) {
    return [toPx(o.x, 0), toPx(o.y, 1)];
  }

  _itemSvg(it) {
    const def = FURNITURE[it.type] || FURNITURE.box;
    const [x, y] = this._px(it), w = (it.w * PX_M) / 100, d = (it.d * PX_M) / 100;
    return `<g class="it" data-kind="item" data-id="${esc(it.id)}" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(it.rot || 0)})">${def.draw(w, d)}</g>`;
  }

  _renderItems() {
    const items = this._fl().items, under = items.filter((i) => (FURNITURE[i.type] || {}).under), rest = items.filter((i) => !(FURNITURE[i.type] || {}).under);
    this.shadowRoot.getElementById("items").innerHTML = [...under, ...rest].map((it) => this._itemSvg(it)).join("");
  }

  _roomAt(px, py) {
    return ARCH[this._floor].rooms.find((r) => inPoly(px, py, r.poly));
  }

  // A flat warm tint over each room with a light on (one per room, brightest lamp wins); no gradients or clipping
  _renderGlow() {
    const rooms = new Map();
    for (const d of this._fl().devices) {
      const st = this._hass && this._hass.states[d.entity];
      if (!st || !d.entity.startsWith("light.") || st.state !== "on") continue;
      const [x, y] = this._px(d), room = this._roomAt(x, y);
      if (!room) continue;
      const b = st.attributes.brightness != null ? st.attributes.brightness / 255 : 0.8;
      rooms.set(room, Math.max(rooms.get(room) || 0, b));
    }
    const html = [...rooms].map(([r, b]) => `<polygon points="${pts(r.poly)}" fill="#ffc46b" opacity="${(0.12 + 0.14 * b).toFixed(2)}"/>`).join("");
    const g = this.shadowRoot.getElementById("glows");
    if (g.innerHTML !== html) g.innerHTML = html;
  }

  _scale() {
    const stage = this.shadowRoot.getElementById("stage");
    return (stage.clientWidth || 700) / this._view.w;
  }

  // Selection frame with a rotate handle (top) and a resize handle (bottom right corner)
  _renderSel() {
    const g = this.shadowRoot.getElementById("selg");
    const it = this._edit && this._sel && this._sel.kind === "item" && this._fl().items.find((i) => i.id === this._sel.id);
    if (!it) { g.innerHTML = ""; return; }
    const [x, y] = this._px(it), w = (it.w * PX_M) / 100, d = (it.d * PX_M) / 100, k = 1 / this._scale();
    const hr = 11 * k, off = 26 * k;
    g.innerHTML = `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(it.rot || 0)})">
      <rect x="${f1(-w / 2 - 3 * k)}" y="${f1(-d / 2 - 3 * k)}" width="${f1(w + 6 * k)}" height="${f1(d + 6 * k)}" fill="rgba(167,139,250,0.08)" stroke="#a78bfa" stroke-width="${f1(2 * k)}" stroke-dasharray="${f1(6 * k)} ${f1(4 * k)}" data-kind="item" data-id="${esc(it.id)}"/>
      <line x1="0" y1="${f1(-d / 2 - 3 * k)}" x2="0" y2="${f1(-d / 2 - off)}" stroke="#a78bfa" stroke-width="${f1(2 * k)}"/>
      <circle cx="0" cy="${f1(-d / 2 - off)}" r="${f1(hr)}" fill="#a78bfa" stroke="#fff" stroke-width="${f1(2 * k)}" data-h="rot"/>
      <path d="M${f1(-4 * k)} ${f1(-d / 2 - off - 2 * k)}a${f1(4 * k)} ${f1(4 * k)} 0 1 1 ${f1(4 * k)} ${f1(5 * k)}" stroke="#fff" stroke-width="${f1(1.6 * k)}" fill="none" pointer-events="none"/>
      <rect x="${f1(w / 2 - hr + 3 * k)}" y="${f1(d / 2 - hr + 3 * k)}" width="${f1(hr * 2)}" height="${f1(hr * 2)}" rx="${f1(4 * k)}" fill="#fff" stroke="#a78bfa" stroke-width="${f1(2 * k)}" data-h="size"/>
    </g>`;
  }

  // ------------------------------------------------------------ live device state
  _devInfo(d) {
    const st = this._hass && this._hass.states[d.entity];
    const cat = devCat(d.entity, st), meta = DEV_CATS[cat], dom = d.entity.split(".")[0];
    const s = st ? st.state : "unavailable", off = !st || BAD.includes(s), a = (st && st.attributes) || {};
    const name = d.name || a.friendly_name || d.entity;
    const statusOnly = (this._config.status_only || []).includes(d.entity);
    let on = false, alert = false, val = "";
    const power = this._power(d);
    if (off) val = "Offline";
    else if (cat === "light") { on = s === "on"; val = on ? (a.brightness != null ? `${Math.round(a.brightness / 2.55)}%` : "On") : "Off"; }
    else if (cat === "plug") { on = s === "on"; val = on ? (power || "On") : "Off"; }
    else if (cat === "heating" && dom === "climate") {
      on = a.hvac_action === "heating";
      val = a.current_temperature != null ? `${a.current_temperature}°` : nice(s);
      if (a.temperature != null) val += ` → ${a.temperature}°`;
    } else if (cat === "heating") { on = s === "on"; val = on ? (power || "On") : "Off"; }
    else if (cat === "door" || cat === "window") { alert = s === "on"; val = alert ? "Open" : "Closed"; }
    else if (cat === "motion") { on = s === "on"; val = on ? "Motion" : "Clear"; }
    else if (cat === "temperature") val = `${Math.round(Number(s) * 10) / 10}°`;
    else if (cat === "washer") {
      const stage = typeof WASH_STAGE !== "undefined" ? WASH_STAGE[s] : null;
      on = typeof washActive === "function" ? washActive(s) : !["none", "stop", "off", "finish"].includes(s);
      val = stage || nice(s);
    } else if (cat === "camera") val = "Camera";
    else if (cat === "media") { on = !["off", "standby", "idle"].includes(s); val = on ? nice(s) : "Off"; }
    else if (dom === "sensor") val = `${s}${a.unit_of_measurement ? " " + a.unit_of_measurement : ""}`;
    else { on = s === "on"; val = nice(s); }
    return { st, s, a, cat, meta, dom, off, on, alert, val, name, statusOnly, power, icon: d.icon || meta.icon };
  }

  // Live power for a plug: the device's own power sensor (or the reading chosen for it)
  _power(d) {
    const h = this._hass;
    if (!h) return "";
    let eid = d.readout;
    if (!eid && h.entities && h.entities[d.entity]) {
      const dev = h.entities[d.entity].device_id;
      eid = dev && Object.keys(h.entities).find((k) => h.entities[k].device_id === dev && k.startsWith("sensor.") && h.states[k] && h.states[k].attributes.device_class === "power");
    }
    const st = eid && h.states[eid];
    if (!st || BAD.includes(st.state)) return "";
    const n = Number(st.state);
    return Number.isFinite(n) ? `${n >= 100 ? Math.round(n) : Math.round(n * 10) / 10} ${st.attributes.unit_of_measurement || "W"}` : "";
  }

  _liveKey() {
    if (!this._hass || !this._plan) return "";
    const ids = new Set();
    for (const f of FLOOR_IDS) for (const d of this._plan.floors[f].devices) { ids.add(d.entity); if (d.readout) ids.add(d.readout); }
    return [...ids].map((e) => { const s = this._hass.states[e]; return s ? s.last_updated : "-"; }).join("|") + (this._sheet ? `#${this._sheet}` : "");
  }

  // What a marker shows (everything except its position)
  _markerLook(d) {
    const i = this._devInfo(d);
    const cls = ["mk", i.on ? "on" : "", i.alert ? "alert" : "", i.off ? "off" : "", i.statusOnly ? "status" : "", this._edit && this._sel && this._sel.id === d.id ? "sel" : ""].join(" ");
    return { cls, name: i.name, col: i.meta.col, icon: i.icon, val: i.val, key: [cls, i.name, i.meta.col, i.icon, i.val].join("\u0001") };
  }

  _renderMarkers() {
    const host = this.shadowRoot.getElementById("markers");
    if (!host || !this._plan) return;
    const v = this._view;
    this._looks = new Map();
    host.innerHTML = this._fl().devices.map((d) => {
      const l = this._markerLook(d), [x, y] = this._px(d);
      this._looks.set(d.id, l.key);
      return `<div class="${l.cls}" data-kind="device" data-id="${esc(d.id)}" title="${esc(l.name)}" style="left:${(((x - v.x) / v.w) * 100).toFixed(3)}%;top:${(((y - v.y) / v.h) * 100).toFixed(3)}%;--c:${l.col}">`
        + `<div class="dot"><ha-icon icon="${esc(l.icon)}"></ha-icon></div><div class="val">${esc(l.val)}</div></div>`;
    }).join("");
  }

  // Live updates touch only the markers whose device actually changed
  _updateMarkers() {
    const host = this.shadowRoot.getElementById("markers");
    const devs = this._fl().devices;
    if (!this._looks || !host || host.children.length !== devs.length) { this._renderMarkers(); return; }
    for (const d of devs) {
      const l = this._markerLook(d);
      if (this._looks.get(d.id) === l.key) continue;
      const el = host.querySelector(`.mk[data-id="${CSS.escape(d.id)}"]`);
      if (!el) { this._renderMarkers(); return; }
      this._looks.set(d.id, l.key);
      el.className = l.cls;
      el.title = l.name;
      el.style.setProperty("--c", l.col);
      const ic = el.querySelector("ha-icon"), val = el.querySelector(".val");
      if (ic.getAttribute("icon") !== l.icon) ic.setAttribute("icon", l.icon);
      if (val.textContent !== l.val) val.textContent = l.val;
    }
  }

  _placeMarker(d) {
    const el = this.shadowRoot.querySelector(`.mk[data-id="${CSS.escape(d.id)}"]`);
    if (!el) return;
    const v = this._view, [x, y] = this._px(d);
    el.style.left = `${(((x - v.x) / v.w) * 100).toFixed(3)}%`;
    el.style.top = `${(((y - v.y) / v.h) * 100).toFixed(3)}%`;
  }

  // Device panel in normal mode: live state and the controls the entity actually supports
  _renderSheet() {
    const el = this.shadowRoot.getElementById("sheet");
    const d = !this._edit && this._sheet && this._fl().devices.find((x) => x.id === this._sheet);
    if (!d) { el.innerHTML = ""; return; }
    const i = this._devInfo(d), a = i.a, facts = [], acts = [];
    let extra = "";
    const fact = (b, s) => facts.push(`<div class="fact"><b>${esc(b)}</b><span>${esc(s)}</span></div>`);
    let sub = i.off ? "Offline" : i.val;
    if (!i.off) {
      if (i.cat === "light") {
        if (i.on && a.brightness != null) fact(`${Math.round(a.brightness / 2.55)}%`, "Brightness");
        const modes = a.supported_color_modes || [];
        const dimmable = modes.some((m) => m !== "onoff");
        if (i.statusOnly) extra = `<p class="note">Status only: this light is shown here but not controlled from the dashboard.</p>`;
        else {
          acts.push(`<button data-act="toggle" class="${i.on ? "on" : ""}">${i.on ? "Turn off" : "Turn on"}</button>`);
          if (dimmable) extra = `<input type="range" min="1" max="100" value="${a.brightness != null ? Math.round(a.brightness / 2.55) : 100}" data-act="bright" data-live="bright">`;
        }
      } else if (i.cat === "plug" || (i.cat === "heating" && i.dom === "switch")) {
        if (i.power) fact(i.power, "Power now");
        acts.push(`<button data-act="toggle" class="${i.on ? "on" : ""}">${i.on ? "Turn off" : "Turn on"}</button>`);
      } else if (i.cat === "heating") {
        if (a.current_temperature != null) fact(`${a.current_temperature}°`, "Temperature");
        if (a.temperature != null) fact(`${a.temperature}°`, "Target");
        fact(a.hvac_action ? nice(a.hvac_action) : nice(i.s), "Heating");
        sub = nice(i.s);
      } else if (i.cat === "door" || i.cat === "window") {
        fact(i.alert ? "Open" : "Closed", i.meta.label);
      } else if (i.cat === "temperature") {
        fact(`${i.val}`, "Temperature");
      } else if (i.cat === "camera") {
        extra = `<p class="note">The live picture opens on request, so the plan never streams every camera at once.</p>`;
        acts.push(`<button data-act="info" class="on">Open live view</button>`);
      }
      if (i.st && i.st.last_changed) sub += ` · since ${new Date(i.st.last_changed).toLocaleTimeString([], GH_HM)}`;
    }
    if (i.cat !== "camera") acts.push(`<button data-act="info">More details</button>`);
    const path = this._config.tap_paths && this._config.tap_paths[d.entity];
    if (path && i.cat !== "camera") acts.push(`<button data-act="goto">Open page</button>`);
    el.innerHTML = `<div class="ph" style="--c:${i.meta.col}"><div class="ic"><ha-icon icon="${esc(i.icon)}"></ha-icon></div>
        <div class="t"><div class="n">${esc(i.name)}</div><div class="s">${esc(sub)}</div></div><button data-act="close" title="Close">✕</button></div>
      ${facts.length ? `<div class="facts">${facts.join("")}</div>` : ""}${extra}<div class="acts">${acts.join("")}</div>`;
  }

  // ------------------------------------------------------------ edit drawer
  _renderDrawer(keepFocus = false) {
    const host = this.shadowRoot.getElementById("drawer");
    if (!this._edit) { host.innerHTML = ""; return; }
    const sel = this._sel, fl = this._fl();
    let head = "", body = "";
    const obj = sel && (sel.kind === "item" ? fl.items : fl.devices).find((o) => o.id === sel.id);
    if (obj && sel.kind === "item") {
      const def = FURNITURE[obj.type] || FURNITURE.box;
      const types = FURN_CATS.map((c) => `<optgroup label="${c}">${Object.entries(FURNITURE).filter(([, f]) => f.cat === c)
        .map(([k, f]) => `<option value="${k}" ${k === obj.type ? "selected" : ""}>${esc(f.label)}</option>`).join("")}</optgroup>`).join("");
      head = `<b class="grow">${esc(obj.name || def.label)}</b><button data-act="rotate" data-v="-90">↺ 90°</button><button data-act="rotate" data-v="90">↻ 90°</button><button data-act="desel">Done</button>`;
      body = `<div class="form">
          <label>Name<input type="text" data-f="name" value="${esc(obj.name || "")}" placeholder="${esc(def.label)}"></label>
          <label>Type<select data-f="type">${types}</select></label>
          <label>Width (cm)<input type="number" data-f="w" value="${obj.w}" min="5" step="1"></label>
          <label>Depth (cm)<input type="number" data-f="d" value="${obj.d}" min="5" step="1"></label>
          <label>Rotation (°)<input type="number" data-f="rot" value="${Math.round(obj.rot || 0)}" step="1"></label>
          <label>From left (cm)<input type="number" data-f="x" value="${obj.x}" step="1"></label>
          <label>From back (cm)<input type="number" data-f="y" value="${obj.y}" step="1"></label>
        </div><div class="acts"><button data-act="dup">Duplicate</button><button data-act="del" class="warn">Delete</button></div>`;
    } else if (obj) {
      const i = this._devInfo(obj), q = this._search.toLowerCase();
      const icons = [...new Set([i.meta.icon, ...ICON_CHOICES])].map((ic) => `<button data-act="icon" data-v="${ic}" class="${ic === i.icon ? "on" : ""}" title="${ic}"><ha-icon icon="${ic}"></ha-icon></button>`).join("");
      const ents = this._entities(q, obj.entity).slice(0, 30)
        .map((e) => `<button data-act="assoc" data-v="${esc(e.id)}" style="--c:${e.col}"><ha-icon icon="${e.icon}"></ha-icon><span>${esc(e.name)}<small>${esc(e.id)}${e.placed ? " · already on the plan" : ""}</small></span></button>`).join("");
      head = `<b class="grow">${esc(i.name)}</b><button data-act="desel">Done</button>`;
      body = `<div class="form"><label>Displayed name<input type="text" data-f="dname" value="${esc(obj.name || "")}" placeholder="${esc((i.a && i.a.friendly_name) || obj.entity)}"></label>
          <label>Entity<input type="text" value="${esc(obj.entity)}" disabled></label></div>
        <div class="hint">Icon</div><div class="icons">${icons}</div>
        <div class="hint">Show a different Home Assistant entity here</div>
        <input type="search" id="search" placeholder="Search entities" value="${esc(this._search)}"><div class="list">${ents}</div>
        <div class="acts" style="margin-top:8px"><button data-act="del" class="warn">Remove from plan</button></div>
        <p class="hint">Removing only takes the icon off the plan. The device itself is not changed.</p>`;
    } else {
      const tabs = ["Furniture", "Devices", "Options"].map((t) => `<button data-act="tab" data-v="${t}" class="${t === this._tab ? "on" : ""}">${t}</button>`).join("");
      head = `${tabs}<span class="grow"></span><button data-act="drawer">${this._drawer ? "Hide ▾" : "Show ▴"}</button>`;
      if (this._tab === "Furniture") {
        const chips = FURN_CATS.map((c) => `<button data-act="cat" data-v="${c}" class="${c === this._cat ? "on" : ""}">${c}</button>`).join("");
        const tiles = Object.entries(FURNITURE).filter(([, f]) => f.cat === this._cat).map(([k, f]) => {
          const w = (f.w * PX_M) / 100, d = (f.d * PX_M) / 100, m = Math.max(w, d) * 0.62 + 4;
          return `<button data-act="add" data-v="${k}"><svg viewBox="${f1(-m)} ${f1(-m * 0.8)} ${f1(m * 2)} ${f1(m * 1.6)}">${f.draw(w, d)}</svg>${esc(f.label)}</button>`;
        }).join("");
        body = `<div class="chips">${chips}</div><div class="lib">${tiles}</div><p class="hint">Tap a piece to add it in the middle of the view, then drag it into place.</p>`;
      } else if (this._tab === "Devices") {
        const ents = this._entities(this._search.toLowerCase()).filter((e) => !e.placed).slice(0, 60)
          .map((e) => `<button data-act="place" data-v="${esc(e.id)}" style="--c:${e.col}"><ha-icon icon="${e.icon}"></ha-icon><span>${esc(e.name)}<small>${esc(e.cat)} · ${esc(e.id)}</small></span></button>`).join("");
        body = `<input type="search" id="search" placeholder="Search your devices" value="${esc(this._search)}"><div class="list">${ents || '<div class="hint">No matching devices that are not already on the plan.</div>'}</div>`;
      } else {
        const s = fl.settings;
        body = `<div class="acts" style="margin-bottom:8px"><button data-act="snap" class="${s.snap ? "on" : ""}">Snapping ${s.snap ? "on" : "off"}</button>
          <button data-act="reseed" class="warn">Restore fittings from the plans</button></div>
          <p class="hint">Snapping pulls furniture onto walls and lines it up with nearby pieces. Alignment guides show either way.
          "Restore fittings" puts back the kitchen units and bathroom fittings from your drawings on this floor (other furniture and devices stay).</p>`;
      }
    }
    host.innerHTML = `<div class="drawer ${!sel && !this._drawer ? "closed" : ""}"><div class="dh">${head}</div><div class="db">${body}</div></div>`;
    if (keepFocus) {
      const s = this.shadowRoot.getElementById("search");
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
  }

  // Home Assistant entities that can go on the plan, named after their device where possible
  _entities(q, current) {
    const h = this._hass, placed = new Set();
    for (const f of FLOOR_IDS) for (const d of this._plan.floors[f].devices) placed.add(d.entity);
    const reg = h.entities || {}, devs = h.devices || {};
    return Object.values(h.states)
      .filter((s) => PLACEABLE.includes(s.entity_id.split(".")[0]) && s.entity_id !== current)
      .filter((s) => !reg[s.entity_id] || (!reg[s.entity_id].hidden && !reg[s.entity_id].entity_category))
      .map((s) => {
        const r = reg[s.entity_id], dev = r && r.device_id && devs[r.device_id];
        const cat = devCat(s.entity_id, s), meta = DEV_CATS[cat];
        const fn = s.attributes.friendly_name || s.entity_id;
        const dn = dev && (dev.name_by_user || dev.name);
        return { id: s.entity_id, name: dn && !fn.startsWith(dn) ? `${dn} · ${fn}` : fn, cat: meta.label, col: meta.col, icon: meta.icon, placed: placed.has(s.entity_id), rank: cat === "other" ? 1 : 0 };
      })
      .filter((e) => !q || e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------ view (zoom and pan)
  _applyView() {
    const v = this._view;
    this.shadowRoot.getElementById("svg").setAttribute("viewBox", `${f1(v.x)} ${f1(v.y)} ${f1(v.w)} ${f1(v.h)}`);
    this.shadowRoot.getElementById("stage").classList.toggle("noswipe", this._edit || v.w < VIEW.w * 0.98);
    this.shadowRoot.getElementById("stage").classList.toggle("editing", this._edit);
  }

  _setView(v, full = true) {
    const w = Math.min(VIEW.w * 1.2, Math.max(VIEW.w / 6, v.w)), h = (w * VIEW.h) / VIEW.w;
    const cx = Math.min(VIEW.x + VIEW.w, Math.max(VIEW.x, v.x + v.w / 2)), cy = Math.min(VIEW.y + VIEW.h, Math.max(VIEW.y, v.y + v.h / 2));
    this._view = { x: cx - w / 2, y: cy - h / 2, w, h };
    this._applyView();
    if (!full) return;
    if (!this._raf) {
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._renderMarkers();
        this._renderSel();
      });
    }
  }

  _zoomAt(f, px, py) {
    const v = this._view, w = v.w / f, h = v.h / f;
    this._setView({ x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h });
  }

  _fit() {
    const o = ARCH[this._floor].outline, xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
    const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 10, y0 = Math.min(...ys) - 10, y1 = Math.max(...ys) + 10;
    const w = Math.max(x1 - x0, ((y1 - y0) * VIEW.w) / VIEW.h), h = (w * VIEW.h) / VIEW.w;
    this._setView({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
  }

  _toPlan(cx, cy) {
    const r = this.shadowRoot.getElementById("stage").getBoundingClientRect(), v = this._view;
    return [v.x + ((cx - r.left) / r.width) * v.w, v.y + ((cy - r.top) / r.height) * v.h];
  }

  // ------------------------------------------------------------ pointer handling
  _down(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const path = e.composedPath();
    if (path.some((n) => n.id === "drawer" || n.id === "sheet")) return;
    const stage = this.shadowRoot.getElementById("stage");
    // A new touch sequence: forget pointers whose release went elsewhere (e.g. to the page swiper)
    if (e.isPrimary) this._ptrs.clear();
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._ptrs.size === 2) {
      // Two fingers: pinch to zoom (cancels any drag in progress)
      const [a, b] = [...this._ptrs.values()];
      this._g = { mode: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), view: { ...this._view }, mid: this._toPlan((a.x + b.x) / 2, (a.y + b.y) / 2) };
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      return;
    }
    const t = path.find((n) => n.dataset && (n.dataset.h || n.dataset.kind));
    const [px, py] = this._toPlan(e.clientX, e.clientY);
    const base = { sx: e.clientX, sy: e.clientY, px, py, moved: false, id: e.pointerId };
    if (this._edit && t && t.dataset.h) {
      const it = this._fl().items.find((i) => i.id === this._sel.id);
      this._g = { ...base, mode: t.dataset.h, it, before: JSON.stringify(this._plan), o: { ...it } };
    } else if (this._edit && t && t.dataset.kind) {
      const list = t.dataset.kind === "item" ? this._fl().items : this._fl().devices;
      const obj = list.find((o) => o.id === t.dataset.id);
      if (!obj) return;
      const changed = !this._sel || this._sel.id !== obj.id;
      this._sel = { kind: t.dataset.kind, id: obj.id };
      if (changed) { this._search = ""; this._renderSel(); this._renderMarkers(); this._renderDrawer(); }
      this._g = { ...base, mode: "move", kind: t.dataset.kind, obj, ox: obj.x, oy: obj.y, before: JSON.stringify(this._plan) };
    } else if (!this._edit && t && t.dataset.kind === "device") {
      this._g = { ...base, mode: "tap", devId: t.dataset.id };
    } else {
      this._g = { ...base, mode: "pan", view: { ...this._view }, empty: true };
      if (!stage.classList.contains("noswipe")) { this._g.mode = "idle"; }
    }
    if (this._g.mode !== "idle") {
      if (this._edit || this._g.mode !== "tap") e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  }

  _move(e) {
    if (this._ptrs.has(e.pointerId)) this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this._g;
    if (!g) return;
    if (g.mode === "pinch") {
      if (this._ptrs.size < 2) return;
      const [a, b] = [...this._ptrs.values()], f = Math.hypot(a.x - b.x, a.y - b.y) / (g.dist || 1);
      const v = g.view, w = v.w / f, h = v.h / f, [mx, my] = g.mid;
      this._setView({ x: mx - ((mx - v.x) * w) / v.w, y: my - ((my - v.y) * h) / v.h, w, h });
      return;
    }
    if (e.pointerId !== g.id) return;
    const dist = Math.hypot(e.clientX - g.sx, e.clientY - g.sy);
    if (!g.moved && dist < 6) return;
    g.moved = true;
    if (g.mode === "idle" || g.mode === "tap") return;
    const [px, py] = this._toPlan(e.clientX, e.clientY), k = 1 / this._scale();
    if (g.mode === "pan") {
      const v = g.view, r = this.shadowRoot.getElementById("stage").getBoundingClientRect();
      this._setView({ ...v, x: v.x - ((e.clientX - g.sx) / r.width) * v.w, y: v.y - ((e.clientY - g.sy) / r.height) * v.h });
      return;
    }
    if (g.mode === "move") {
      const o = g.obj;
      let nx = toPx(g.ox, 0) + (px - g.px), ny = toPx(g.oy, 1) + (py - g.py);
      if (g.kind === "item") [nx, ny] = this._align(o, nx, ny, 7 * k);
      o.x = toCm(nx, 0);
      o.y = toCm(ny, 1);
      if (g.kind === "item") {
        const el = this.shadowRoot.querySelector(`#items .it[data-id="${CSS.escape(o.id)}"]`);
        if (el) el.setAttribute("transform", `translate(${f1(nx)} ${f1(ny)}) rotate(${f1(o.rot || 0)})`);
        this._frame(() => this._renderSel());
      } else this._placeMarker(o);
      return;
    }
    const it = g.it, [cx, cy] = this._px(g.o);
    if (g.mode === "rot") {
      let a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
      const step = this._fl().settings.snap ? 15 : 0;
      a = step ? Math.round(a / step) * step : (Math.abs(a - Math.round(a / 90) * 90) < 4 ? Math.round(a / 90) * 90 : a);
      it.rot = Math.round((((a % 360) + 360) % 360) * 10) / 10;
    } else if (g.mode === "size") {
      // Keep the opposite (top left) corner where it is
      const r0 = rad(g.o.rot || 0), cos = Math.cos(r0), sin = Math.sin(r0);
      const w0 = (g.o.w * PX_M) / 100, d0 = (g.o.d * PX_M) / 100;
      const ax = cx + (-w0 / 2) * cos - (-d0 / 2) * sin, ay = cy + (-w0 / 2) * sin + (-d0 / 2) * cos;
      const lx = (px - ax) * cos + (py - ay) * sin, ly = -(px - ax) * sin + (py - ay) * cos;
      const w = Math.max(5 * PX_M / 100, lx), d = Math.max(5 * PX_M / 100, ly);
      it.w = Math.round((w * 1000) / PX_M) / 10;
      it.d = Math.round((d * 1000) / PX_M) / 10;
      it.x = toCm(ax + (w / 2) * cos - (d / 2) * sin, 0);
      it.y = toCm(ay + (w / 2) * sin + (d / 2) * cos, 1);
    }
    const el = this.shadowRoot.querySelector(`#items .it[data-id="${CSS.escape(it.id)}"]`);
    if (el) this._frame(() => { el.outerHTML = this._itemSvg(it); this._renderSel(); });
  }

  _frame(fn) {
    this._pending = fn;
    if (this._fr) return;
    this._fr = requestAnimationFrame(() => { this._fr = 0; const f = this._pending; this._pending = null; if (f) f(); });
  }

  _up(e, cancelled) {
    this._ptrs.delete(e.pointerId);
    const g = this._g;
    if (!g) return;
    if (g.mode === "pinch") {
      if (this._ptrs.size < 2) this._g = null;
      return;
    }
    if (e.pointerId !== g.id) return;
    this._g = null;
    this.shadowRoot.getElementById("guides").innerHTML = "";
    if (cancelled) return;
    if (g.mode === "tap" && !g.moved) {
      this._sheet = g.devId;
      this._renderSheet();
      return;
    }
    if (g.mode === "pan" && !g.moved) {
      if (this._edit && this._sel) { this._sel = null; this._search = ""; this._renderSel(); this._renderMarkers(); this._renderDrawer(); }
      if (!this._edit && this._sheet) { this._sheet = null; this._renderSheet(); }
      return;
    }
    if (g.mode === "idle") {
      if (!this._edit && this._sheet && !g.moved) { this._sheet = null; this._renderSheet(); }
      return;
    }
    if (g.moved && ["move", "rot", "size"].includes(g.mode)) {
      this._undo.push(g.before);
      if (this._undo.length > 50) this._undo.shift();
      this._renderItems();
      this._renderSel();
      this._renderMarkers();
      this._renderGlow();
      this._renderDrawer();
      this._renderBar();
      this._queueSave();
    }
  }

  // Alignment guides: line a piece's edges or centre up with walls and other furniture. With snapping
  // on it is pulled onto the line; with it off the guide only appears once it is already lined up.
  _axisBox(o, x, y) {
    const w = (o.w * PX_M) / 100, d = (o.d * PX_M) / 100, r0 = rad(o.rot || 0);
    const hw = (Math.abs(Math.cos(r0)) * w + Math.abs(Math.sin(r0)) * d) / 2, hd = (Math.abs(Math.sin(r0)) * w + Math.abs(Math.cos(r0)) * d) / 2;
    return [x - hw, x, x + hw, y - hd, y, y + hd];
  }

  _align(o, x, y, tol) {
    const snapOn = this._fl().settings.snap, lim = snapOn ? tol : 0.6;
    const vx = [], vy = [];
    for (const w of ARCH[this._floor].walls) { vx.push(w[0], w[2]); vy.push(w[1], w[3]); }
    for (const it of this._fl().items) {
      if (it.id === o.id) continue;
      const b = this._axisBox(it, ...this._px(it));
      vx.push(b[0], b[1], b[2]); vy.push(b[3], b[4], b[5]);
    }
    const b = this._axisBox(o, x, y), best = (mine, lines) => {
      let hit = null;
      for (const m of mine) for (const l of lines) { const dd = l - m; if (Math.abs(dd) <= lim && (!hit || Math.abs(dd) < Math.abs(hit.d))) hit = { d: dd, at: l }; }
      return hit;
    };
    const hx = best([b[0], b[1], b[2]], vx), hy = best([b[3], b[4], b[5]], vy);
    if (hx && snapOn) x += hx.d;
    if (hy && snapOn) y += hy.d;
    const v = this._view, k = 1 / this._scale(), lines = [];
    if (hx) lines.push(`<line x1="${f1(hx.at)}" y1="${f1(v.y)}" x2="${f1(hx.at)}" y2="${f1(v.y + v.h)}"/>`);
    if (hy) lines.push(`<line x1="${f1(v.x)}" y1="${f1(hy.at)}" x2="${f1(v.x + v.w)}" y2="${f1(hy.at)}"/>`);
    this.shadowRoot.getElementById("guides").innerHTML = lines.length ? `<g stroke="#e879f9" stroke-width="${f1(1.4 * k)}" stroke-dasharray="${f1(5 * k)} ${f1(4 * k)}">${lines.join("")}</g>` : "";
    return [x, y];
  }

  // ------------------------------------------------------------ buttons and fields
  _centre() {
    const v = this._view;
    return [v.x + v.w / 2, v.y + v.h * (this._edit && this._drawer ? 0.3 : 0.5)];
  }

  _call(domain, service, data) {
    return this._hass.callService(domain, service, data).catch((err) => this._setStatus(`Could not change it: ${err.message || err}`));
  }

  _click(e) {
    const btn = e.composedPath().find((n) => n.dataset && n.dataset.act);
    if (!btn || btn.tagName === "INPUT") return;
    const act = btn.dataset.act, v = btn.dataset.v, fl = this._fl();
    const sel = this._sel, obj = sel && (sel.kind === "item" ? fl.items : fl.devices).find((o) => o.id === sel.id);
    const dev = this._sheet && fl.devices.find((d) => d.id === this._sheet);
    switch (act) {
      case "building": ghOpenPlanEditor(this._hass, this._floor); break;
      case "floor": this._floor = v; this._sel = null; this._sheet = null; this._search = ""; this._renderAll(); break;
      case "zoom": { const [cx, cy] = [this._view.x + this._view.w / 2, this._view.y + this._view.h / 2]; this._zoomAt(v === "in" ? 1.35 : 1 / 1.35, cx, cy); break; }
      case "fit": this._fit(); break;
      case "reset": this._setView({ ...VIEW }); break;
      case "edit":
        this._edit = !this._edit; this._sel = null; this._sheet = null; this._search = ""; this._drawer = true;
        this._renderAll();
        break;
      case "undo":
        if (this._undo.length) { this._plan = JSON.parse(this._undo.pop()); this._sel = null; this._renderAll(); this._queueSave(); }
        break;
      case "tab": this._tab = v; this._search = ""; this._drawer = true; this._renderDrawer(); break;
      case "cat": this._cat = v; this._renderDrawer(); break;
      case "drawer": this._drawer = !this._drawer; this._renderDrawer(); break;
      case "desel": this._sel = null; this._search = ""; this._renderSel(); this._renderMarkers(); this._renderDrawer(); break;
      case "add": {
        const def = FURNITURE[v], [cx, cy] = this._centre(), id = this._newId("i");
        this._change((f) => f.items.push({ id, type: v, x: toCm(cx, 0), y: toCm(cy, 1), w: def.w, d: def.d, rot: 0 }));
        this._sel = { kind: "item", id };
        this._renderItems(); this._renderSel(); this._renderDrawer(); this._renderBar();
        break;
      }
      case "place": {
        const [cx, cy] = this._centre(), id = this._newId("d");
        this._change((f) => f.devices.push({ id, entity: v, x: toCm(cx, 0), y: toCm(cy, 1) }));
        this._sel = { kind: "device", id }; this._search = "";
        this._renderMarkers(); this._renderGlow(); this._renderDrawer(); this._renderBar();
        break;
      }
      case "rotate": if (obj) { this._change(() => { obj.rot = (((Math.round(obj.rot || 0) + Number(v)) % 360) + 360) % 360; }); this._renderItems(); this._renderSel(); this._renderDrawer(); this._renderBar(); } break;
      case "dup": if (obj) {
        const copy = { ...clone(obj), id: this._newId("i"), x: Math.round((obj.x + 20) * 10) / 10, y: Math.round((obj.y + 20) * 10) / 10 };
        this._change((f) => f.items.push(copy));
        this._sel = { kind: "item", id: copy.id };
        this._renderItems(); this._renderSel(); this._renderDrawer(); this._renderBar();
      } break;
      case "del": if (obj) {
        const list = sel.kind === "item" ? "items" : "devices";
        this._change((f) => { f[list] = f[list].filter((o) => o.id !== obj.id); });
        this._sel = null; this._search = "";
        this._renderItems(); this._renderSel(); this._renderMarkers(); this._renderGlow(); this._renderDrawer(); this._renderBar();
      } break;
      case "icon": if (obj) { this._change(() => { obj.icon = v; }); this._renderMarkers(); this._renderDrawer(); this._renderBar(); } break;
      case "assoc": if (obj) { this._change(() => { obj.entity = v; delete obj.readout; }); this._search = ""; this._renderMarkers(); this._renderGlow(); this._renderDrawer(); this._renderBar(); } break;
      case "snap": this._change((f) => { f.settings.snap = !f.settings.snap; }); this._renderDrawer(); break;
      case "reseed":
        if (confirm(`Put the starting fittings for the ${FLOOR_NAMES[this._floor].toLowerCase()} back? Furniture you added and your devices stay where they are.`)) {
          const seeds = seedItems(this._floor);
          this._change((f) => { f.items = [...f.items.filter((i) => !seeds.some((s) => s.id === i.id)), ...seeds]; });
          this._renderItems(); this._renderBar();
        }
        break;
      case "close": this._sheet = null; this._renderSheet(); break;
      case "toggle": if (dev) this._call(dev.entity.split(".")[0], "toggle", { entity_id: dev.entity }); break;
      case "info": if (dev) this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: dev.entity }, bubbles: true, composed: true })); break;
      case "goto": if (dev) {
        history.pushState(null, "", this._config.tap_paths[dev.entity]);
        window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
      } break;
      default: break;
    }
  }

  _field(e) {
    const t = e.target;
    if (t.dataset.act === "bright") {
      const dev = this._sheet && this._fl().devices.find((d) => d.id === this._sheet);
      if (dev && !(this._config.status_only || []).includes(dev.entity)) this._call("light", "turn_on", { entity_id: dev.entity, brightness_pct: Number(t.value) });
      return;
    }
    const f = t.dataset.f, sel = this._sel;
    if (!f || !sel) return;
    const fl = this._fl(), obj = (sel.kind === "item" ? fl.items : fl.devices).find((o) => o.id === sel.id);
    if (!obj) return;
    this._change(() => {
      if (f === "name" || f === "dname") { const s = t.value.trim().slice(0, 40); if (s) obj.name = s; else delete obj.name; }
      else if (f === "type") obj.type = t.value;
      else {
        const n = Number(t.value);
        if (!Number.isFinite(n)) return;
        if (f === "w" || f === "d") obj[f] = Math.max(5, Math.round(n * 10) / 10);
        else if (f === "rot") obj.rot = ((n % 360) + 360) % 360;
        else obj[f] = Math.round(n * 10) / 10;
      }
    });
    this._renderItems(); this._renderSel(); this._renderMarkers(); this._renderBar();
    if (f === "type" || f === "name" || f === "dname") this._renderDrawer();
  }
}

/*
 * Glass Home Schedule card: a Mon–Sun timeline of a Home Assistant schedule helper.
 *
 *   type: custom:glasshome-schedule-card
 *   entity: schedule.heating_schedule
 *   on_label: 21°            # optional text, or entity with on_entity / off_entity
 *   on_entity: input_number.heating_comfort
 *   off_entity: input_number.heating_eco
 *   control: automation.heating_schedule_control   # shows whether the schedule is in charge
 *
 * Tap the card to open the schedule; its settings cog opens the visual week editor.
 */
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };

class GlassHomeScheduleCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    this._config = config;
    this._item = null;
    this._stamp = null;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    const st = hass.states[this._config.entity];
    const stamp = st && st.last_updated;
    if (!this._item || stamp !== this._stamp || Date.now() - (this._fetched || 0) > 300000) {
      this._stamp = stamp;
      this._fetch();
    }
    this._render();
  }

  connectedCallback() {
    clearInterval(this._tick);
    this._tick = setInterval(() => this._render(), 60000);
  }

  disconnectedCallback() {
    clearInterval(this._tick);
  }

  getCardSize() {
    return 5;
  }

  async _fetch() {
    this._fetched = Date.now();
    try {
      const items = await this._hass.callWS({ type: "schedule/list" });
      const id = this._config.entity.split(".")[1];
      this._item = items.find((i) => i.id === id) || null;
    } catch (err) {
      this._item = null;
    }
    this._render();
  }

  _temp(eid) {
    const st = eid && this._hass.states[eid];
    if (!st || isNaN(Number(st.state))) return "";
    return `${Number(st.state)}${st.attributes.unit_of_measurement || ""}`;
  }

  _render() {
    if (!this._hass || !this.shadowRoot) return;
    const c = this._config, st = this._hass.states[c.entity];
    const now = new Date();
    const today = (now.getDay() + 6) % 7, nowMin = now.getHours() * 60 + now.getMinutes();
    const onT = this._temp(c.on_entity) || c.on_label || "On", offT = this._temp(c.off_entity) || c.off_label || "Off";
    const ctl = c.control && this._hass.states[c.control];
    const inCharge = !ctl || ctl.state === "on";
    let status = "Loading schedule…";
    if (st) {
      const next = st.attributes.next_event ? new Date(st.attributes.next_event) : null;
      const until = next ? next.toLocaleTimeString([], GH_HM) : "";
      status = st.state === "on" ? `Heating period · ${onT}${until ? " until " + until : ""}` : `Eco · ${offT}${until ? " until " + until : ""}`;
    }
    const rows = DAYS.map((d, i) => {
      const blocks = ((this._item && this._item[d]) || []).map((b) => {
        const a = toMin(b.from), z = b.to === "24:00:00" ? 1440 : toMin(b.to) || 1440;
        return `<div class="blk" style="left:${(a / 1440) * 100}%;width:${((z - a) / 1440) * 100}%" title="${b.from.slice(0, 5)}–${b.to.slice(0, 5)}"></div>`;
      }).join("");
      const nowLine = i === today ? `<div class="now" style="left:${(nowMin / 1440) * 100}%"></div>` : "";
      return `<div class="row${i === today ? " today" : ""}"><span class="d">${DAY_LABELS[i]}</span><div class="track">${blocks}${nowLine}</div></div>`;
    }).join("");
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { padding: 14px 16px; background: ${GLASS_BG}; border: ${GLASS_BORDER}; box-shadow: ${GLASS_EDGE}; border-radius: 22px; color: #fff; cursor: pointer; }
        .top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; }
        .t { font-size: 18px; font-weight: 600; }
        .s { font-size: 15px; color: ${st && st.state === "on" ? "#ff9f0a" : "#98989f"}; text-align: right; }
        .row { display: flex; align-items: center; gap: 10px; height: 24px; margin: 4px 0; }
        .d { width: 34px; font-size: 14px; color: #98989f; }
        .today .d { color: #fff; font-weight: 700; }
        .track { position: relative; flex: 1; height: 16px; border-radius: 8px; background: #2c2c2e; overflow: hidden; }
        .blk { position: absolute; top: 0; bottom: 0; background: #ff9f0a; border-radius: 8px; }
        .now { position: absolute; top: -2px; bottom: -2px; width: 2px; background: #fff; box-shadow: 0 0 6px #fff; }
        .axis { display: flex; justify-content: space-between; margin: 4px 0 0 44px; font-size: 12px; color: #6e6e73; }
        .foot { display: flex; justify-content: space-between; margin-top: 10px; font-size: 14px; color: #98989f; }
        .foot b { color: #fff; }
        .warn { color: #ff9f0a; }
      </style>
      <ha-card>
        <div class="top"><span class="t">Heating schedule</span><span class="s">${status}</span></div>
        ${rows}
        <div class="axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
        <div class="foot"><span>Orange = <b>${onT}</b> · grey = <b>${offT}</b></span>
          <span class="${inCharge ? "" : "warn"}">${inCharge ? "Running the heating" : "Not in charge yet · Hive app schedule active"}</span></div>
      </ha-card>`;
    this.shadowRoot.querySelector("ha-card").onclick = () =>
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: c.entity }, bubbles: true, composed: true }));
  }
}

/*
 * Glass Home Light card: one tap toggles the light (or plug), the round button opens the full
 * Home Assistant controls (brightness, colour wheel, warmth, effects). Everything shown comes
 * from the entity's real state and supported features.
 *
 *   type: custom:glasshome-light-card
 *   entity: light.example_ceiling
 *   name: Living Room          # optional
 *   power: sensor.x_power      # optional, plugs: shows live watts
 *   readonly: true             # optional, status only (e.g. lights run by another app)
 *   note: Plug timer           # optional text after the state
 *   compact: true              # optional, hides the feature chips (smaller tile)
 */
const fireMoreInfo = (node, entityId) =>
  node.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));

class GlassHomeLightCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    this._config = config;
    this._key = null;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._click(e));
    }
  }

  set hass(hass) {
    this._hass = hass;
    const s = hass.states[this._config.entity], p = this._config.power && hass.states[this._config.power];
    const key = JSON.stringify([s && s.state, s && s.attributes, p && p.state]);
    if (key !== this._key) {
      this._key = key;
      this._render();
    }
  }

  getCardSize() {
    return 3;
  }

  _click(e) {
    const c = this._config, s = this._hass && this._hass.states[c.entity];
    if (!s) return;
    if (e.composedPath().some((n) => n.classList && n.classList.contains("adjust")) || c.readonly) {
      fireMoreInfo(this, c.entity);
      return;
    }
    if (s.state === "unavailable") return;
    const domain = c.entity.split(".")[0];
    this._hass.callService(domain === "light" ? "light" : "homeassistant", "toggle", { entity_id: c.entity });
  }

  _render() {
    const c = this._config, s = this._hass.states[c.entity];
    const esc2 = (v) => String(v ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    if (!s) {
      this.shadowRoot.innerHTML = `<ha-card style="padding:16px;border-radius:24px">Entity not found: ${esc2(c.entity)}</ha-card>`;
      return;
    }
    const a = s.attributes, domain = c.entity.split(".")[0];
    const on = s.state === "on", unavailable = s.state === "unavailable";
    const modes = a.supported_color_modes || [];
    const dimmable = domain === "light" && modes.some((m) => m !== "onoff");
    const warmth = modes.includes("color_temp");
    const colour = modes.some((m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(m));
    const effects = (a.effect_list || []).filter((x) => String(x).toLowerCase() !== "off");
    const rgb = on ? (a.rgb_color || (domain === "light" ? [255, 196, 120] : [255, 214, 10])) : null;
    const pct = on && a.brightness != null ? Math.round(a.brightness / 2.55) : null;
    let state = unavailable ? "Unavailable" : on ? "On" : "Off";
    if (on && pct != null) state += ` · ${pct}%`;
    if (on && a.color_mode === "color_temp" && a.color_temp_kelvin) state += ` · ${a.color_temp_kelvin} K`;
    else if (on && colour && a.color_mode && a.color_mode !== "color_temp" && a.hs_color) state += " · colour";
    if (on && a.effect && String(a.effect).toLowerCase() !== "off") state += ` · ${a.effect}`;
    const p = c.power && this._hass.states[c.power];
    if (p && !isNaN(Number(p.state))) state += ` · ${Math.round(Number(p.state) * 10) / 10} W`;
    if (c.note) state += ` · ${c.note}`;
    const chips = [];
    if (dimmable) chips.push("Dimmable");
    if (warmth) chips.push(`${a.min_color_temp_kelvin || ""}–${a.max_color_temp_kelvin || ""} K`.replace("– K", "Warmth"));
    if (colour) chips.push("Colour");
    if (effects.length) chips.push(effects.join(" · "));
    if (domain === "switch") chips.push(c.power ? "Smart plug · power" : "Smart plug");
    if (c.readonly) chips.push("Status only");
    const icon = c.icon || a.icon || (domain === "light" ? (on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline") : "mdi:power-socket-uk");
    const name = c.name || a.friendly_name || c.entity;
    // The icon keeps the light's real colour; the card itself glows purple when on
    const col = rgb ? rgb.join(",") : "152,152,159";
    const bg = on
      ? `linear-gradient(155deg, rgba(139,92,246,0.58) 0%, rgba(109,40,217,0.30) 55%, rgba(26,20,46,0.70) 100%)`
      : GLASS_BG;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        ha-card { position: relative; box-sizing: border-box; height: 100%; min-height: ${c.compact ? 136 : 150}px; padding: 16px; border-radius: 24px;
          background: ${bg}; border: 1px solid ${on ? `rgba(${PURPLE},0.55)` : GLASS_LINE}; color: #fff; cursor: pointer;
          box-shadow: ${on ? `0 0 26px rgba(139,92,246,0.32), inset 0 1px 0 rgba(255,255,255,0.26), inset 0 -1px 0 rgba(255,255,255,0.06), 0 8px 24px rgba(6,3,20,0.30)` : GLASS_EDGE};
          display: flex; flex-direction: column; gap: 8px; overflow: hidden; transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
          ${unavailable ? "opacity: 0.5;" : ""}
          -webkit-tap-highlight-color: transparent; user-select: none; }
        ha-card:active { transform: scale(0.985); }
        .top { display: flex; justify-content: space-between; align-items: flex-start; }
        .ic { width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          background: ${on ? "#fff" : "rgba(255,255,255,0.07)"}; color: ${on ? (rgb ? `rgb(${col})` : "#7c3aed") : "#8e8aa0"}; --mdc-icon-size: 26px;
          ${on ? "box-shadow: 0 0 14px rgba(255,255,255,0.35);" : ""} }
        .adjust { width: 44px; height: 44px; border-radius: 50%; border: 0; display: flex; align-items: center; justify-content: center;
          background: ${on ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)"}; color: #fff; --mdc-icon-size: 22px; cursor: pointer; }
        .name { font-size: 18px; font-weight: 600; line-height: 1.2; margin-top: 2px; letter-spacing: -0.2px; }
        .state { font-size: 14px; color: ${on ? "rgba(255,255,255,0.86)" : "#8e8aa0"}; margin-top: 2px; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; }
        .chip { font-size: 12.5px; padding: 3px 9px; border-radius: 10px; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.78); }
        .bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.14); overflow: hidden; }
        .bar span { display: block; height: 100%; width: ${pct ?? 0}%; border-radius: 3px;
          background: linear-gradient(90deg, #c4b5fd, #fff); box-shadow: 0 0 8px rgba(255,255,255,0.5); }
      </style>
      <ha-card role="button" aria-label="${esc2(name)} ${on ? "on" : "off"}">
        <div class="top"><div class="ic"><ha-icon icon="${esc2(icon)}"></ha-icon></div>
          ${c.readonly ? "" : `<button class="adjust" aria-label="Adjust ${esc2(name)}"><ha-icon icon="mdi:tune-variant"></ha-icon></button>`}</div>
        <div><div class="name">${esc2(name)}</div><div class="state">${esc2(state)}</div></div>
        ${dimmable ? `<div class="bar"><span></span></div>` : ""}
        ${c.compact ? "" : `<div class="chips">${chips.map((x) => `<span class="chip">${esc2(x)}</span>`).join("")}</div>`}
      </ha-card>`;
  }
}

/*
 * Glass Home Room card: room heading with how many of its lights/plugs are on, plus On and Off.
 *
 *   type: custom:glasshome-room-card
 *   name: Living Room
 *   icon: mdi:sofa
 *   entities: [light.example_ceiling, switch.example_lamp_plug]
 *   stacked: true             # optional, buttons on a second line (for narrow columns)
 */
class GlassHomeRoomCard extends HTMLElement {
  setConfig(config) {
    if (!config.entities || !config.entities.length) throw new Error("entities are required");
    this._config = config;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => {
        const b = e.composedPath().find((n) => n.dataset && n.dataset.act);
        if (b && this._hass) this._hass.callService("homeassistant", b.dataset.act === "on" ? "turn_on" : "turn_off", { entity_id: this._config.entities });
      });
    }
  }

  set hass(hass) {
    this._hass = hass;
    const key = this._config.entities.map((e) => hass.states[e] && hass.states[e].state).join();
    if (key !== this._key) {
      this._key = key;
      this._render();
    }
  }

  getCardSize() {
    return 1;
  }

  _render() {
    const c = this._config, st = this._hass.states;
    const on = c.entities.filter((e) => st[e] && st[e].state === "on").length;
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 16px; border-radius: 22px; background: ${GLASS_BG};
          border: ${on ? `1px solid rgba(${PURPLE},0.45)` : GLASS_BORDER}; box-shadow: ${on ? "0 0 20px rgba(139,92,246,0.22), " : ""}${GLASS_EDGE}; color: #fff; }
        ha-icon { --mdc-icon-size: 26px; color: ${on ? `rgb(${PURPLE})` : "#8e8aa0"}; }
        .t { flex: 1; min-width: 0; } .n { font-size: 19px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } .s { font-size: 14px; color: #8e8aa0; }
        button { min-width: 72px; height: 48px; border: 0; border-radius: 16px; font: inherit; font-size: 16px; font-weight: 600; cursor: pointer; }
        .on { background: linear-gradient(160deg, #a78bfa, #7c3aed); color: #fff; } .off { background: rgba(255,255,255,0.08); color: #fff; }
        ${c.stacked ? "ha-card { flex-wrap: wrap; padding: 14px; } .t { flex: 1 1 calc(100% - 40px); } button { flex: 1 1 0; min-width: 0; }" : ""}
      </style>
      <ha-card><ha-icon icon="${c.icon || "mdi:home"}"></ha-icon>
        <div class="t"><div class="n">${c.name || "Room"}</div><div class="s">${on} of ${c.entities.length} on</div></div>
        <button class="on" data-act="on">On</button><button class="off" data-act="off">Off</button></ha-card>`;
  }
}

/*
 * Glass Home Pager card: several pages of ordinary Home Assistant cards, swiped horizontally,
 * with page dots and an icon bar. Swipes that start on sliders, inputs or controls are ignored.
 * The current page is kept in the URL hash (#home, #security ...) so other views can link to it.
 *
 *   type: custom:glasshome-pager-card
 *   pages:
 *     - id: home
 *       title: Home
 *       icon: mdi:home
 *       accent: "#8b5cf6"
 *       cards:
 *         - span: 12          # width on a 12-column grid (default 12)
 *           uid: hero         # permanent tile id (editable pages)
 *           type: tile ...
 *       edit:                 # optional: the page can be edited on the tablet (hold the pencil)
 *         storage_key: glasshome_homepage
 *         exclude: [scene.test]          # entities left out of the tile library
 *         status_only: [light.porch]     # offered only as status tiles, never as controls
 */
// Set once the first pager has opened since the page loaded: a reload or fresh open always starts on
// the start page, while moving here from a sub-page (its home#page link) still opens that page
let pagerOpened = false;
// Below this dashboard width the pager scales the whole layout onto a narrow screen (see _fitCover)
const PAGER_COMPACT = 600;
// The smallest shrink-to-fit a page gets before it scrolls instead (the Tab A needs 0.95 at most)
const PAGER_MIN_FIT = 0.92;
// The smallest scale a compact page gets to fit on one screen; a page that would need less scrolls at it
const PAGER_COVER_MIN = 0.6;
const NO_SWIPE = /^(INPUT|TEXTAREA|SELECT|HA-SLIDER|MWC-SLIDER|ROUND-SLIDER|HA-CONTROL-SLIDER|HA-CONTROL-CIRCULAR-SLIDER|HA-CONTROL-NUMBER-BUTTONS|HA-CONTROL-SELECT|HA-CONTROL-SWITCH|HA-STATE-CONTROL-[A-Z-]+|HUI-CARD-FEATURES|HUI-[A-Z-]+-CARD-FEATURE|HA-ENTITY-TOGGLE|HA-SWITCH)$/;

// Homepage editor vocabulary
const tileKind = (c) => (c.type === "custom:glasshome-hero-card" ? "hero" : c.type === "button" ? "shortcut"
  : c.type === "custom:glasshome-light-card" ? "control" : c.type === "custom:glasshome-chip-card" ? (c.kind === "camera" ? "camera" : "status")
  : c.type === "custom:glasshome-all-card" ? "all" : c.type === "markdown" ? "notes" : c.type === "custom:glasshome-bin-card" ? "bins" : "other");
const KIND_LABEL = { hero: "Welcome panel", shortcut: "Shortcut", control: "Control", status: "Status", camera: "Camera",
  all: "All lights button", notes: "Attention strip", bins: "Bin collection", other: "Card" };
const SIZES = [[3, "Small", "¼ width"], [4, "Medium", "⅓ width"], [6, "Large", "½ width"], [12, "Full", "Full width"]];
const LIB_CATS = ["Lighting scenes", "Scripts", "Automations", "Heating", "Device controls", "Navigation", "Information & status", "Cameras"];
const SCENE_ICON = { bright: "mdi:white-balance-sunny", relax: "mdi:sofa-outline", evening: "mdi:weather-sunset", night: "mdi:weather-night",
  film: "mdi:movie-open-outline", movie: "mdi:movie-open-outline", all_off: "mdi:lightbulb-group-off-outline", home: "mdi:home-outline",
  morning: "mdi:weather-sunset-up" };
const EDIT_ICONS = ["mdi:lightbulb-outline", "mdi:lightbulb-group", "mdi:lamp-outline", "mdi:ceiling-light-outline", "mdi:led-strip-variant",
  "mdi:light-recessed", "mdi:weather-sunset", "mdi:weather-sunset-up", "mdi:weather-night", "mdi:white-balance-sunny", "mdi:sofa-outline",
  "mdi:movie-open-outline", "mdi:television", "mdi:speaker", "mdi:music-note", "mdi:palette-outline", "mdi:fire", "mdi:radiator",
  "mdi:thermostat", "mdi:thermometer", "mdi:snowflake", "mdi:fan", "mdi:power-socket-uk", "mdi:power", "mdi:washing-machine",
  "mdi:cctv", "mdi:shield-home-outline", "mdi:lock-outline", "mdi:door", "mdi:home-outline", "mdi:floor-plan", "mdi:bed-outline",
  "mdi:stove", "mdi:silverware-fork-knife", "mdi:account-outline", "mdi:robot-outline", "mdi:calendar-clock", "mdi:access-point-network",
  "mdi:star-outline", "mdi:heart-outline"];
// The glass shortcut look used by the dashboard's big buttons, for new shortcut tiles
const shortcutStyle = (accent) => {
  const rgb = [1, 3, 5].map((k) => parseInt(accent.slice(k, k + 2), 16)).join(",");
  return "ha-card { height: 92px; border-radius: 24px !important; font-size: 15px; font-weight: 600; --mdc-icon-size: 24px; gap: 6px; justify-content: center; }\n"
    + `ha-state-icon { color: ${accent}; background: rgba(${rgb},0.15); border-radius: 50%; width: 44px !important; box-shadow: 0 0 14px rgba(${rgb},0.18);`
    + " display: flex; align-items: center; justify-content: center; }\n";
};

class GlassHomePagerCard extends HTMLElement {
  setConfig(config) {
    if (!config.pages || !config.pages.length) throw new Error("pages are required");
    ghCheckDashboard();
    // first visit (no settings yet): the welcome screen
    if (ghNeedsSetup() && ghDashPath() === GH_LOADED.path) setTimeout(() => wnavGo(`${ghBase()}/welcome`), 0);
    // pages for features that are switched off in the glasshome: settings are left out; navigation.home is the start page
    config = { ...config, start: (GH_CFG.navigation && GH_CFG.navigation.home) || config.start,
      pages: config.pages.filter((p) => ghFeature(p.feature)).map((p) => (p.edit ? { ...p, edit: ghResolve(p.edit, [], []) } : p)) };
    this._config = config;
    this._index = 0;
    this._els = config.pages.map(() => null);
    // Working copy of each page's tiles (an editable page may replace it with the saved layout)
    this._cards = config.pages.map((p) => (p.cards || []).map((c, k) => (c.uid ? clone(c) : { ...clone(c), uid: `auto-${k}` })));
    this._original = config.pages.map(() => null);
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) {
      this._started = true;
      this._init();
      return;
    }
    // Only the visible page and its neighbours get live updates; far pages catch up when shown.
    // This keeps state changes from re-rendering dozens of off-screen cards (smoother on the Tab A).
    this._els.forEach((list, i) => { if (list && Math.abs(i - this._index) <= 1) list.forEach((el) => this._feed(el)); });
  }

  getCardSize() {
    return 20;
  }

  // Cards that Home Assistant loads on demand are plain elements until their code arrives.
  // Setting hass on them too early creates an own property that hides the card's reactive setter.
  _feed(el) {
    if (!el.localName.includes("-")) return; // a placeholder for a switched-off card
    if (customElements.get(el.localName)) {
      if (el.hass !== this._hass) el.hass = this._hass;
    } else if (!el._glasshomeWaiting) {
      el._glasshomeWaiting = true;
      customElements.whenDefined(el.localName).then(() => { el._glasshomeWaiting = false; el.hass = this._hass; });
    }
  }

  async _init() {
    const pages = this._config.pages;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .root { --gh-w: 900px; position: relative; height: 100vh; display: flex; flex-direction: column; overflow: hidden;
          background: #120d22 ${(GH_CFG.appearance || {}).background === "plain" ? "" : `url("${GH_ASSETS}bg.svg")`} center / cover no-repeat; }
        .viewport { position: relative; flex: 1; min-height: 0; overflow: hidden; touch-action: pan-y; }
        .track { display: flex; height: 100%; width: 100%; transform: translate3d(0, 0, 0); will-change: transform; backface-visibility: hidden; }
        .track.anim { transition: transform 0.26s cubic-bezier(0.22, 0.9, 0.3, 1); }
        .page { flex: 0 0 100%; height: 100%; overflow: hidden; contain: layout paint; touch-action: pan-y; }
        .page.far { visibility: hidden; }
        .grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; padding: 14px 16px 12px; max-width: var(--gh-w);
          margin: 0 auto; align-items: stretch; box-sizing: border-box; transform-origin: top center; }
        .grid > div { min-width: 0; }
        .grid > .tall > :first-child { display: block; height: 100%; }
        .bar { flex: 0 0 auto; padding: 2px max(14px, env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) max(14px, env(safe-area-inset-left, 0px)); }
        /* A page too tall to shrink a little (a shorter screen such as an open foldable) scrolls at full size */
        .page.scroll { overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: none; }
        .page.scroll::-webkit-scrollbar { display: none; }
        /* Narrow screens (a phone, a foldable's cover screen): the tablet layout, laid out wider than the
           screen (inline width) and scaled down from the left edge to fill it. The tablet never gets this class. */
        .root.compact .grid { max-width: none; margin: 0; transform-origin: top left; }
        .page { container-type: inline-size; }
        ${GH_DEMO ? "@media (max-width: 600px) { .root.compact .grid { padding-bottom: 46px !important; } }" : ""}
        @media (min-width: 1600px) and (min-height: 1000px) { .root { --gh-w: 1180px; } }
        @media (min-width: 2200px) and (min-height: 1300px) { .root { --gh-w: 1400px; } }
        @container (max-width: 599px) {
          .root.reflow .grid > div[data-span="3"], .root.reflow .grid > div[data-span="4"] { grid-column: span 6 !important; }
          .root.reflow .grid { gap: 10px; padding: 12px 12px 10px; }
        }
        .root.compact .bar { padding-left: max(8px, env(safe-area-inset-left, 0px)); padding-right: max(8px, env(safe-area-inset-right, 0px)); }
        .root.compact .nav { gap: 2px; padding: 4px; border-radius: 24px; }
        .root.compact .nb { height: 54px; padding: 0 1px; border-radius: 19px; font-size: 10.5px; letter-spacing: 0; gap: 3px; --mdc-icon-size: 22px;
          line-height: 1.1; text-align: center; overflow: hidden; }
        .root.compact .pencil { bottom: 12px; right: 14px; }
        .dots { display: flex; justify-content: center; gap: 7px; height: 10px; align-items: center; }
        .dot { width: 6px; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.18); transition: width 0.2s ease, background 0.2s ease; }
        .dot.on { width: 20px; background: #a78bfa; }
        /* Floating glass bar; the current page is a softly glowing purple pill */
        .nav { display: grid; grid-template-columns: repeat(${pages.length + (WNAV_SETTINGS ? 1 : 0)}, minmax(0, 1fr)); gap: 4px; max-width: var(--gh-w); margin: 6px auto 0;
          padding: 6px; border-radius: 28px; background: ${LG_FLOAT_BG}; border: 1px solid ${LG_FLOAT_LINE}; box-shadow: ${LG_FLOAT_SHADOW}; }
        .nb { height: 60px; border: 0; border-radius: 22px; background: transparent; color: #8e8aa0; font: inherit; font-size: 12.5px; font-weight: 600;
          letter-spacing: 0.1px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer;
          --mdc-icon-size: 25px; transition: background 0.2s ease, color 0.2s ease; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        .nb.on { color: #fff; background: ${LG_ON_BG}; box-shadow: ${LG_ON_SHADOW}; }
        .nb:active { transform: scale(0.96); }
        .nb.on ha-icon { color: #fff; }
  .nb { container-type: inline-size; }
  .nb ha-icon { flex: none; }
  .nt { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @container (max-width: 35.9px) { .nt { display: none; } }
  /* short landscape screens (a phone on its side): icon beside the label, so the bar takes less height */
  @media (max-height: 500px) and (min-width: 600px) {
    .nb { height: 44px; flex-direction: row; gap: 6px; --mdc-icon-size: 21px; }
    .nav { padding: 4px; }
    .spacer { height: 64px; }
  }

        /* Homepage editor (hidden unless editing; the normal page looks exactly as before) */
        .page { position: relative; }
        .grid { position: relative; }
        .w { position: relative; }
        .w > .cover, .guide { display: none; }
        /* default bottom right; drag it anywhere (where it was put is remembered on this device) */
        .pencil { position: absolute; z-index: 4; bottom: 18px; right: max(30px, calc(50% - 420px)); width: 40px; height: 40px; padding: 0;
          border-radius: 50%; border: 1px solid rgba(255,255,255,0.18); background: linear-gradient(155deg, rgba(255,255,255,0.16), rgba(255,255,255,0.03)), rgba(14,10,30,0.38); color: rgba(255,255,255,0.9);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), 0 6px 16px rgba(4,2,16,0.35);
          display: flex; align-items: center; justify-content: center; --mdc-icon-size: 19px; cursor: pointer; touch-action: none;
          user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; }
        .pencil svg { position: absolute; inset: -3px; width: 46px; height: 46px; transform: rotate(-90deg); pointer-events: none; }
        .pencil circle { fill: none; stroke: #c4b5fd; stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 100; stroke-dashoffset: 100; }
        .pencil.hold { background: rgba(139,92,246,0.45); }
        .pencil.moved { top: var(--py); left: var(--px); right: auto; bottom: auto; }
        .pencil.drag { cursor: grabbing; transform: scale(1.12); background: rgba(139,92,246,0.5); box-shadow: 0 8px 22px rgba(0,0,0,0.45); }
        .pencil.hold circle { stroke-dashoffset: 0; transition: stroke-dashoffset 0.65s linear; }
        .editing .pencil { display: none; }
        .editing .guide { display: grid; position: absolute; inset: 0; z-index: 0; padding: 14px 16px 12px; box-sizing: border-box;
          grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 12px; pointer-events: none; }
        .guide i { border-radius: 12px; background: rgba(167,139,250,0.045); border: 1px dashed rgba(167,139,250,0.16); }
        .editing .w { transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.3, 1); }
        .editing .w > .cover { display: block; position: absolute; inset: -3px; z-index: 3; border-radius: 26px; cursor: grab; touch-action: none;
          box-shadow: inset 0 0 0 1px rgba(167,139,250,0.22); transition: box-shadow 0.2s ease, background 0.2s ease; }
        .editing .w.lock > .cover { cursor: default; box-shadow: none; }
        .editing .w.sel > .cover { background: rgba(139,92,246,0.10); box-shadow: 0 0 0 2px #a78bfa, 0 0 24px rgba(167,139,250,0.45); }
        .editing .w.drag { z-index: 10; transition: none; }
        .editing .w.drag > .cover { cursor: grabbing; background: rgba(139,92,246,0.12); box-shadow: 0 0 0 2px #a78bfa, 0 22px 44px rgba(0,0,0,0.55); }
        .ebar { display: none; }
        .editing .nav { display: none; }
        .editing .ebar { display: grid; grid-template-columns: 1fr 1fr 1.25fr 1.25fr; gap: 6px; max-width: var(--gh-w); margin: 6px auto 0; padding: 6px;
          border-radius: 28px; background: ${LG_FLOAT_BG};
          border: 1px solid rgba(167,139,250,0.34); box-shadow: 0 12px 30px rgba(0,0,0,0.45), 0 0 22px rgba(139,92,246,0.18), inset 0 1px 0 rgba(255,255,255,0.20); }
        .eb { height: 60px; border: 0; border-radius: 22px; background: rgba(255,255,255,0.05); color: #d8d4e8; font: inherit; font-size: 13px;
          font-weight: 600; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; --mdc-icon-size: 22px;
          cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        .eb:active { transform: scale(0.97); }
        .eb.pri { color: #fff; background: linear-gradient(160deg, rgba(139,92,246,0.85), rgba(109,40,217,0.65)); box-shadow: 0 0 18px rgba(139,92,246,0.4); }
        .eb.add { color: #e9e2ff; background: rgba(139,92,246,0.16); box-shadow: inset 0 0 0 1px rgba(167,139,250,0.4); }
        .toast { position: absolute; left: 50%; bottom: 112px; z-index: 30; max-width: min(640px, 86%); transform: translate(-50%, 12px); opacity: 0;
          padding: 12px 18px; border-radius: 18px; background: linear-gradient(155deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03)), rgba(28,22,50,0.74); border: 1px solid rgba(167,139,250,0.34); color: #fff;
          font-size: 14.5px; line-height: 1.35; text-align: center; box-shadow: ${LG_FLOAT_SHADOW}; pointer-events: none;
          -webkit-backdrop-filter: ${LG_FLOAT_BLUR}; backdrop-filter: ${LG_FLOAT_BLUR};
          transition: opacity 0.2s ease, transform 0.2s ease; }
        .toast.show { opacity: 1; transform: translate(-50%, 0); }
        .toast.warn { border-color: rgba(255,179,64,0.55); }
        .sheet { position: absolute; inset: 0; z-index: 20; display: flex; align-items: flex-end; justify-content: center; padding: 0 14px 14px;
          background: rgba(6,4,16,0.55); opacity: 0; pointer-events: none; transition: opacity 0.2s ease; }
        .sheet.open { opacity: 1; pointer-events: auto; }
        .panel { width: 100%; max-width: 760px; max-height: 74%; overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; padding: 18px;
          border-radius: 28px; color: #fff; background: linear-gradient(155deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.05) 100%), rgba(27,21,50,0.78);
          border: 1px solid ${LG_FLOAT_LINE}; box-shadow: 0 -10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22);
          -webkit-backdrop-filter: ${LG_FLOAT_BLUR}; backdrop-filter: ${LG_FLOAT_BLUR};
          transform: translateY(24px); transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.3, 1); }
        .sheet.open .panel { transform: none; }
        ${LG_NOBLUR(".panel, .toast")}
        .ph { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .ph .ic { width: 44px; height: 44px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          background: rgba(167,139,250,0.16); color: #c4b5fd; --mdc-icon-size: 22px; }
        .ph .tt { font-size: 18px; font-weight: 700; }
        .ph .st { font-size: 13px; color: #a29db8; margin-top: 2px; }
        .ph .x { margin-left: auto; }
        .acts { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; }
        .sb { min-height: 56px; border: 1px solid rgba(255,255,255,0.08); border-radius: 18px; background: rgba(255,255,255,0.05); color: #fff;
          font: inherit; font-size: 14px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 12px;
          --mdc-icon-size: 20px; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        .sb:active { transform: scale(0.97); }
        .sb.on { background: rgba(139,92,246,0.35); border-color: rgba(167,139,250,0.7); }
        .sb.pri { background: linear-gradient(160deg, rgba(139,92,246,0.85), rgba(109,40,217,0.65)); border-color: transparent; }
        .sb.danger { color: #ffb4b4; }
        .sb.round { min-height: 40px; width: 40px; padding: 0; border-radius: 50%; }
        .lbl { font-size: 12.5px; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; color: #8e8aa0; margin: 16px 2px 8px; }
        .sizes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .sizes .sb { flex-direction: column; gap: 1px; }
        .sizes small { font-size: 11.5px; color: #a29db8; font-weight: 500; }
        .opts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
        .opt { justify-content: flex-start; text-align: left; min-height: 60px; }
        .opt ha-icon { width: 36px; height: 36px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          background: rgba(167,139,250,0.14); color: #c4b5fd; }
        .opt .on2 { min-width: 0; }
        .opt .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .opt .s { font-size: 12px; font-weight: 500; color: #a29db8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 8px; }
        .icons .sb { min-height: 56px; padding: 0; --mdc-icon-size: 24px; }
        .field { width: 100%; box-sizing: border-box; height: 52px; padding: 0 16px; border-radius: 16px; border: 1px solid rgba(167,139,250,0.35);
          background: rgba(10,8,24,0.6); color: #fff; font: inherit; font-size: 17px; outline: none; }
        .field:focus { border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(139,92,246,0.25); }
        .row2 { display: flex; gap: 8px; margin-top: 14px; }
        .row2 .sb { flex: 1; }
        .txt { font-size: 15px; line-height: 1.45; color: #cfcbe0; margin: 0 2px; }
      </style>
      <div class="root">
        <div class="viewport"><div class="track">${pages.map((p, i) => `<div class="page" data-i="${i}">`
          + (p.edit ? `<button class="pencil noswipe" data-i="${i}" aria-label="Hold to edit this page"><svg viewBox="0 0 46 46"><circle cx="23" cy="23" r="20" pathLength="100"/></svg><ha-icon icon="mdi:pencil-outline"></ha-icon></button>` : "")
          + `<div class="grid"></div></div>`).join("")}</div></div>
        <div class="bar">
          <div class="dots">${pages.map((p, i) => `<span class="dot" data-i="${i}"></span>`).join("")}</div>
          <div class="nav">${pages.map((p, i) => `<button class="nb" data-i="${i}" style="--acc:${p.accent || "#fff"}" aria-label="${esc(ghPageTitle(p.id, p.title))}"><ha-icon icon="${p.icon}"></ha-icon><span class="nt">${esc(ghPageTitle(p.id, p.title))}</span></button>`).join("")}${WNAV_SETTINGS ? `<button class="nb nbset" data-settings="1" aria-label="Settings"><ha-icon icon="mdi:cog-outline"></ha-icon><span class="nt">Settings</span></button>` : ""}</div>
          <div class="ebar">
            <button class="eb" data-e="cancel"><ha-icon icon="mdi:close"></ha-icon>Cancel</button>
            <button class="eb" data-e="reset"><ha-icon icon="mdi:restore"></ha-icon>Reset</button>
            <button class="eb add" data-e="add"><ha-icon icon="mdi:plus-circle-outline"></ha-icon>Add tile</button>
            <button class="eb pri" data-e="save"><ha-icon icon="mdi:check"></ha-icon>Save</button>
          </div>
        </div>
        <div class="sheet"><div class="panel"></div></div>
        <div class="toast"></div>
      </div>`;
    this._root = this.shadowRoot.querySelector(".root");
    this._track = this.shadowRoot.querySelector(".track");
    this._viewport = this.shadowRoot.querySelector(".viewport");
    this._pages = [...this.shadowRoot.querySelectorAll(".page")];
    this._grids = this._pages.map((p) => p.querySelector(".grid"));
    this.shadowRoot.querySelector(".nav").addEventListener("click", (e) => {
      const b = e.composedPath().find((n) => n.classList && n.classList.contains("nb"));
      if (b && b.dataset.settings) { wnavGo(`${ghBase()}/settings`); return; }
      if (b) this._go(Number(b.dataset.i), Math.abs(Number(b.dataset.i) - this._index) === 1);
    });
    const vp = this._viewport;
    vp.addEventListener("pointerdown", (e) => this._down(e), { passive: true });
    vp.addEventListener("pointermove", (e) => this._move(e), { passive: true });
    vp.addEventListener("pointerup", (e) => this._up(e), { passive: true });
    vp.addEventListener("pointercancel", (e) => this._up(e), { passive: true });
    vp.addEventListener("click", (e) => {
      if (this._suppress) { e.stopPropagation(); e.preventDefault(); this._suppress = false; }
    }, true);
    this._wireEditor();
    this._onLocation = () => { const i = this._fromHash(); if (i !== this._index && !this._ed) this._go(i, false); };
    window.addEventListener("location-changed", this._onLocation);
    window.addEventListener("hashchange", this._onLocation);
    // Size to the visible space (100vh on Android includes the area behind the system bars),
    // then scale each page so it always fits without scrolling.
    this._fit = () => {
      const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      const top = Math.max(0, this._root.getBoundingClientRect().top + (window.scrollY || 0));
      this._root.style.height = `${Math.round(vh - top)}px`;
      this._layout();
      this._pages.forEach((p, i) => this._fitPage(i));
      // a new width (rotation, window resize) must not leave the track between two pages
      const w = this._viewport.clientWidth;
      if (w && w !== this._w && this._index != null && !(this._g && this._g.swiping)) { this._w = w; this._setX(-this._index * w, false); }
    };
    window.addEventListener("resize", this._fit);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", this._fit);
    this._ro = new ResizeObserver((entries) => entries.forEach((en) => this._fitPage(this._grids.indexOf(en.target))));
    this._grids.forEach((g) => this._ro.observe(g));
    // the dashboard's own size can change without a window resize event reaching us (sidebar shown or
    // hidden, a fold or unfold settling after the last event), so refit and realign the track then too
    this._rootRo = new ResizeObserver(() => this._fit());
    this._rootRo.observe(this._root);
    this._helpers = await window.loadCardHelpers();
    await this._loadEdit();
    // the app opens on the start page, unless the shared nav bar or a swipe on another page asked for a page
    this._go(pagerOpened || window.__glasshomeNavAsked ? this._fromHash() : Math.max(0, this._config.pages.findIndex((p) => p.id === this._config.start)), false);
    pagerOpened = true;
    requestAnimationFrame(this._fit);
    setTimeout(this._fit, 800);
  }

  // Width class, from the dashboard's own width: "compact" below PAGER_COMPACT px (a phone, a foldable's
  // cover screen), otherwise the tablet layout. Recomputed on every resize, so folding, unfolding and
  // rotating switch it live. The editor always shows the tablet layout, so it is never compact.
  _layout() {
    if (!this._root) return;
    const w = this._root.clientWidth;
    const compact = !this._ed && w > 0 && w < PAGER_COMPACT;
    this._root.classList.toggle("reflow", (this._config.fit || (GH_CFG.layout || {}).fit) !== "scale");
    if (compact === !!this._compact) return;
    this._compact = compact;
    this._root.classList.toggle("compact", compact);
    this._pages.forEach((p, i) => this._fitPage(i));
  }

  // Shrink a page's content (never enlarge) so it fits the available height exactly. The tablet only
  // ever needs a few percent; a page that would need more than PAGER_MIN_FIT stays full size and scrolls.
  // Compact pages fit the screen their own way (_fitCover). While editing a page fits exactly, as it always has.
  _fitPage(i) {
    if (i < 0 || !this._pages) return;
    const page = this._pages[i], grid = this._grids[i];
    if (this._compact) return this._fitCover(page, grid);
    if (grid.style.width) grid.style.width = "";
    const avail = page.clientHeight, need = grid.offsetHeight;
    if (!avail || !need) return;
    let s = Math.min(1, avail / need);
    const scroll = s < PAGER_MIN_FIT && !this._ed;
    if (scroll) s = 1;
    page.classList.toggle("scroll", scroll);
    // a page that fits again (e.g. after unfolding) must not stay scrolled part way down
    if (!scroll && page.scrollTop) page.scrollTop = 0;
    const t = s < 0.999 ? `scale(${s.toFixed(4)})` : "";
    if (grid.style.transform !== t) grid.style.transform = t;
  }

  // A compact page shows the whole tablet layout on one screen: laid out at the screen's width divided by
  // the scale, then scaled down to fill the width exactly, at the largest scale whose height still fits.
  // Cards switch to their narrow styles below a certain width, so a narrower layout is not always
  // shorter: the search keeps the best scale that fits rather than assuming one. A scale that still fits
  // and has no room to grow is kept, so the resize this causes settles at once.
  _fitCover(page, grid) {
    const w = page.clientWidth, avail = page.clientHeight;
    if (!w || !avail) return;
    if ((this._config.fit || (GH_CFG.layout || {}).fit) !== "scale") {
      grid.style.width = "";
      grid.style.transform = "";
      grid.dataset.fit = 1;
      const scroll = grid.offsetHeight > avail + 0.5;
      page.classList.toggle("scroll", scroll);
      if (!scroll && page.scrollTop) page.scrollTop = 0;
      return;
    }
    const fits = (s) => { grid.style.width = `${(w / s).toFixed(2)}px`; return grid.offsetHeight * s <= avail + 0.5; };
    const cur = Number(grid.dataset.fit) || 0;
    let s = cur, scroll = false;
    if (!(cur && fits(cur) && (cur >= 1 || !fits(Math.min(1, cur * 1.02))))) {
      if (fits(1)) s = 1;
      else if (!fits(PAGER_COVER_MIN)) { s = PAGER_COVER_MIN; scroll = true; }
      else {
        let lo = PAGER_COVER_MIN, hi = 1;
        for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
        s = lo;
      }
    }
    fits(s);
    grid.dataset.fit = s;
    page.classList.toggle("scroll", scroll);
    if (!scroll && page.scrollTop) page.scrollTop = 0;
    const t = s < 0.999 ? `scale(${s.toFixed(4)})` : "";
    if (grid.style.transform !== t) grid.style.transform = t;
  }

  disconnectedCallback() {
    clearTimeout(this._nT);
    if (this._onLocation) {
      window.removeEventListener("location-changed", this._onLocation);
      window.removeEventListener("hashchange", this._onLocation);
    }
  }

  connectedCallback() {
    if (this._onLocation) {
      window.addEventListener("location-changed", this._onLocation);
      window.addEventListener("hashchange", this._onLocation);
      // Home Assistant re-attaches the cached view after a sub-page's home#page link, so the address
      // may have changed while the listeners were off
      if (this._helpers) this._onLocation();
    }
    if (this._fit) requestAnimationFrame(this._fit);
  }

  _fromHash() {
    const id = (location.hash || "").slice(1);
    const find = (pid) => this._config.pages.findIndex((p) => p.id === pid);
    // No page in the address: open the start page (config `start`), else the first page
    const i = find(id);
    return i >= 0 ? i : Math.max(0, find(this._config.start));
  }

  _build(i) {
    if (i < 0 || i >= this._config.pages.length || this._els[i] || !this._helpers) return;
    const grid = this._grids[i];
    const editable = !!this._config.pages[i].edit;
    if (editable) grid.insertAdjacentHTML("beforeend", `<div class="guide">${"<i></i>".repeat(12)}</div>`);
    this._els[i] = this._cards[i].map((item) => this._addTile(grid, item, editable));
    if (this._config.pages[i].banner) this._addBanner(grid, this._config.pages[i].banner);
  }

  // A page banner (the bin reminder) sits full width straight under the welcome panel. It is not a
  // tile: editing never moves or removes it, and while it has nothing to say its slot is hidden
  // completely (no gap, no placeholder).
  _addBanner(grid, cfg) {
    const wrap = document.createElement("div");
    wrap.className = "banner";
    wrap.style.gridColumn = "span 12";
    wrap.style.display = "none";
    wrap.addEventListener("glasshome-visibility", (e) => { wrap.style.display = e.detail.visible ? "" : "none"; });
    const hero = grid.querySelector(":scope > .w.lock") || grid.querySelector(":scope > div:not(.guide)");
    grid.insertBefore(wrap, hero ? hero.nextSibling : null);
    wrap._el = this._mount(wrap, cfg);
  }

  // One grid cell: a wrapper sized on the 12-column grid holding the card. On an editable page it
  // also holds a cover that takes touches in edit mode, so controls cannot be operated by accident.
  _addTile(grid, item, editable, before = null) {
    const { span = 12, uid, height, ...cfg } = item;
    const wrap = document.createElement("div");
    wrap.style.gridColumn = `span ${Math.max(1, Math.min(12, span))}`;
    wrap.dataset.span = String(span);
    // optional fixed height (px) so a page's tiles can fill the screen; the card stretches to it
    if (height) { wrap.style.height = `${height}px`; wrap.classList.add("tall"); }
    if (editable) {
      wrap.className = tileKind(item) === "hero" ? "w lock" : "w";
      wrap.dataset.uid = uid;
      wrap.innerHTML = `<div class="cover"></div>`;
      // A card with nothing to show (e.g. the attention strip when all is clear) gives its row back
      wrap.addEventListener("card-visibility-changed", (e) => { wrap.style.display = e.detail && e.detail.value === false ? "none" : ""; });
    }
    grid.insertBefore(wrap, before);
    wrap._el = this._mount(wrap, cfg);
    return wrap._el;
  }

  // Give the card its data before it is attached, so it never renders without hass
  _mount(wrap, raw) {
    // [[config.tokens]] are filled in from the glasshome: settings; a card whose setup is missing shows a
    // setup placeholder instead, and a card for a feature that is switched off takes no space at all
    const prep = ghPrepare(raw, this._hass);
    if (prep.off) { wrap.style.display = "none"; return document.createElement("div"); }
    const cfg = prep.ready ? prep.cfg : ghPlaceholderConfig(raw, prep);
    const el = this._helpers.createCardElement(cfg);
    if (cfg.type === "markdown" && cfg.show_empty === false) {
      // Home Assistant still draws an empty markdown card with show_empty: false, so hide its cell
      const t = setInterval(() => {
        if (wrap.isConnected) wrap.__ghSeen = true; else if (wrap.__ghSeen) return clearInterval(t);
        const m = el.shadowRoot && el.shadowRoot.querySelector("ha-markdown");
        if (m) wrap.style.display = String(m.content || "").trim() ? "" : "none";
      }, 1500);
    }
    if (customElements.get(el.localName)) {
      el.hass = this._hass;
      wrap.prepend(el);
    } else {
      customElements.whenDefined(el.localName).then(() => { el.hass = this._hass; if (wrap._el === el) wrap.prepend(el); });
    }
    return el;
  }

  // ---------------------------------------------------------------- homepage editor
  // A page with `edit:` can be rearranged on the tablet: hold the pencil, drag tiles, tap one to
  // replace, rename, re-icon, resize, duplicate or remove it. Nothing in Home Assistant changes.
  // The layout (complete tile configs) is saved in the frontend's system storage, so it does not
  // depend on the dashboard YAML; a snapshot of the original homepage is kept there for Reset.

  async _loadEdit() {
    const conn = this._hass.connection;
    const get = (key) => conn.sendMessagePromise({ type: "frontend/get_system_data", key });
    await Promise.all(this._config.pages.map(async (p, i) => {
      if (!p.edit || !p.edit.storage_key) return;
      const key = p.edit.storage_key;
      this._original[i] = clone(this._cards[i]);
      try {
        const res = await Promise.race([Promise.all([get(key), get(`${key}_original`)]), new Promise((r) => setTimeout(() => r(null), 6000))]);
        if (!res) return;
        const [cur, orig] = res;
        const admin = this._hass.user && this._hass.user.is_admin;
        const put = (k, cards) => admin && conn.sendMessagePromise({ type: "frontend/set_system_data", key: k,
          value: { version: 1, saved: new Date().toISOString(), cards } }).catch(() => {});
        const dash = this._cards[i];
        if (orig && orig.value && Array.isArray(orig.value.cards)) this._original[i] = orig.value.cards;
        else put(`${key}_original`, this._original[i]); // first run: keep the homepage exactly as it is now, for Reset
        let saved = cur && cur.value && Array.isArray(cur.value.cards) && cur.value.cards.length ? cur.value.cards : null;
        // A tile added to the dashboard later (a uid the original has never had) joins the original
        // and the saved layout at its dashboard position. Tiles you removed are not brought back.
        const known = new Set(this._original[i].map((c) => c.uid));
        const fresh = dash.filter((c) => !known.has(c.uid));
        if (fresh.length) {
          const place = (list) => {
            const out = list.slice();
            // a tile the list already holds (e.g. one added in the editor and later written into the dashboard) is not added twice
            fresh.filter((c) => !out.some((o) => o.uid === c.uid)).forEach((c) => {
              const prev = dash.slice(0, dash.indexOf(c)).reverse().find((p) => out.some((o) => o.uid === p.uid));
              out.splice(prev ? out.findIndex((o) => o.uid === prev.uid) + 1 : 0, 0, clone(c));
            });
            return out;
          };
          this._original[i] = place(this._original[i]);
          put(`${key}_original`, this._original[i]);
          if (saved) { saved = place(saved); put(key, saved); }
        }
        // Dashboard updates reach tiles you have not edited: a saved tile identical (apart from size)
        // to its original copy takes the dashboard's current version, keeping its size and place.
        const bare = (c) => { const { span, ...rest } = c || {}; return JSON.stringify(rest); };
        const byUid = new Map(dash.map((c) => [c.uid, c]));
        let origChanged = false, savedChanged = false;
        const oldOrig = new Map(this._original[i].map((c) => [c.uid, c]));
        if (saved) {
          saved = saved.map((c) => {
            const d = byUid.get(c.uid), o = oldOrig.get(c.uid);
            if (d && o && bare(c) === bare(o) && bare(d) !== bare(c)) { savedChanged = true; return { ...clone(d), span: c.span }; }
            return c;
          });
        }
        this._original[i] = this._original[i].map((c) => {
          const d = byUid.get(c.uid);
          if (d && bare(d) !== bare(c)) { origChanged = true; return { ...clone(d), span: c.span }; }
          return c;
        });
        if (origChanged) put(`${key}_original`, this._original[i]);
        if (saved && savedChanged) put(key, saved);
        if (saved) this._cards[i] = saved;
      } catch (err) { /* storage unreachable: show the dashboard's own tiles */ }
    }));
  }

  _wireEditor() {
    const r = this.shadowRoot;
    this._sheetEl = r.querySelector(".sheet");
    this._toastEl = r.querySelector(".toast");
    // Long press on the pencil starts editing; a quick tap only explains how
    r.querySelectorAll(".pencil").forEach((p) => {
      const stop = (tap) => {
        if (!this._hold) return;
        clearTimeout(this._hold);
        this._hold = 0;
        p.classList.remove("hold");
        if (tap) this._toast("Hold the pencil to edit the homepage");
      };
      // where the pencil was dragged to (fractions of the page, so it stays put across screen sizes)
      const key = `glasshome.pager.pencil.${(this._config.pages[Number(p.dataset.i)] || {}).id}`;
      const place = (fx, fy) => {
        p.style.setProperty("--px", `min(calc(${(fx * 100).toFixed(2)}% ), calc(100% - 44px))`);
        p.style.setProperty("--py", `min(calc(${(fy * 100).toFixed(2)}% ), calc(100% - 44px))`);
        p.classList.add("moved");
      };
      try { const v = JSON.parse(localStorage.getItem(key) || "null"); if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) place(v.x, v.y); } catch (e) { /* none saved */ }
      p.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const pg = p.offsetParent || p.parentNode;
        this._pd = { id: e.pointerId, x: e.clientX, y: e.clientY, l: p.offsetLeft, t: p.offsetTop, moved: false, pg };
        try { p.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        p.classList.add("hold");
        this._hold = setTimeout(() => {
          this._hold = 0;
          p.classList.remove("hold");
          if (navigator.vibrate) navigator.vibrate(15);
          this._editStart(Number(p.dataset.i));
        }, 650);
      });
      p.addEventListener("pointermove", (e) => {
        const d = this._pd;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 8) return;
        if (!d.moved) { d.moved = true; stop(false); p.classList.add("drag"); }
        const W = d.pg.clientWidth, H = d.pg.clientHeight;
        const l = Math.max(4, Math.min(W - p.offsetWidth - 4, d.l + dx)), t = Math.max(4, Math.min(H - p.offsetHeight - 4, d.t + dy));
        d.fx = l / W; d.fy = t / H;
        place(d.fx, d.fy);
      });
      p.addEventListener("pointerup", () => {
        const d = this._pd;
        this._pd = null;
        if (d && d.moved) {
          p.classList.remove("drag");
          try { localStorage.setItem(key, JSON.stringify({ x: d.fx, y: d.fy })); } catch (e) { /* not remembered */ }
          return;
        }
        stop(true);
      });
      p.addEventListener("pointerleave", () => { if (!this._pd) stop(false); });
      p.addEventListener("pointercancel", () => { this._pd = null; p.classList.remove("drag"); stop(false); });
      p.addEventListener("contextmenu", (e) => e.preventDefault());
    });
    this._grids.forEach((g, i) => {
      if (!this._config.pages[i].edit) return;
      g.addEventListener("pointerdown", (e) => this._edDown(e));
      g.addEventListener("pointermove", (e) => this._edMove(e));
      g.addEventListener("pointerup", (e) => this._edUp(e));
      g.addEventListener("pointercancel", (e) => this._edUp(e, true));
      g.addEventListener("click", (e) => { if (this._ed) { e.stopPropagation(); e.preventDefault(); } }, true);
    });
    r.querySelector(".ebar").addEventListener("click", (e) => {
      const b = e.composedPath().find((n) => n.dataset && n.dataset.e);
      if (!b || !this._ed) return;
      if (b.dataset.e === "cancel") this._editCancel();
      else if (b.dataset.e === "save") this._editSave();
      else if (b.dataset.e === "reset") this._editReset();
      else if (b.dataset.e === "add") this._pickSheet(null);
    });
    this._sheetEl.addEventListener("click", (e) => {
      if (e.target === this._sheetEl) { this._sheetClose(); return; }
      const b = e.composedPath().find((n) => n.dataset && n.dataset.a);
      if (b && this._sheetAct) this._sheetAct(b.dataset.a, b.dataset.v);
    });
  }

  _editStart(i) {
    if (this._ed) return;
    this._go(i, false);
    const page = this._pages[i], grid = this._grids[i];
    // Capacity: what fits on screen now (tiles are never shrunk to squeeze more in)
    this._ed = { i, before: JSON.stringify(this._cards[i]), cap: 0 };
    this._layout();
    this._ed.cap = Math.max(page.clientHeight, grid.offsetHeight) + 2;
    this._root.classList.add("editing");
    this._toast("Drag tiles to move them · tap a tile for its options");
  }

  _editExit() {
    this._select(null);
    this._sheetClose();
    this._root.classList.remove("editing");
    this._ed = null;
    this._layout();
    requestAnimationFrame(() => this._fitPage(this._index));
  }

  _editCancel() {
    const i = this._ed.i;
    this._cards[i] = JSON.parse(this._ed.before);
    this._rebuild(i);
    this._editExit();
    this._toast("Changes cancelled");
  }

  async _editSave() {
    const i = this._ed.i, key = this._config.pages[i].edit.storage_key;
    if (this._grids[i].offsetHeight > this._ed.cap) {
      this._toast("The homepage is over capacity. Remove a tile or make one smaller first.", true);
      return;
    }
    try {
      await this._hass.connection.sendMessagePromise({ type: "frontend/set_system_data", key,
        value: { version: 1, saved: new Date().toISOString(), cards: this._cards[i] } });
    } catch (err) {
      this._toast(`Not saved: ${(err && err.message) || "an administrator account is needed to save"}`, true);
      return;
    }
    this._editExit();
    this._toast("Homepage saved");
  }

  _editReset() {
    this._confirm("Reset the homepage?", "This puts back the original homepage exactly as it was before any editing. "
      + "Tap Save afterwards to keep it, or Cancel to undo.", "Reset layout", () => {
      const i = this._ed.i;
      this._cards[i] = clone(this._original[i]);
      this._rebuild(i);
      setTimeout(() => { if (this._ed) this._ed.cap = Math.max(this._ed.cap, this._grids[i].offsetHeight + 2); }, 400);
      this._toast("Original homepage restored · tap Save to keep it");
    });
  }

  _rebuild(i) {
    this._unbuild(i);
    this._build(i);
    this._els[i].forEach((el) => this._feed(el));
    requestAnimationFrame(() => this._fitPage(i));
  }

  _item(uid) {
    return this._ed && this._cards[this._ed.i].find((c) => c.uid === uid);
  }

  _wrapOf(uid) {
    return this._ed && [...this._grids[this._ed.i].querySelectorAll(":scope > .w")].find((w) => w.dataset.uid === uid);
  }

  _syncEls(i) {
    this._els[i] = [...this._grids[i].querySelectorAll(":scope > .w")].map((w) => w._el);
  }

  _select(uid) {
    this.shadowRoot.querySelectorAll(".w.sel").forEach((w) => w.classList.remove("sel"));
    const w = uid && this._wrapOf(uid);
    if (w) w.classList.add("sel");
  }

  // Apply a change; if the page no longer fits once the cards have rendered, undo it and say why
  _change(snap, msg) {
    const i = this._ed.i;
    setTimeout(() => {
      if (!this._ed || this._grids[i].offsetHeight <= this._ed.cap) return;
      this._cards[i] = JSON.parse(snap);
      this._rebuild(i);
      this._sheetClose();
      this._toast(msg || "The homepage is full. Remove a tile or make one smaller first.", true);
    }, 350);
  }

  // Animate the other tiles from where they were to where the grid now puts them
  _flip(mutate, skip) {
    const grid = this._grids[this._ed.i];
    const ws = [...grid.querySelectorAll(":scope > .w")].filter((w) => w !== skip);
    const pos = ws.map((w) => [w.offsetLeft, w.offsetTop]);
    mutate();
    ws.forEach((w, k) => {
      if (!w.isConnected) return;
      const dx = pos[k][0] - w.offsetLeft, dy = pos[k][1] - w.offsetTop;
      if (!dx && !dy) return;
      w.style.transition = "none";
      w.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      void w.offsetWidth;
      w.style.transition = "";
      w.style.transform = "";
    });
  }

  // Touch or mouse on a tile cover: a tap opens the tile's options, a drag moves it
  _edDown(e) {
    if (!this._ed || (e.pointerType === "mouse" && e.button !== 0)) return;
    const cover = e.composedPath().find((n) => n.classList && n.classList.contains("cover"));
    if (!cover) return;
    e.preventDefault();
    this._dr = { w: cover.parentElement, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    try { cover.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  _edMove(e) {
    const d = this._dr;
    if (!d || e.pointerId !== d.id) return;
    if (!d.moved) {
      if (d.w.classList.contains("lock") || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
      d.moved = true;
      this._dragStart(d);
    }
    d.lx = e.clientX;
    d.ly = e.clientY;
    if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if (this._dr === d) this._dragTo(d); });
  }

  _edUp(e, cancelled) {
    const d = this._dr;
    if (!d || e.pointerId !== d.id) return;
    this._dr = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    if (d.moved) {
      // Where the tile is let go always counts, however fast the drag was
      d.lx = e.clientX;
      d.ly = e.clientY;
      this._dragTo(d, true);
      this._dragEnd(d);
    }
    else if (!cancelled) this._tileSheet(d.w.dataset.uid);
  }

  _dragStart(d) {
    const grid = this._grids[this._ed.i], r = grid.getBoundingClientRect();
    d.grid = grid;
    d.scale = r.width / grid.offsetWidth || 1;
    d.gx = r.left;
    d.gy = r.top;
    d.ox = (d.x - r.left) / d.scale - d.w.offsetLeft;
    d.oy = (d.y - r.top) / d.scale - d.w.offsetTop;
    d.snap = JSON.stringify(this._cards[this._ed.i]);
    d.t = 0;
    this._select(d.w.dataset.uid);
    d.w.classList.add("drag");
  }

  _dragTo(d, force) {
    const x = (d.lx - d.gx) / d.scale, y = (d.ly - d.gy) / d.scale, now = performance.now();
    // Move the tile in front of (or after) the tile under the finger; the grid reflows around it
    if (force || now - d.t > 140) {
      const tiles = [...d.grid.querySelectorAll(":scope > .w")];
      let target = null, after = false;
      for (const o of tiles) {
        if (o === d.w || o.classList.contains("lock")) continue;
        if (x >= o.offsetLeft && x <= o.offsetLeft + o.offsetWidth && y >= o.offsetTop && y <= o.offsetTop + o.offsetHeight) {
          target = o;
          after = x > o.offsetLeft + o.offsetWidth / 2;
          break;
        }
      }
      const last = tiles[tiles.length - 1];
      if (!target && last && last !== d.w && y > last.offsetTop + last.offsetHeight) { target = last; after = true; }
      if (target) {
        const ref = after ? target.nextElementSibling : target;
        if (ref !== d.w && d.w.nextElementSibling !== ref) {
          this._flip(() => d.grid.insertBefore(d.w, ref), d.w);
          d.t = now;
        }
      }
    }
    d.w.style.transform = `translate3d(${x - d.ox - d.w.offsetLeft}px, ${y - d.oy - d.w.offsetTop}px, 0) scale(1.03)`;
  }

  _dragEnd(d) {
    const i = this._ed.i;
    d.w.classList.remove("drag");
    d.w.style.transform = "";
    const byId = new Map(this._cards[i].map((c) => [c.uid, c]));
    this._cards[i] = [...d.grid.querySelectorAll(":scope > .w")].map((w) => byId.get(w.dataset.uid));
    this._syncEls(i);
    this._change(d.snap, "That position makes the homepage too tall for the screen, so the tile went back.");
  }

  _toast(msg, warn) {
    const t = this._toastEl;
    t.textContent = msg;
    t.classList.toggle("warn", !!warn);
    t.classList.add("show");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove("show"), warn ? 4200 : 2600);
  }

  _sheet(html, act) {
    this._sheetEl.querySelector(".panel").innerHTML = html;
    this._sheetEl.querySelector(".panel").scrollTop = 0;
    this._sheetEl.classList.add("open");
    this._sheetAct = act;
  }

  _sheetClose() {
    if (!this._sheetEl) return;
    this._sheetEl.classList.remove("open");
    this._sheetAct = null;
  }

  _confirm(title, text, ok, fn) {
    this._sheet(`<div class="ph"><div class="ic"><ha-icon icon="mdi:restore"></ha-icon></div><div class="tt">${esc(title)}</div></div>
      <p class="txt">${esc(text)}</p>
      <div class="row2"><button class="sb" data-a="no">Keep editing</button><button class="sb pri" data-a="yes">${esc(ok)}</button></div>`,
    (a) => { this._sheetClose(); if (a === "yes") fn(); });
  }

  _title(item) {
    const s = item.entity && this._hass.states[item.entity];
    return item.name || (s && s.attributes.friendly_name) || KIND_LABEL[tileKind(item)];
  }

  // Options for one tile
  _tileSheet(uid) {
    const item = this._item(uid);
    if (!item) return;
    const k = tileKind(item);
    if (k === "hero") {
      this._toast("The welcome panel stays at the top of the homepage");
      return;
    }
    this._select(uid);
    const named = ["shortcut", "control", "status", "camera"].includes(k);
    const sizes = k === "notes" ? SIZES.filter((s) => s[0] >= 6) : k === "bins" ? SIZES.filter((s) => s[0] >= 4) : SIZES;
    const btn = (a, icon, label, cls = "") => `<button class="sb ${cls}" data-a="${a}"><ha-icon icon="${icon}"></ha-icon>${label}</button>`;
    this._sheet(`<div class="ph"><div class="ic"><ha-icon icon="${esc(item.icon || "mdi:view-grid-outline")}"></ha-icon></div>
        <div><div class="tt">${esc(this._title(item))}</div><div class="st">${KIND_LABEL[k]}</div></div>
        <button class="sb round x" data-a="done" aria-label="Close"><ha-icon icon="mdi:close"></ha-icon></button></div>
      <div class="acts">${named ? btn("replace", "mdi:swap-horizontal", "Replace") + btn("rename", "mdi:form-textbox", "Rename") + btn("icon", "mdi:emoticon-outline", "Icon") : ""}
        ${k === "shortcut" ? btn("dup", "mdi:content-copy", "Duplicate") : ""}${btn("remove", "mdi:trash-can-outline", "Remove", "danger")}</div>
      <div class="lbl">Size</div>
      <div class="sizes">${sizes.map(([n, label, sub]) => `<button class="sb${(item.span || 12) === n ? " on" : ""}" data-a="size" data-v="${n}">${label}<small>${sub}</small></button>`).join("")}</div>`,
    (a, v) => this._tileAct(uid, a, v));
  }

  _tileAct(uid, a, v) {
    const i = this._ed.i, item = this._item(uid), w = this._wrapOf(uid);
    if (!item || !w) { this._sheetClose(); return; }
    const snap = JSON.stringify(this._cards[i]);
    if (a === "done") { this._sheetClose(); this._select(null); }
    else if (a === "replace") this._pickSheet(uid);
    else if (a === "rename") this._renameSheet(uid);
    else if (a === "icon") this._iconSheet(uid);
    else if (a === "size") {
      item.span = Number(v);
      this._flip(() => { w.style.gridColumn = `span ${item.span}`; });
      this._tileSheet(uid);
      this._change(snap, "There is no room for a bigger tile. Make another tile smaller or remove one first.");
    } else if (a === "dup") {
      const copy = { ...clone(item), uid: this._newUid() };
      this._cards[i].splice(this._cards[i].indexOf(item) + 1, 0, copy);
      this._flip(() => this._addTile(this._grids[i], copy, true, w.nextElementSibling));
      this._syncEls(i);
      this._sheetClose();
      this._select(copy.uid);
      this._change(snap);
    } else if (a === "remove") {
      // Only the tile goes; nothing in Home Assistant is touched
      this._cards[i] = this._cards[i].filter((c) => c.uid !== uid);
      this._flip(() => w.remove());
      this._syncEls(i);
      this._sheetClose();
      this._toast("Tile removed from the homepage");
    }
  }

  _newUid() {
    return `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  // Swap a tile's card for a new config, keeping its place
  _refreshTile(uid) {
    const item = this._item(uid), w = this._wrapOf(uid);
    if (!item || !w) return;
    if (w._el && w._el.parentNode === w) w._el.remove();
    w.style.display = "";
    const { span, uid: u, ...cfg } = item;
    w._el = this._mount(w, cfg);
    this._syncEls(this._ed.i);
  }

  _renameSheet(uid) {
    const item = this._item(uid);
    this._sheet(`<div class="ph"><div class="ic"><ha-icon icon="mdi:form-textbox"></ha-icon></div><div class="tt">Rename tile</div></div>
      <input class="field" maxlength="40" value="${esc(this._title(item))}" aria-label="Tile name">
      <div class="row2"><button class="sb" data-a="back">Back</button><button class="sb pri" data-a="ok">Save name</button></div>`,
    (a) => {
      if (a === "ok") {
        const v = this._sheetEl.querySelector(".field").value.trim();
        if (v) item.name = v; else delete item.name;
        this._refreshTile(uid);
      }
      this._tileSheet(uid);
    });
    const f = this._sheetEl.querySelector(".field");
    setTimeout(() => { f.focus(); f.select(); }, 60);
  }

  _iconSheet(uid) {
    const item = this._item(uid);
    this._sheet(`<div class="ph"><div class="ic"><ha-icon icon="${esc(item.icon || "mdi:help")}"></ha-icon></div><div class="tt">Choose an icon</div>
        <button class="sb round x" data-a="back" aria-label="Back"><ha-icon icon="mdi:arrow-left"></ha-icon></button></div>
      <div class="icons">${EDIT_ICONS.map((ic) => `<button class="sb${ic === item.icon ? " on" : ""}" data-a="pick" data-v="${ic}" aria-label="${ic}"><ha-icon icon="${ic}"></ha-icon></button>`).join("")}</div>
      <div class="lbl">Or type any Material Design icon</div>
      <div class="row2" style="margin-top:0"><input class="field" placeholder="mdi:lightbulb-on" value="${esc(item.icon || "")}" aria-label="Icon name">
        <button class="sb pri" data-a="typed" style="flex:0 0 120px">Use</button></div>`,
    (a, v) => {
      const ic = a === "pick" ? v : a === "typed" ? this._sheetEl.querySelector(".field").value.trim() : null;
      if (ic && /^[a-z]+:[a-z0-9-]+$/.test(ic)) { item.icon = ic; this._refreshTile(uid); }
      else if (a === "typed") { this._toast("Icons look like mdi:lightbulb-on", true); return; }
      this._tileSheet(uid);
    });
  }

  // Add a tile, or replace a tile's content, from what exists in Home Assistant
  async _pickSheet(uid) {
    const cur = uid && this._item(uid);
    const lib = (await this._library()).filter((o) => !cur || o.card.type === cur.type);
    const groups = LIB_CATS.map((cat) => [cat, lib.filter((o) => o.cat === cat)]).filter(([, l]) => l.length);
    this._sheet(`<div class="ph"><div class="ic"><ha-icon icon="${cur ? "mdi:swap-horizontal" : "mdi:plus"}"></ha-icon></div>
        <div><div class="tt">${cur ? `Replace “${esc(this._title(cur))}”` : "Add a tile"}</div>
        <div class="st">${cur ? "Keeps the tile's size, position and style" : "Everything here already exists in Home Assistant"}</div></div>
        <button class="sb round x" data-a="back" aria-label="Back"><ha-icon icon="mdi:${cur ? "arrow-left" : "close"}"></ha-icon></button></div>
      ${groups.map(([cat, l]) => `<div class="lbl">${cat}</div><div class="opts">${l.map((o) => `<button class="sb opt" data-a="pick" data-v="${lib.indexOf(o)}">
        <ha-icon icon="${esc(o.icon)}"></ha-icon><div class="on2"><div class="n">${esc(o.name)}</div><div class="s">${esc(o.sub || "")}</div></div></button>`).join("")}</div>`).join("")
      || `<p class="txt">Nothing suitable was found.</p>`}`,
    (a, v) => {
      if (a === "back") { if (cur) this._tileSheet(uid); else this._sheetClose(); return; }
      const o = lib[Number(v)];
      if (!o) return;
      const i = this._ed.i, snap = JSON.stringify(this._cards[i]);
      if (cur) {
        // Same kind of tile: keep its look (style, size, compact layout) and change only the content
        const next = { ...clone(o.card), uid, span: cur.span };
        ["card_mod", "icon_height", "show_state", "compact"].forEach((key) => { if (key in cur) next[key] = clone(cur[key]); });
        this._cards[i][this._cards[i].indexOf(cur)] = next;
        this._refreshTile(uid);
        this._tileSheet(uid);
        this._change(snap, "The new content does not fit on the homepage, so the tile was put back.");
        this._toast(`Now showing ${o.name}`);
      } else {
        const add = { ...clone(o.card), uid: this._newUid(), span: o.span };
        this._cards[i].push(add);
        this._flip(() => this._addTile(this._grids[i], add, true));
        this._syncEls(i);
        this._feed(this._wrapOf(add.uid)._el);
        this._sheetClose();
        this._select(add.uid);
        this._change(snap);
        this._toast(`${o.name} added`);
      }
    });
  }

  // Every option is built from entities and views that exist right now
  async _library() {
    const h = this._hass, st = h.states, reg = h.entities || {}, edit = this._config.pages[this._ed.i].edit;
    const exclude = new Set(edit.exclude || []), statusOnly = new Set(edit.status_only || []);
    const base = location.pathname;
    const ok = (e) => st[e] && !exclude.has(e) && !(reg[e] && (reg[e].hidden || reg[e].entity_category));
    const ids = (d) => Object.keys(st).filter((e) => e.startsWith(`${d}.`) && ok(e)).sort();
    const fn = (e) => st[e].attributes.friendly_name || e;
    const ownIcon = (e) => { const ic = st[e].attributes.icon; return typeof ic === "string" && ic.includes(":") ? ic : null; };
    const obj = (e) => e.split(".")[1];
    const out = [];
    const shortcut = (cat, name, icon, tap, accent, sub) => out.push({ cat, name, icon, sub, span: 4,
      card: { type: "button", name, icon, show_state: false, icon_height: "44px", tap_action: tap, card_mod: { style: shortcutStyle(accent) } } });
    const control = (cat, e, icon, extra = {}, sub = e) => {
      const power = `sensor.${obj(e)}_current_consumption`;
      out.push({ cat, name: fn(e), icon, sub, span: 4, card: { type: "custom:glasshome-light-card", entity: e, name: fn(e), icon, compact: true,
        ...(st[power] ? { power } : {}), ...extra } });
    };
    const chip = (cat, kind, e, name, icon, extra = {}, sub = e) => out.push({ cat, name, icon, sub, span: kind === "camera" ? 3 : 4,
      card: { type: "custom:glasshome-chip-card", kind, entity: e, name, icon, ...extra } });
    const pageLink = (id) => (this._config.pages.some((p) => p.id === id) ? { action: "navigate", navigation_path: `${base}#${id}` } : { action: "more-info" });

    for (const e of ids("scene")) {
      const icon = ownIcon(e) || SCENE_ICON[obj(e)] || "mdi:palette-outline";
      shortcut("Lighting scenes", fn(e), icon, { action: "perform-action", perform_action: "scene.turn_on", target: { entity_id: e } }, "#ffb340", "Lighting scene");
    }
    for (const e of ids("script")) {
      shortcut("Scripts", fn(e), ownIcon(e) || "mdi:script-text-outline",
        { action: "perform-action", perform_action: "script.turn_on", target: { entity_id: e } }, "#c4b5fd", "Script");
    }
    for (const e of ids("automation")) control("Automations", e, "mdi:robot-outline", {}, "Turns the automation on or off");
    for (const e of ids("climate")) {
      if ((st[e].attributes.preset_modes || []).includes("boost")) {
        shortcut("Heating", "Boost heat", "mdi:fire", { action: "perform-action", perform_action: "climate.set_preset_mode",
          target: { entity_id: e }, data: { preset_mode: "boost" }, confirmation: { text: "Boost the heating?" } }, "#ff8a65", `Boost · ${fn(e)}`);
      }
      chip("Heating", "climate", e, "Climate", "mdi:thermostat", { tap_action: pageLink("climate") }, `Thermostat status · ${fn(e)}`);
    }
    for (const e of ids("input_number")) chip("Heating", "value", e, fn(e), ownIcon(e) || "mdi:thermometer", { tap_action: { action: "more-info" } });
    for (const d of ["light", "switch", "input_boolean", "fan", "media_player"]) {
      for (const e of ids(d)) {
        const o = obj(e);
        if (statusOnly.has(e)) {
          control("Device controls", e, "mdi:light-recessed", { readonly: true, note: "timer" }, `Status only · ${e}`);
          continue;
        }
        const icon = d === "light" ? "mdi:lightbulb-outline" : d === "media_player" ? "mdi:television" : d === "fan" ? "mdi:fan"
          : /heater|radiator/.test(o) ? "mdi:radiator" : /led/.test(o) ? "mdi:led-strip-variant" : d === "input_boolean" ? "mdi:toggle-switch-outline" : "mdi:power-socket-uk";
        control(/heat/.test(o) ? "Heating" : "Device controls", e, icon);
      }
    }
    // Pages of this dashboard: the swipe pages, then the dashboard's other views
    this._config.pages.forEach((p) => shortcut("Navigation", p.title, p.icon || "mdi:arrow-right-circle-outline",
      { action: "navigate", navigation_path: `${base}#${p.id}` }, "#a78bfa", "Page"));
    try {
      const dash = base.split("/")[1];
      const cfg = await h.connection.sendMessagePromise({ type: "lovelace/config", url_path: dash });
      const here = base.split("/")[2];
      (cfg.views || []).forEach((v) => {
        if (!v.path || v.path === here) return;
        shortcut("Navigation", v.title || v.path, v.icon || "mdi:arrow-right-circle-outline", { action: "navigate", navigation_path: `/${dash}/${v.path}` },
          "#a78bfa", `/${dash}/${v.path}`);
      });
    } catch (err) { /* views unavailable: pages only */ }
    out.push({ cat: "Information & status", name: "Bin collection", icon: "mdi:delete-outline", sub: "Next collection, bins and countdown", span: 12,
      card: { type: "custom:glasshome-bin-card" } });
    for (const e of ids("weather")) chip("Information & status", "weather", e, "Weather", "mdi:weather-partly-cloudy", { tap_action: { action: "more-info" } });
    for (const e of ids("person")) chip("Information & status", "presence", e, fn(e).split(" ")[0], "mdi:account-outline");
    for (const e of ids("sensor")) {
      const dc = st[e].attributes.device_class;
      if (/_job_state$/.test(e)) chip("Information & status", "laundry", e, fn(e).replace(/ job state$/i, ""), "mdi:washing-machine");
      else if (["temperature", "humidity", "power", "energy"].includes(dc)) {
        const icon = { temperature: "mdi:thermometer", humidity: "mdi:water-percent", power: "mdi:flash-outline", energy: "mdi:lightning-bolt" }[dc];
        chip("Information & status", "value", e, fn(e), icon, { tap_action: { action: "more-info" } });
      }
    }
    for (const e of ids("binary_sensor")) {
      if (st[e].attributes.device_class === "connectivity") chip("Information & status", "hub", e, fn(e).replace(/ status$/i, ""), "mdi:access-point-network");
    }
    const cams = ids("camera");
    if (cams.length) chip("Information & status", "cameras", cams[0], "Cameras", "mdi:cctv", { entities: cams, tap_action: pageLink("security") }, `${cams.length} cameras online status`);
    for (const e of cams) chip("Cameras", "camera", e, fn(e).replace(/^(nvr|camera) /i, ""), "mdi:cctv", { tap_action: { action: "more-info" } });
    return out;
  }

  _unbuild(i) {
    if (!this._els[i]) return;
    this._grids[i].innerHTML = "";
    this._els[i] = null;
  }

  _setX(px, animate) {
    this._track.classList.toggle("anim", animate);
    this._track.style.transform = `translate3d(${px}px, 0, 0)`;
  }

  _ready(k) {
    this._build(k);
    if (this._els[k]) this._els[k].forEach((el) => this._feed(el));
  }

  _go(i, animate = true) {
    const pages = this._config.pages;
    i = Math.max(0, Math.min(pages.length - 1, i));
    const from = this._index;
    this._index = i;
    // The page being shown is ready first and the slide starts straight away; its neighbours are
    // built and brought up to date once the slide has finished, so they never delay the swipe.
    this._ready(i);
    pages.forEach((p, k) => { if (p.unload && Math.abs(k - i) > 1) this._unbuild(k); });
    // the page being left stays painted until it has slid away
    this._pages.forEach((p, k) => p.classList.toggle("far", Math.abs(k - i) > 1 && k !== from));
    this._w = this._viewport.clientWidth || this._w || 800;
    this._setX(-i * this._w, animate);
    clearTimeout(this._nT);
    this._nT = setTimeout(() => {
      this._pages.forEach((p, k) => p.classList.toggle("far", Math.abs(k - this._index) > 1));
      this._ready(this._index - 1);
      this._ready(this._index + 1);
    }, animate ? 320 : 0);
    const acc = pages[i].accent || "#fff";
    this.shadowRoot.querySelectorAll(".dot").forEach((d, k) => { d.classList.toggle("on", k === i); d.style.setProperty("--acc", acc); });
    this.shadowRoot.querySelectorAll(".nb[data-i]").forEach((b, k) => b.classList.toggle("on", k === i));
    const want = `#${pages[i].id}`;
    if (location.hash !== want) history.replaceState(history.state, "", `${location.pathname}${location.search}${want}`);
    requestAnimationFrame(() => this._fitPage(i));
  }

  _down(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const path = e.composedPath();
    const blocked = path.some((n) => n.tagName && (NO_SWIPE.test(n.tagName) ||
      (n.classList && (n.classList.contains("editing") || n.classList.contains("noswipe")))));
    this._w = this._viewport.clientWidth || this._w || 800;
    this._g = blocked ? null : { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, swiping: false, dx: 0 };
  }

  _move(e) {
    const g = this._g;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    if (!g.swiping) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { this._g = null; return; }
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        g.swiping = true;
        // neighbours are normally built already (a quick second swipe may need the next one now)
        this._ready(this._index + (dx < 0 ? 1 : -1));
        this._pages.forEach((p, k) => p.classList.toggle("far", Math.abs(k - this._index) > 1));
        try { this._viewport.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      } else return;
    }
    const last = this._config.pages.length - 1;
    const edge = (this._index === 0 && dx > 0) || (this._index === last && dx < 0);
    g.dx = dx;
    g.lastX = e.clientX;
    g.lastT = performance.now();
    g.off = edge ? dx / 3 : dx;
    if (!this._raf) {
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        if (this._g && this._g.swiping) this._setX(-this._index * this._w + this._g.off, false);
      });
    }
  }

  _up() {
    const g = this._g;
    this._g = null;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (!g || !g.swiping) return;
    this._suppress = true;
    setTimeout(() => { this._suppress = false; }, 300);
    const dt = Math.max(1, performance.now() - g.t), dx = g.dx || 0;
    const fast = Math.abs(dx) / dt > 0.35 && Math.abs(dx) > 30;
    let i = this._index;
    if (dx < -this._w * 0.18 || (fast && dx < 0)) i += 1;
    else if (dx > this._w * 0.18 || (fast && dx > 0)) i -= 1;
    this._go(i, true);
  }
}

/*
 * Glass Home All card: one button for a group of lights/plugs. If any are on it shows "Lights off"
 * and turns them all off; when all are off it shows "Lights on" and turns them all on.
 * The label follows the real entity states, so it is always right even after other changes.
 *
 *   type: custom:glasshome-all-card
 *   entities: [light.a, light.b, switch.c]
 */
class GlassHomeAllCard extends HTMLElement {
  setConfig(config) {
    if (!config.entities || !config.entities.length) throw new Error("entities are required");
    this._config = config;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", () => {
        if (!this._hass) return;
        const anyOn = this._config.entities.some((e) => this._hass.states[e] && this._hass.states[e].state === "on");
        this._hass.callService("homeassistant", anyOn ? "turn_off" : "turn_on", { entity_id: this._config.entities });
      });
    }
  }

  set hass(hass) {
    this._hass = hass;
    const key = this._config.entities.map((e) => hass.states[e] && hass.states[e].state).join();
    if (key !== this._key) {
      this._key = key;
      this._render();
    }
  }

  getCardSize() {
    return 2;
  }

  _render() {
    const st = this._hass.states, ents = this._config.entities;
    const on = ents.filter((e) => st[e] && st[e].state === "on").length;
    const anyOn = on > 0;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        ha-card { box-sizing: border-box; height: 100%; min-height: 92px; border-radius: 24px; cursor: pointer; user-select: none;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: #fff;
          background: ${anyOn ? "linear-gradient(155deg, rgba(139,92,246,0.45), rgba(109,40,217,0.18) 60%, rgba(26,20,46,0.7))" : GLASS_BG};
          border: 1px solid ${anyOn ? `rgba(${PURPLE},0.5)` : GLASS_LINE};
          box-shadow: ${anyOn ? "0 0 22px rgba(139,92,246,0.28), " : ""}${GLASS_EDGE}; -webkit-tap-highlight-color: transparent; }
        ha-card:active { transform: scale(0.97); }
        ha-icon { --mdc-icon-size: 26px; color: ${anyOn ? "#fff" : `rgb(${PURPLE})`}; width: 46px; height: 46px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center; background: ${anyOn ? "rgba(255,255,255,0.18)" : `rgba(${PURPLE},0.14)`}; }
        .l { font-size: 15px; font-weight: 600; } .s { font-size: 12.5px; color: #8e8aa0; }
      </style>
      <ha-card role="button" aria-label="${anyOn ? "Turn all lights off" : "Turn all lights on"}">
        <ha-icon icon="${anyOn ? "mdi:lightbulb-group-off-outline" : "mdi:lightbulb-group"}"></ha-icon>
        <span class="l">${anyOn ? "Lights off" : "Lights on"}</span><span class="s">${on} of ${ents.length} on</span>
      </ha-card>`;
  }
}

/*
 * Glass Home Hero card: the Home welcome panel. Greeting, large clock, date, weather, plus pills for
 * climate (indoor temperature, heating or not), lights on, connections and camera availability.
 * Optional pills (climate, connections, presence) show only when configured.
 *
 * The whole panel is a live picture of the sky outside, driven by the existing weather entity and
 * sun.sun: sunny (with golden hour), partly cloudy, overcast, rain / heavy rain, thunderstorm,
 * snow, fog and night (moon and twinkling stars), each by day or night. Clouds drift at a speed
 * set by the real wind. Everything is CSS: transform/opacity animations only, paused while the
 * panel is off screen, and switched off for "reduce motion".
 *
 *   type: custom:glasshome-hero-card
 *   weather: weather.forecast_home
 *   indoor: sensor.hallway_temperature                # Indoor pill when there is no climate
 *   climate: climate.living_room                      # Climate pill: indoor temperature, Heating / Idle
 *   lights: [light.a, light.b]
 *   cameras: [camera.a, camera.b]
 *   connections:                                      # one entity per integration; down = unavailable / unknown
 *     - { name: Hive, entities: [binary_sensor.hub], off_is_down: true }   # off also means down
 *   sun_times: true                                   # Sunrise / Sunset pill from sun.sun (next of each)
 *   rain_alert: true                                  # message under the clock only when rain is forecast today
 *   person: person.alex                               # Home / Away pill, labelled with the person's name
 *   family: The Smiths                                # greeting name (default: household.name in the glasshome: settings)
 */
const RAIN_CONDS = ["rainy", "pouring", "lightning-rainy", "hail", "snowy-rainy"];
const WEATHER_TEXT = { "clear-night": "Clear", cloudy: "Overcast", fog: "Fog", hail: "Hail", lightning: "Thunderstorms",
  "lightning-rainy": "Thunderstorms", partlycloudy: "Partly cloudy", pouring: "Heavy rain", rainy: "Rain", snowy: "Snow",
  "snowy-rainy": "Sleet", sunny: "Sunny", windy: "Windy", "windy-variant": "Windy", exceptional: "Weather warning" };
const WEATHER_ICON = { "clear-night": "mdi:weather-night", cloudy: "mdi:weather-cloudy", fog: "mdi:weather-fog",
  hail: "mdi:weather-hail", lightning: "mdi:weather-lightning", "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy", pouring: "mdi:weather-pouring", rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy", "snowy-rainy": "mdi:weather-snowy-rainy", sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy", "windy-variant": "mdi:weather-windy-variant", exceptional: "mdi:alert-circle-outline" };
const NIGHT_ICON = { sunny: "mdi:weather-night", "clear-night": "mdi:weather-night", partlycloudy: "mdi:weather-night-partly-cloudy" };

// Small repeating tiles drawn once as inline SVG (no image files). A seeded random keeps them stable.
const svgUri = (w, h, body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const RAIN_TILE = (() => {
  const r = seeded(7), lines = [];
  for (let i = 0; i < 16; i++) {
    const x = r() * 140, y = r() * 140, l = 12 + r() * 12;
    lines.push(`<line x1='${x.toFixed(1)}' y1='${y.toFixed(1)}' x2='${x.toFixed(1)}' y2='${(y + l).toFixed(1)}' stroke='rgba(215,228,255,${(0.35 + r() * 0.4).toFixed(2)})' stroke-width='1.3' stroke-linecap='round'/>`);
    if (y + l > 140) lines.push(`<line x1='${x.toFixed(1)}' y1='${(y - 140).toFixed(1)}' x2='${x.toFixed(1)}' y2='${(y + l - 140).toFixed(1)}' stroke='rgba(215,228,255,0.5)' stroke-width='1.3' stroke-linecap='round'/>`);
  }
  return svgUri(140, 140, lines.join(""));
})();
const SNOW_TILE = (() => {
  const r = seeded(11), dots = [];
  for (let i = 0; i < 22; i++) dots.push(`<circle cx='${(r() * 160).toFixed(1)}' cy='${(r() * 160).toFixed(1)}' r='${(1 + r() * 2.2).toFixed(1)}' fill='rgba(255,255,255,${(0.55 + r() * 0.4).toFixed(2)})'/>`);
  return svgUri(160, 160, dots.join(""));
})();
const starField = (seed, n) => {
  const r = seeded(seed), dots = [];
  for (let i = 0; i < n; i++) dots.push(`<circle cx='${(r() * 800).toFixed(0)}' cy='${(r() * 170).toFixed(0)}' r='${(0.6 + r() * 1.1).toFixed(1)}' fill='rgba(255,255,255,${(0.5 + r() * 0.5).toFixed(2)})'/>`);
  return svgUri(800, 240, dots.join(""));
};
const STARS_A = starField(3, 34), STARS_B = starField(5, 26);

// Sky colours for each scene (crossfaded between two layers when the scene changes)
const SKY = {
  sunny: "radial-gradient(120% 140% at 70% 10%, rgba(255,214,140,0.55) 0%, rgba(255,214,140,0) 45%), linear-gradient(165deg, #3f86e8 0%, #5a8ff2 38%, #6f78e6 70%, #5a43c2 100%)",
  golden: "radial-gradient(120% 140% at 68% 55%, rgba(255,180,110,0.65) 0%, rgba(255,150,90,0) 55%), linear-gradient(165deg, #5a66d6 0%, #c26aa8 55%, #f2996a 100%)",
  partly: "radial-gradient(110% 130% at 70% 10%, rgba(255,220,160,0.35) 0%, rgba(255,220,160,0) 45%), linear-gradient(165deg, #4a7fd0 0%, #6584d8 42%, #6a64c8 75%, #4a3a9e 100%)",
  overcast: "linear-gradient(165deg, #6b7388 0%, #5a5f78 45%, #44445e 80%, #2f2c46 100%)",
  rain: "linear-gradient(165deg, #44506c 0%, #353d5a 45%, #262a44 80%, #181a2e 100%)",
  storm: "radial-gradient(90% 120% at 30% 0%, rgba(120,90,200,0.35) 0%, transparent 60%), linear-gradient(165deg, #2c2645 0%, #221c38 45%, #16122a 80%, #0b0916 100%)",
  snow: "radial-gradient(110% 120% at 70% 0%, rgba(255,255,255,0.35) 0%, transparent 55%), linear-gradient(165deg, #9db4d6 0%, #8199c4 45%, #6274a6 80%, #44507e 100%)",
  fog: "linear-gradient(170deg, #8c90a0 0%, #757a8c 45%, #5d6074 80%, #45475c 100%)",
  night: "radial-gradient(90% 120% at 72% 10%, rgba(120,110,220,0.25) 0%, transparent 55%), linear-gradient(165deg, #121a44 0%, #1b1548 45%, #140f32 75%, #090a1c 100%)",
  "night-cloudy": "radial-gradient(90% 120% at 72% 10%, rgba(110,105,190,0.18) 0%, transparent 55%), linear-gradient(165deg, #1a1f40 0%, #1e1a42 45%, #15112e 75%, #0a0a1a 100%)",
  "night-overcast": "linear-gradient(165deg, #23263c 0%, #1d1e33 45%, #15152a 80%, #0b0b18 100%)",
  "night-rain": "linear-gradient(165deg, #1c2338 0%, #161b2e 45%, #0f1222 80%, #08090f 100%)",
  "night-snow": "radial-gradient(90% 120% at 70% 0%, rgba(170,190,255,0.18) 0%, transparent 55%), linear-gradient(165deg, #22305a 0%, #1b254a 45%, #121a36 80%, #0a0e20 100%)",
  "night-fog": "linear-gradient(170deg, #2e3142 0%, #252836 45%, #1b1d29 80%, #111219 100%)",
  none: "linear-gradient(165deg, #3a2f6e 0%, #2c2358 50%, #1c1640 100%)",
};
const CLOUD = { day: "rgba(255,255,255,0.86)", light: "rgba(255,255,255,0.70)", grey: "rgba(206,211,226,0.72)",
  rain: "rgba(118,128,156,0.80)", night: "rgba(78,80,112,0.62)", storm: "rgba(52,46,80,0.92)", snow: "rgba(238,242,252,0.74)" };

// Narrow: the four status pills sit two by two instead of in one row (below 640px a pill is too
// narrow for the sunrise and sunset times beside their labels; the tablet's panel is 768px)
const NARROW_CSS_HERO = `
  :host { container-type: inline-size; }
  @container (max-width: 640px) {
    .pills { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }`;

/*
 * Glass Home Weather sheet: the detailed forecast that opens from the hero card's weather (tap the 4-day
 * strip or the temperature). It lives on document.body, outside the card, so the card's rounded clipping
 * never cuts it off. Close: X, tap outside, Esc, or drag the handle down on a phone.
 *
 * Everything comes from the weather entity (met.no here) through the hero card's own forecast
 * subscriptions (daily and hourly), so opening the sheet makes no extra forecast requests. The one extra
 * read is the entity's own recent history, once per opening, for the pressure trend.
 *
 * In order: sticky header; now (big temperature over a small live sky); the briefing for the chosen day
 * (fixed rules over the real numbers, nothing invented); a few more current readings; the days (one
 * temperature scale for all); the chosen day in detail; hour by hour (a timeline and a chart: rain,
 * temperature, wind or humidity; tap an hour); the sun's arc; insights (best time to go out, frost risk,
 * home); and what the data source does and does not provide.
 *
 * Values marked "calc." are worked out here from the forecast (feels like, dew point for later hours,
 * frost risk, pressure trend, daylight, solar noon, best time outside). met.no gives no gusts, chance of
 * rain, visibility, air quality or official warnings, so none of those are shown.
 */
const WX_COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const WX_COMPASS_LONG = { N: "north", NNE: "north-northeast", NE: "northeast", ENE: "east-northeast", E: "east", ESE: "east-southeast", SE: "southeast", SSE: "south-southeast",
  S: "south", SSW: "south-southwest", SW: "southwest", WSW: "west-southwest", W: "west", WNW: "west-northwest", NW: "northwest", NNW: "north-northwest" };
const wxCompass = (deg) => (deg != null && deg !== "" && Number.isFinite(Number(deg)) ? WX_COMPASS[Math.round(((Number(deg) % 360) + 360) % 360 / 22.5) % 16] : "");
const wxUv = (u) => (u == null || !Number.isFinite(Number(u)) ? null : Number(u) < 3 ? "Low" : Number(u) < 6 ? "Moderate" : Number(u) < 8 ? "High" : Number(u) < 11 ? "Very high" : "Extreme");
const wxKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const wxHm = (d) => (d ? d.toLocaleTimeString(GH_LOCALE, GH_HM) : "–");
const wxNum = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const wxMm = (mm) => (mm < 10 ? mm.toFixed(1) : String(Math.round(mm)));
const wxEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// a time in words: "midnight" reads better than 00:00 in a sentence
const wxAt = (ms) => { const d = new Date(ms); return d.getHours() === 0 && d.getMinutes() === 0 ? "midnight" : wxHm(d); };
const wxDur = (min) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`;

// Units: the rules below think in °C and km/h whatever the entity reports
const wxToC = (v, u) => (v == null ? null : u === "°F" ? ((v - 32) * 5) / 9 : v);
const wxFromC = (c, u) => (c == null ? null : u === "°F" ? (c * 9) / 5 + 32 : c);
const wxToKmh = (v, u) => (v == null ? null : v * ({ "m/s": 3.6, mph: 1.609344, kn: 1.852, "ft/s": 1.09728 }[u] || 1));
const wxFromKmh = (v, u) => (v == null ? null : v / ({ "m/s": 3.6, mph: 1.609344, kn: 1.852, "ft/s": 1.09728 }[u] || 1));

// Feels like (calculated): wind chill (the Met Office / Environment Canada formula) at 10 °C and below
// with wind over 4.8 km/h; heat index (Rothfusz) from 27 °C with humidity of 40% or more; otherwise the air.
function wxFeels(tC, windKmh, rh) {
  if (tC == null) return null;
  if (tC <= 10 && windKmh != null && windKmh > 4.8) { const v = windKmh ** 0.16; return 13.12 + 0.6215 * tC - 11.37 * v + 0.3965 * tC * v; }
  if (tC >= 27 && rh != null && rh >= 40) {
    const T = (tC * 9) / 5 + 32, R = rh;
    const hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T - 0.05481717 * R * R
      + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    return ((hi - 32) * 5) / 9;
  }
  return tC;
}
// Dew point from temperature and humidity (Magnus formula, within about 0.4 °C)
const wxDew = (tC, rh) => { if (tC == null || rh == null || rh <= 0) return null; const g = Math.log(rh / 100) + (17.62 * tC) / (243.12 + tC); return (243.12 * g) / (17.62 - g); };

// Sunrise and sunset for any date at the home location (NOAA solar equations, refined at the event
// time itself; within about a minute of Home Assistant's sun.sun). null when the sun does not rise or set.
function wxSunTimes(day, lat, lon) {
  const rad = Math.PI / 180, base = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const event = (rising) => {
    let min = 720;
    for (let i = 0; i < 3; i++) {
      const T = ((base + min * 60000) / 864e5 + 2440587.5 - 2451545) / 36525;
      const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360, M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
      const ecc = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
      const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
      const om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
      const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * rad);
      const dec = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad));
      const y = Math.tan((eps * rad) / 2) ** 2;
      const eqt = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * ecc * Math.sin(M * rad) + 4 * ecc * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad)
        - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * ecc * ecc * Math.sin(2 * M * rad));
      const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec);
      if (!(cosH >= -1 && cosH <= 1)) return null;
      const ha = Math.acos(cosH) / rad;
      min = 720 - 4 * (lon + (rising ? ha : -ha)) - eqt;
    }
    return new Date(base + min * 60000);
  };
  const rise = event(true), set = event(false);
  return rise && set ? { rise, set, noon: new Date((rise.getTime() + set.getTime()) / 2) } : null;
}

// Rain by the hour: wet when the hour has 0.1 mm or more, or a rain condition. Rate words follow the
// Met Office: light under 0.5 mm an hour, moderate to 4, heavy above.
const wxIsWet = (h) => (h.mm != null && h.mm >= 0.1) || RAIN_CONDS.includes(h.cond);
const wxRate = (mm) => (mm == null || mm < 0.1 ? "none" : mm < 0.5 ? "light" : mm < 4 ? "moderate" : "heavy");
const wxSpells = (hrs, test = wxIsWet) => {
  const out = [];
  hrs.forEach((h, i) => { if (!test(h)) return; const last = out[out.length - 1]; if (last && last.b === i - 1) last.b = i; else out.push({ a: i, b: i }); });
  return out;
};
const wxSum = (hrs) => hrs.reduce((s, h) => s + (h.mm || 0), 0);
// Frost risk from the coldest forecast hour (an assessment, not a frost forecast): high at 0 °C or below;
// possible at 1 °C or below, or at 3 °C or below when the sky is not mostly cloudy (cloud keeps frost away)
const wxColdest = (hrs) => hrs.reduce((m, h) => (h.tc != null && (!m || h.tc < m.tc) ? h : m), null);
function wxFrost(lowC, cloud) {
  if (lowC == null) return null;
  if (lowC <= 0) return "high";
  if (lowC <= 1 || (lowC <= 3 && (cloud == null || cloud < 70))) return "possible";
  return "low";
}

// One colour scale for every temperature bar: cold blue, lavender, gold, orange
const WX_TSTOPS = [[-5, [143, 180, 255]], [3, [124, 200, 255]], [9, [185, 166, 255]], [15, [255, 210, 122]], [24, [255, 159, 107]], [32, [255, 107, 107]]];
function wxTempCol(c) {
  const s = WX_TSTOPS;
  if (c <= s[0][0]) return `rgb(${s[0][1]})`;
  for (let i = 1; i < s.length; i++) {
    if (c <= s[i][0]) {
      const k = (c - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return `rgb(${s[i][1].map((v, j) => Math.round(s[i - 1][1][j] + (v - s[i - 1][1][j]) * k)).join(",")})`;
    }
  }
  return `rgb(${s[s.length - 1][1]})`;
}

// A smooth line through the points that never overshoots them (monotone cubic, Fritsch–Carlson)
function wxSmooth(p) {
  if (p.length < 2) return p.length ? `M${p[0][0]},${p[0][1]}` : "";
  const n = p.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let path = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1][0] - p[i][0]) / 3;
    path += ` C${(p[i][0] + h).toFixed(1)},${(p[i][1] + m[i] * h).toFixed(1)} ${(p[i + 1][0] - h).toFixed(1)},${(p[i + 1][1] - m[i + 1] * h).toFixed(1)} ${p[i + 1][0].toFixed(1)},${p[i + 1][1].toFixed(1)}`;
  }
  return path;
}

// The briefing: fixed rules over the forecast numbers, most useful first. Times are "about" an hour
// because the forecast is hourly; nothing here is a warning or a guarantee.
function wxBrief(M, D) {
  const out = [], deg = (c) => `${Math.round(wxFromC(c, M.uT))}°`, hm = wxAt;
  const hrs = D.ahead, idx = M.days.indexOf(D);
  const name = D.isToday ? "Today" : D.name, lower = (n) => (n === "Today" || n === "Tomorrow" ? n.toLowerCase() : n);
  const rest = D.tonight ? "Tonight" : D.isToday ? "The rest of today" : name, restOf = D.tonight ? "through the night" : "for the rest of today";
  // rain
  if (hrs.length >= 3) {
    const sp = wxSpells(hrs), total = wxSum(hrs), maxMm = Math.max(0, ...hrs.map((h) => h.mm || 0));
    if (!sp.length) out.push({ s: D.isToday && M.rainNow ? 70 : 30, ic: D.tonight ? "mdi:weather-night" : "mdi:weather-partly-cloudy", t: `${rest} looks dry${D.isToday ? "" : `, with temperatures between ${deg(D.loC)} and ${deg(D.hiC)}`}.` });
    else {
      const first = sp[0], last = sp[sp.length - 1], start = hrs[first.a].ms, end = hrs[last.b].ms + 3600e3;
      const word = maxMm >= 4 ? "Heavy rain" : maxMm < 0.5 ? "Light rain" : "Rain";
      const runsOut = last.b === hrs.length - 1, after = hrs.slice(last.b + 1);
      const eh = new Date(end).getHours();
      const tail = !runsOut && after.length >= 3 && !after.slice(0, 3).some((h) => h.wet) ? `, followed by a dry ${eh >= 17 ? "evening and night" : eh < 6 ? "night" : "spell"}` : "";
      const amount = total >= 0.1 ? `${wxMm(total)} mm` : "a little";
      let t;
      if (sp.length === 1 && D.isToday && first.a === 0) t = runsOut ? `${word} is forecast to continue ${restOf}, around ${amount} more.` : `${word} is forecast to ease by about ${hm(end)}${tail}.`;
      else if (sp.length === 1) t = `${word} is expected from about ${hm(start)}${runsOut ? "" : ` until about ${hm(end)}`}, around ${amount} in total${tail}.`;
      else t = `Rain on and off between about ${hm(start)} and ${hm(end)}, around ${amount} in total${tail}.`;
      out.push({ s: maxMm >= 4 ? 100 : 90, ic: maxMm >= 4 ? "mdi:weather-pouring" : "mdi:weather-rainy", t });
    }
  } else if (D.mm != null) {
    const wettest = D.mm >= 4 && D.mm >= Math.max(...M.days.map((x) => x.mm || 0));
    if (D.mm >= 0.1) out.push({ s: wettest ? 95 : 75, ic: "mdi:weather-rainy", t: wettest
      ? `${name} looks particularly wet, with ${wxMm(D.mm)} mm of rain forecast and temperatures between ${deg(D.loC)} and ${deg(D.hiC)}.`
      : `${name} has ${wxMm(D.mm)} mm of rain forecast${D.mm < 1 ? ", only a little" : ""}, with temperatures between ${deg(D.loC)} and ${deg(D.hiC)}.` });
    else out.push({ s: 40, ic: "mdi:weather-partly-cloudy", t: `${name} looks dry, with temperatures between ${deg(D.loC)} and ${deg(D.hiC)}.` });
  }
  // compared with the day before (or, for today, tomorrow compared with today while most of today is still ahead)
  const prev = idx > 0 ? M.days[idx - 1] : null, next = M.days[idx + 1];
  const pair = prev && !(prev.isToday && M.now.getHours() >= 15) ? [D, prev] : D.isToday && next && M.now.getHours() < 15 ? [next, D] : null;
  if (pair && pair[0].hiC != null && pair[1].hiC != null) {
    const [x, y] = pair, diff = Math.round(x.hiC - y.hiC);
    // the day being compared keeps its own name; the other is "today", "tomorrow" (only beside today) or its weekday
    const xn = x.isToday ? "Today" : x.name, yn = y.isToday ? "today" : x.isToday && y === next ? "tomorrow" : y.d.toLocaleDateString(GH_LOCALE, { weekday: "long" });
    if (Math.abs(diff) >= 3) out.push({ s: 60 + Math.abs(diff) * 3, ic: diff > 0 ? "mdi:thermometer-chevron-up" : "mdi:thermometer-chevron-down",
      t: `${xn} is forecast to be ${Math.abs(diff)}° ${diff > 0 ? "warmer" : "colder"} than ${yn}.` });
    if (x.mm != null && y.mm != null && x.mm >= 2 && x.mm >= y.mm * 2 + 1)
      out.push({ s: 55, ic: "mdi:weather-pouring", t: `${xn} has considerably more rain forecast than ${yn} (${wxMm(x.mm)} mm, against ${y.mm >= 0.1 ? `${wxMm(y.mm)} mm` : "none"}).` });
  }
  // frost risk (an assessment from the forecast low, not a frost forecast)
  const lowH = hrs.length ? wxColdest(hrs) : null;
  const low = lowH ? lowH.tc : D.loC, frost = wxFrost(low, lowH ? lowH.cloud : null);
  if (frost === "high") out.push({ s: 85, ic: "mdi:snowflake-thermometer", t: `Temperatures may fall to ${deg(low)}${lowH ? ` around ${hm(lowH.ms)}` : " overnight"}. Frost is likely to form.` });
  else if (frost === "possible") out.push({ s: 70, ic: "mdi:snowflake-thermometer", t: `Temperatures may drop close to freezing (${deg(low)}${lowH ? ` around ${hm(lowH.ms)}` : ""}). Watch for possible frost.` });
  // wind (sustained speeds; the forecast has no gusts)
  const wk = hrs.length ? Math.max(...hrs.map((h) => h.wk || 0)) : D.wk;
  if (wk != null && wk >= 35) {
    const top = hrs.length ? hrs.reduce((m, h) => ((h.wk || 0) > (m.wk || 0) ? h : m)) : null;
    const dir = wxCompass(top ? top.bearing : D.bearing);
    out.push({ s: wk >= 50 ? 80 : 45, ic: "mdi:weather-windy", t: `${wk >= 50 ? "Very windy" : "Breezy at times"}, with winds up to ${Math.round(wxFromKmh(wk, M.uW))} ${M.uW}${dir ? ` from the ${WX_COMPASS_LONG[dir]}` : ""}.` });
  }
  // strong sun
  const uv = hrs.length ? Math.max(...hrs.map((h) => h.uv || 0)) : D.uv;
  if (uv != null && uv >= 6) out.push({ s: 50, ic: "mdi:sun-wireless-outline", t: `UV reaches ${Math.round(uv)} (${wxUv(uv).toLowerCase()}) around the middle of the day, so sun protection is worth it.` });
  if (!out.length) out.push({ s: 1, ic: WEATHER_ICON[D.cond] || "mdi:weather-cloudy", t: `${name}: ${(WEATHER_TEXT[D.cond] || "mixed weather").toLowerCase()}, between ${deg(D.loC)} and ${deg(D.hiC)}.` });
  out.sort((p, q) => q.s - p.s);
  return out.slice(0, 3);
}

// Best time to go outside: each daylight hour starts at 100; rain takes off 60 plus 15 a millimetre,
// cold below 12° takes off 2.5 a degree (heat above 24°, 3 a degree), wind over 15 km/h 1.2 a km/h.
// The best run of up to three dry daylight hours wins; a longer run wins a near tie.
function wxBest(hrs) {
  const score = (h) => 100 - (h.wet ? 60 + Math.min(30, (h.mm || 0) * 15) : 0) - Math.max(0, 12 - (h.tc ?? 12)) * 2.5 - Math.max(0, (h.tc ?? 0) - 24) * 3 - Math.max(0, (h.wk || 0) - 15) * 1.2;
  const day = hrs.filter((h) => !h.night);
  if (day.length < 1) return null;
  let best = null;
  for (let len = 3; len >= 1; len--) {
    for (let i = 0; i + len <= hrs.length; i++) {
      const run = hrs.slice(i, i + len);
      if (run.some((h) => h.night || h.wet) || run.some((h, j) => j && h.ms - run[j - 1].ms !== 3600e3)) continue;
      const s = run.reduce((t, h) => t + score(h), 0) / len;
      if (!best || s > best.s + 5 * (best.run.length - len)) best = { s, run };
    }
  }
  if (best) return { dry: true, run: best.run, s: best.s };
  const least = day.reduce((m, h) => ((h.mm || 0) < (m.mm || 0) ? h : m));
  return { dry: false, run: [least], s: score(least) };
}

const WX_CW = 46; // width of one hour in the timeline and charts
const WX_TABS = [["rain", "Rain", "mdi:weather-pouring"], ["temp", "Temperature", "mdi:thermometer"], ["wind", "Wind", "mdi:weather-windy"], ["hum", "Humidity", "mdi:water-percent"]];

const WX_SHEET_CSS = `
  :host { position: fixed; inset: 0; z-index: 1000; display: none; font-family: var(--ha-font-family-body, Roboto, system-ui, sans-serif);
    --wx-line: rgba(255,255,255,0.12); --wx-soft: rgba(255,255,255,0.68); --wx-dim: rgba(255,255,255,0.50); --wx-panel: rgba(16,11,40,0.46);
    --wx-rain: #5aa9ff; --wx-gold: #ffd27a; --wx-lav: #b9a6ff; --wx-teal: #7fd1c7; }
  :host([open]) { display: block; }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; }
  .scrim { position: absolute; inset: 0; background: rgba(6,4,20,0.55); animation: fade 0.2s ease; }
  .sheet { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(760px, calc(100vw - 24px)); max-height: calc(100vh - 24px);
    max-height: calc(100dvh - 24px); overflow: auto; overscroll-behavior: contain; color: #fff; border-radius: 30px; border: 1px solid ${LG_FLOAT_LINE};
    background: radial-gradient(90% 50% at 85% 0%, rgba(139,92,246,0.30), transparent 70%), radial-gradient(80% 40% at 0% 100%, rgba(80,60,200,0.22), transparent 70%),
      linear-gradient(170deg, rgba(40,30,96,0.86) 0%, rgba(28,20,68,0.90) 50%, rgba(18,13,46,0.93) 100%);
    box-shadow: 0 30px 80px rgba(8,4,30,0.65), inset 0 1px 0 rgba(255,255,255,0.24), inset 0 -1px 0 rgba(255,255,255,0.05); animation: pop 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
    -webkit-backdrop-filter: blur(26px) saturate(170%); backdrop-filter: blur(26px) saturate(170%); scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.22) transparent; }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .sheet { background: radial-gradient(90% 50% at 85% 0%, rgba(139,92,246,0.32), transparent 70%), linear-gradient(170deg, #2a2064 0%, #1e1546 55%, #140f32 100%); } }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { opacity: 0; transform: translate(-50%, -48%) scale(0.98); } }
  @keyframes wxin { from { opacity: 0; transform: translateY(6px); } }
  @keyframes wxfade { from { opacity: 0; } }
  ha-icon { display: block; flex: none; }
  .calc { display: inline-block; vertical-align: 1px; margin-left: 5px; padding: 1px 5px; border-radius: 6px; font-size: 9.5px; font-weight: 700; letter-spacing: 0.5px;
    text-transform: uppercase; color: rgba(255,255,255,0.72); background: rgba(255,255,255,0.10); }
  .tag { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 9px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
    color: #d9ccff; background: rgba(139,92,246,0.22); border: 1px solid rgba(190,160,255,0.30); }

  /* header: stays put while the sheet scrolls; shows the temperature once the big one has scrolled away */
  .hdrbox { position: sticky; top: 0; z-index: 5; }
  .hdr { position: relative; display: flex; align-items: center; gap: 12px; padding: 14px 18px 12px 22px; border-radius: 30px 30px 0 0;
    background: linear-gradient(180deg, rgba(38,28,92,0.96), rgba(34,25,84,0.90)); border-bottom: 1px solid transparent; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
  .hdr.stuck { border-bottom-color: rgba(255,255,255,0.08); box-shadow: 0 8px 22px rgba(8,4,30,0.35); }
  .hdr .ttl { min-width: 0; } .hdr h2 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: 0.1px; }
  .hdr .sub { font-size: 12.5px; color: var(--wx-soft); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hdr .sub.stale { color: #ffc98a; }
  .hdr .mini { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 700; opacity: 0; transform: translateY(4px);
    transition: opacity 0.2s ease, transform 0.2s ease; pointer-events: none; }
  .hdr .mini ha-icon { --mdc-icon-size: 22px; }
  .hdr.min .mini { opacity: 1; transform: none; }
  .x { margin-left: auto; width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.08);
    display: flex; align-items: center; justify-content: center; cursor: pointer; --mdc-icon-size: 22px; flex: none; transition: background 0.15s ease, transform 0.15s ease; }
  .mini + .x { margin-left: 4px; }
  .x:hover { background: rgba(255,255,255,0.16); } .x:active { transform: scale(0.94); }
  .x:focus-visible, button:focus-visible { outline: 2px solid rgba(190,160,255,0.9); outline-offset: 2px; }
  .grab { display: none; }

  .body { padding: 4px 20px 20px; }
  .body > section { margin-top: 14px; }
  h3 { display: flex; align-items: center; gap: 8px; margin: 22px 2px 10px; font-size: 12.5px; font-weight: 700; letter-spacing: 0.7px; text-transform: uppercase; color: var(--wx-soft); }
  h3 small { margin-left: auto; font-size: 12px; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--wx-dim); }
  .panel { border-radius: 22px; background: var(--wx-panel); border: 1px solid rgba(255,255,255,0.10); box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); }
  .note { font-size: 13.5px; color: var(--wx-soft); line-height: 1.45; }
  .warn { display: flex; gap: 10px; align-items: center; padding: 12px 14px; border-radius: 16px; background: rgba(255,170,90,0.14); border: 1px solid rgba(255,190,120,0.35);
    font-size: 13.5px; margin-top: 12px; } .warn ha-icon { --mdc-icon-size: 20px; color: #ffc98a; }
  .swap { animation: wxin 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); }

  /* now: big temperature over a small live sky that follows the real conditions */
  .now { position: relative; isolation: isolate; overflow: hidden; border-radius: 26px; padding: 18px 20px 16px; border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 16px 40px rgba(10,6,34,0.45), inset 0 1px 0 rgba(255,255,255,0.20); background: #1e1546; }
  .nsky { position: absolute; inset: 0; z-index: -1; overflow: hidden; contain: layout paint; }
  .nsky > div { position: absolute; }
  .nshade { inset: 0; background: linear-gradient(90deg, rgba(8,6,24,0.52) 0%, rgba(8,6,24,0.20) 60%, rgba(8,6,24,0.10) 100%), linear-gradient(180deg, transparent 40%, rgba(8,6,24,0.45) 100%); }
  .ncl { width: 250px; height: 88px; left: 0; will-change: transform;
    background: radial-gradient(ellipse 36% 48% at 30% 62%, var(--cloud) 0 58%, transparent 72%), radial-gradient(ellipse 30% 56% at 52% 44%, var(--cloud) 0 58%, transparent 72%),
      radial-gradient(ellipse 32% 42% at 73% 62%, var(--cloud) 0 58%, transparent 72%), radial-gradient(ellipse 52% 30% at 50% 76%, var(--cloud) 0 62%, transparent 76%);
    animation: ndrift 80s linear infinite; }
  .ncl.a { top: 2%; animation-delay: -22s; } .ncl.b { top: 34%; width: 200px; height: 70px; opacity: 0.8; animation-duration: 110s; animation-delay: -70s; }
  .ncl.c { top: -12%; width: 320px; height: 110px; opacity: 0.9; animation-duration: 95s; animation-delay: -48s; }
  .nrain { left: -10%; right: -10%; top: -140px; height: calc(100% + 140px); background-image: ${RAIN_TILE}; background-size: 140px 140px; opacity: 0.75; will-change: transform; animation: nfall 0.8s linear infinite; }
  .nrain.hv { animation-duration: 0.5s; opacity: 0.95; }
  .nsnow { left: -10%; right: -10%; top: -160px; height: calc(100% + 160px); background-image: ${SNOW_TILE}; background-size: 160px 160px; will-change: transform; animation: nsnowf 11s linear infinite; }
  .nsun { right: 6%; top: -50px; width: 190px; height: 190px; border-radius: 50%; background: radial-gradient(circle, rgba(255,226,160,0.75) 0%, rgba(255,200,120,0.30) 30%, rgba(255,190,100,0) 68%);
    animation: nglow 7s ease-in-out infinite alternate; }
  .nstars { inset: 0; background-image: ${STARS_A}; background-size: cover; opacity: 0.85; }
  .nmoon { right: 14%; top: 18px; width: 40px; height: 40px; border-radius: 50%; background: radial-gradient(circle at 36% 34%, #fffef6 0%, #ebe6f7 55%, #c9c1e4 100%);
    box-shadow: 0 0 26px 6px rgba(215,205,255,0.32); }
  .nflash { inset: 0; background: radial-gradient(80% 90% at 30% 0%, rgba(230,225,255,0.55), transparent 75%); opacity: 0; animation: nflash 12s linear infinite; }
  @keyframes ndrift { from { transform: translate3d(-330px, 0, 0); } to { transform: translate3d(820px, 0, 0); } }
  @keyframes nfall { to { transform: translate3d(0, 140px, 0); } }
  @keyframes nsnowf { 50% { transform: translate3d(-12px, 80px, 0); } to { transform: translate3d(0, 160px, 0); } }
  @keyframes nglow { to { transform: scale(1.08); opacity: 0.85; } }
  @keyframes nflash { 0%, 90%, 100% { opacity: 0; } 91% { opacity: 0.8; } 92% { opacity: 0.1; } 94% { opacity: 0.6; } 97% { opacity: 0; } }
  .nmain { display: flex; align-items: flex-end; gap: 16px; }
  .big { font-family: "Space Grotesk", "Inter", var(--ha-font-family-heading, Roboto), sans-serif; font-weight: 300; font-size: clamp(72px, 15vw, 100px); line-height: 0.86;
    letter-spacing: -0.035em; font-variant-numeric: tabular-nums; color: #f7f3ff; text-shadow: 0 0 34px rgba(167,139,250,0.45), 0 2px 16px rgba(10,6,30,0.5); }
  .cond { padding-bottom: 6px; min-width: 0; }
  .cond .c { display: flex; align-items: center; gap: 8px; font-size: 19px; font-weight: 700; }
  .cond .c ha-icon { --mdc-icon-size: 30px; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.3)); }
  .cond .l { font-size: 14px; color: rgba(255,255,255,0.84); margin-top: 5px; } .cond .l b { font-weight: 700; color: #fff; }
  .facts { display: grid; grid-template-columns: 1.5fr 1fr 1fr; gap: 8px; margin-top: 16px; }
  .fact { display: flex; align-items: center; gap: 9px; padding: 9px 11px; border-radius: 16px; min-width: 0;
    background: linear-gradient(155deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02) 60%), rgba(12,10,32,0.40); border: 1px solid rgba(255,255,255,0.14); }
  .fact ha-icon { --mdc-icon-size: 20px; color: rgba(255,255,255,0.85); }
  .fact .v { font-size: 14.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fact .k { font-size: 11.5px; color: var(--wx-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fact.rain ha-icon { color: #9cc8ff; } .fact > div { min-width: 0; }

  /* briefing */
  .brief { position: relative; display: flex; gap: 14px; padding: 16px 18px; border-radius: 22px;
    background: radial-gradient(120% 160% at 0% 0%, rgba(139,92,246,0.30), transparent 60%), rgba(18,13,44,0.55); border: 1px solid rgba(190,160,255,0.30);
    box-shadow: 0 12px 34px rgba(110,70,230,0.20), inset 0 1px 0 rgba(255,255,255,0.12); }
  .brief .ic { width: 42px; height: 42px; border-radius: 14px; flex: none; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 24px;
    background: linear-gradient(145deg, rgba(167,139,250,0.55), rgba(99,72,210,0.45)); box-shadow: 0 0 18px rgba(139,92,246,0.45); }
  .brief .hd { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; }
  .brief p { margin: 6px 0 0; font-size: 15px; line-height: 1.45; color: rgba(255,255,255,0.92); }
  .brief p + p { margin-top: 4px; color: rgba(255,255,255,0.78); font-size: 14px; }

  /* current readings */
  .mets { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 8px; }
  .met { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); min-width: 0; }
  .met ha-icon { --mdc-icon-size: 19px; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.08); }
  .met .v { font-size: 15.5px; font-weight: 700; white-space: nowrap; } .met .k { font-size: 11.5px; color: var(--wx-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .met > div { min-width: 0; }

  /* days */
  .days { display: grid; gap: 6px; }
  .day { display: grid; grid-template-columns: 76px 30px minmax(0, 1fr) 70px 34px minmax(80px, 1.4fr) 34px; align-items: center; gap: 8px; width: 100%;
    padding: 9px 12px; border-radius: 16px; background: rgba(12,10,32,0.30); border: 1px solid rgba(255,255,255,0.09); text-align: left; cursor: pointer;
    -webkit-tap-highlight-color: transparent; transition: background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, transform 0.12s ease; }
  .day:hover { background: rgba(255,255,255,0.07); } .day:active { transform: scale(0.99); }
  .day.sel { background: linear-gradient(90deg, rgba(139,92,246,0.36), rgba(139,92,246,0.18)); border-color: rgba(190,160,255,0.60); box-shadow: 0 6px 20px rgba(110,70,230,0.25); }
  .day .dn { font-weight: 700; font-size: 15px; } .day .dn small { display: block; font-size: 11.5px; font-weight: 500; color: var(--wx-soft); margin-top: 1px; }
  .day > ha-icon { --mdc-icon-size: 26px; }
  .day .cn { font-size: 13px; color: rgba(255,255,255,0.80); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .day .rn { font-size: 12.5px; font-weight: 700; color: #9cc8ff; white-space: nowrap; text-align: right; line-height: 1.2; }
  .day .rn.dry { color: var(--wx-dim); font-weight: 500; } .day .rn small { display: block; font-size: 10.5px; font-weight: 600; color: #c9c1e4; }
  .day .lo, .day .hi { font-size: 15px; font-weight: 700; text-align: right; } .day .lo { color: var(--wx-soft); font-weight: 500; } .day .hi { text-align: left; }
  .bar { position: relative; height: 7px; border-radius: 4px; background: rgba(255,255,255,0.10); }
  .bar i { position: absolute; top: 0; bottom: 0; border-radius: 4px; box-shadow: 0 0 10px rgba(185,166,255,0.25); }
  .bar b { position: absolute; top: 50%; width: 11px; height: 11px; margin: -5.5px 0 0 -5.5px; border-radius: 50%; background: #fff; border: 2px solid #1e1546; box-shadow: 0 0 0 1px rgba(255,255,255,0.6); }
  .sk { height: 52px; border-radius: 16px; background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.04) 100%);
    background-size: 200% 100%; animation: sk 1.4s ease-in-out infinite; }
  @keyframes sk { from { background-position: 100% 0; } to { background-position: -100% 0; } }

  /* the chosen day */
  .dhd { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .dhd .n { font-size: 20px; font-weight: 700; } .dhd .s { font-size: 14px; color: var(--wx-soft); }
  .grps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
  .grp { padding: 12px 14px 8px; }
  .grp .gh { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; color: var(--wx-soft); margin-bottom: 4px; }
  .grp .gh ha-icon { --mdc-icon-size: 17px; }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 7px 0; border-top: 1px solid rgba(255,255,255,0.06); font-size: 13.5px; }
  .grp .gh + .row { border-top: none; }
  .row span:first-child { color: var(--wx-soft); } .row span:last-child { font-weight: 700; text-align: right; }
  .row.cmp { align-items: center; }
  .cmp svg { width: 46px; height: 46px; flex: none; }

  /* hour by hour: one horizontal scroller with the timeline and the chart, sharing the chosen hour */
  .hourly { padding: 14px 0 12px; overflow: hidden; }
  .hourly > .pad { padding: 0 14px; }
  .seg { position: relative; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 3px; border-radius: 14px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.08); }
  .seg .th { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 4); border-radius: 11px; transform: translateX(calc(var(--i) * 100%));
    background: linear-gradient(145deg, rgba(167,139,250,0.55), rgba(110,80,220,0.45)); box-shadow: 0 4px 14px rgba(110,70,230,0.35); transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .seg button { position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; border: 0; background: none; cursor: pointer;
    font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.72); border-radius: 11px; -webkit-tap-highlight-color: transparent; }
  .seg button[aria-pressed="true"] { color: #fff; } .seg ha-icon { --mdc-icon-size: 17px; }
  .ro { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; min-height: 44px; margin-top: 12px; padding: 9px 12px; border-radius: 14px;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); font-size: 13px; }
  .ro .when { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 6px; } .ro .when ha-icon { --mdc-icon-size: 20px; }
  .ro .it { white-space: nowrap; color: rgba(255,255,255,0.86); } .ro .it b { color: #fff; }
  .hs { overflow-x: auto; overscroll-behavior-x: contain; margin-top: 10px; padding: 0 14px 6px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.22) transparent; }
  .trk { position: relative; }
  .mk { position: relative; height: 22px; }
  .mk span { position: absolute; top: 2px; transform: translateX(-50%); display: flex; align-items: center; gap: 3px; padding: 1px 7px; border-radius: 9px; white-space: nowrap;
    font-size: 11px; font-weight: 700; background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); --mdc-icon-size: 13px; }
  .mk span.sr { color: #ffd27a; } .mk span.ss { color: #ff9f6b; } .mk span.nw { background: rgba(167,139,250,0.85); color: #fff; } .mk span.wd { color: var(--wx-teal); }
  .mk span.dv { color: #fff; background: rgba(255,255,255,0.16); text-transform: uppercase; letter-spacing: 0.5px; }
  .tl { display: grid; }
  .hc { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 6px 0 4px; border: 0; border-radius: 12px; background: none; cursor: pointer; -webkit-tap-highlight-color: transparent;
    transition: background 0.2s ease; }
  .hc:hover { background: rgba(255,255,255,0.05); }
  .hc.sel { background: rgba(167,139,250,0.22); box-shadow: inset 0 0 0 1px rgba(190,160,255,0.45); }
  .hc .h { font-size: 11.5px; font-weight: 700; color: rgba(255,255,255,0.75); } .hc.now .h { color: #d9ccff; }
  .hc ha-icon { --mdc-icon-size: 21px; } .hc .tp { font-size: 13.5px; font-weight: 700; } .hc .mm { font-size: 10.5px; font-weight: 600; color: #9cc8ff; min-height: 13px; }
  .chart { display: block; margin-top: 4px; animation: wxfade 0.3s ease; cursor: pointer; }
  .chart text { font-family: inherit; }
  .nowln { position: absolute; top: 22px; bottom: 4px; width: 2px; margin-left: -1px; border-radius: 1px; background: linear-gradient(180deg, rgba(190,160,255,0.95), rgba(190,160,255,0.15)); pointer-events: none; }
  .lg { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: 11.5px; color: var(--wx-soft); }
  .lg i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  .lg i.ln { height: 3px; border-radius: 2px; vertical-align: 2px; width: 14px; } .lg i.dash { height: 0; border-top: 2px dashed rgba(255,255,255,0.55); border-radius: 0; vertical-align: 3px; width: 14px; }

  /* sun */
  .sun { padding: 14px 16px 12px; }
  .sun svg { display: block; width: 100%; height: auto; max-height: 190px; }
  .sun .sl { display: flex; justify-content: space-between; gap: 10px; margin-top: 2px; font-size: 13px; }
  .sun .sl b { display: block; font-size: 16px; } .sun .sl span { color: var(--wx-soft); } .sun .sl > div:last-child { text-align: right; }
  .sun .sm { text-align: center; font-size: 13px; color: var(--wx-soft); margin-top: 8px; } .sun .sm b { color: #fff; }

  /* insights */
  .ins { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .card { display: flex; gap: 12px; padding: 14px; }
  .card .ic { width: 38px; height: 38px; border-radius: 12px; flex: none; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 21px; background: rgba(255,255,255,0.08); }
  .card .t { font-size: 14px; font-weight: 700; } .card .d { font-size: 13.5px; color: rgba(255,255,255,0.84); margin-top: 3px; line-height: 1.4; }
  .card .f { font-size: 11.5px; color: var(--wx-dim); margin-top: 6px; line-height: 1.4; }
  details { margin-top: 6px; } summary { cursor: pointer; font-size: 12px; color: #c9b8ff; list-style: none; } summary::-webkit-details-marker { display: none; }
  summary::before { content: "▸ "; } details[open] summary::before { content: "▾ "; }
  details .note { margin-top: 6px; font-size: 12.5px; }
  .about { margin-top: 18px; padding: 12px 14px; } .about summary { font-size: 13px; color: var(--wx-soft); }
  .about ul { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--wx-soft); line-height: 1.5; }

  @media (prefers-reduced-motion: reduce) {
    .scrim, .sheet, .swap, .chart, .sk { animation: none !important; }
    .nsky > div { animation: none !important; } .seg .th, .day, .hdr .mini { transition: none; }
  }

  /* phones: a full-width sheet from the bottom with a handle to drag it away */
  @media (max-width: 600px) {
    .sheet { left: 0; right: 0; top: auto; bottom: 0; width: 100%; transform: none; border-radius: 26px 26px 0 0; max-height: 94vh; max-height: 94dvh; }
    @keyframes pop { from { opacity: 0; transform: translateY(28px); } }
    .hdr { padding: 18px 12px 10px 16px; border-radius: 26px 26px 0 0; }
    .grab { display: block; position: absolute; left: 50%; top: 0; width: 120px; height: 22px; margin-left: -60px; touch-action: none; cursor: grab; }
    .grab::after { content: ""; position: absolute; left: 42px; right: 42px; top: 8px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.35); }
    .body { padding: 2px 12px 18px; }
    .now { padding: 16px 16px 14px; }
    .facts { grid-template-columns: 1fr 1fr; } .fact.rain { grid-column: 1 / -1; }
    .day { grid-template-columns: 58px 26px 50px 28px minmax(40px, 1fr) 28px; gap: 6px; padding: 9px 10px; } .day .cn { display: none; }
    .grps, .ins { grid-template-columns: minmax(0, 1fr); }
    .seg button span { display: none; } .seg button { min-height: 40px; }
    .hs { padding: 0 10px 6px; } .hourly > .pad { padding: 0 10px; }
  }
  @media (max-width: 380px) { .mets { grid-template-columns: 1fr 1fr; } }`;

class GlassHomeWeatherSheet extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${WX_SHEET_CSS}</style><div class="scrim"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="wxttl"><div class="hdrbox"></div><div class="body"></div></div>`;
    this._sheet = this.shadowRoot.querySelector(".sheet");
    this._tab = "rain";
    this.shadowRoot.querySelector(".scrim").addEventListener("click", () => this.close());
    this._sheet.addEventListener("click", (e) => this._onClick(e));
    this._sheet.addEventListener("keydown", (e) => this._onKey(e));
    this._sheet.addEventListener("scroll", () => this._onScroll(), { passive: true });
    this._sheet.addEventListener("pointerdown", (e) => this._dragStart(e));
    this._esc = (e) => { if (e.key === "Escape") this.close(); };
  }

  // Opened by a hero card, which stays the source of the live forecast while the sheet is open
  show(owner, sel) {
    this._owner = owner;
    this._sel = sel || wxKey(new Date());
    this._hr = null;
    this._sig = null;
    this.setAttribute("open", "");
    // the hero's own sky pauses while the sheet covers it (the sheet blurs what is behind it)
    owner.setAttribute("wxopen", "");
    document.addEventListener("keydown", this._esc);
    clearInterval(this._iv);
    this._iv = setInterval(() => { this._sig = null; this.refresh(); }, 60000);
    this._sheet.scrollTop = 0;
    this.refresh();
    this._loadTrend();
    const x = this.shadowRoot.querySelector(".x");
    if (x) x.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.removeAttribute("open");
    document.removeEventListener("keydown", this._esc);
    clearInterval(this._iv);
    const o = this._owner;
    this._owner = null;
    this._sig = null;
    this._sheet.style.transform = "";
    if (o) {
      o.removeAttribute("wxopen");
      const wx = o.shadowRoot && o.shadowRoot.querySelector(".wx");
      if (wx) wx.focus({ preventScroll: true });
    }
  }

  get isOpen() { return this.hasAttribute("open"); }

  // Pressure trend from the entity's own readings over the last few hours (one read per opening, kept 15 minutes)
  async _loadTrend() {
    const o = this._owner;
    if (!o || !o._hass || typeof o._hass.callWS !== "function") return;
    const ent = o._config.weather;
    if (this._trend && this._trend.ent === ent && Date.now() - this._trend.at < 9e5) return;
    const end = new Date(), start = new Date(end.getTime() - 3.5 * 3600e3);
    try {
      const r = await o._hass.callWS({ type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(),
        entity_ids: [ent], minimal_response: false, no_attributes: false, significant_changes_only: false });
      const pts = ((r && r[ent]) || []).map((x) => ({ t: (x.lu || x.lc || 0) * 1000, p: wxNum(x.a && x.a.pressure) })).filter((x) => x.t && x.p != null);
      let trend = null;
      if (pts.length >= 2) {
        const last = pts[pts.length - 1], first = pts[0], hrs = (last.t - first.t) / 3600e3;
        if (hrs >= 2) trend = { d: ((last.p - first.p) / hrs) * 3, hrs };
      }
      this._trend = { ent, at: Date.now(), v: trend };
    } catch (e) {
      this._trend = { ent, at: Date.now(), v: null };
    }
    this._sig = null;
    this.refresh();
  }

  // ---- events
  _onClick(e) {
    const path = e.composedPath();
    const el = path.find((n) => n.dataset && n.dataset.act);
    if (!el) return;
    const act = el.dataset.act, v = el.dataset.v;
    if (act === "close") this.close();
    else if (act === "day" && v !== this._sel) { this._sel = v; this._hr = null; this._render({ swap: true }); }
    else if (act === "tab" && v !== this._tab) { this._tab = v; this._renderHourly(true); }
    else if (act === "hr") this._pickHour(Number(v));
    else if (act === "chart") {
      const trk = this.shadowRoot.querySelector(".trk"), M = this._M, D = M && M.sel;
      if (!trk || !D) return;
      const i = Math.floor((e.clientX - trk.getBoundingClientRect().left) / WX_CW);
      if (D.span[i]) this._pickHour(D.span[i].ms);
    }
  }

  _onKey(e) {
    // left and right move between hours in the timeline
    const hc = e.composedPath().find((n) => n.classList && n.classList.contains("hc"));
    if (hc && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      const D = this._M && this._M.sel, i = D ? D.span.findIndex((h) => h.ms === Number(hc.dataset.v)) : -1;
      const n = D && D.span[i + (e.key === "ArrowLeft" ? -1 : 1)];
      if (n) { e.preventDefault(); this._pickHour(n.ms); const b = this.shadowRoot.querySelector(`.hc[data-v="${n.ms}"]`); if (b) b.focus(); }
      return;
    }
    // keep keyboard focus inside the sheet
    if (e.key === "Tab") {
      const f = [...this.shadowRoot.querySelectorAll("button, summary, [tabindex='0']")].filter((n) => n.offsetParent !== null);
      if (!f.length) return;
      const cur = this.shadowRoot.activeElement, i = f.indexOf(cur);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }

  _onScroll() {
    const hdr = this.shadowRoot.querySelector(".hdr"), now = this.shadowRoot.querySelector(".now");
    if (!hdr) return;
    const top = this._sheet.scrollTop;
    hdr.classList.toggle("stuck", top > 2);
    hdr.classList.toggle("min", !!now && top > now.offsetTop + now.offsetHeight - hdr.offsetHeight - 10);
  }

  // phones: drag the handle down to close
  _dragStart(e) {
    if (!e.composedPath().some((n) => n.classList && n.classList.contains("grab"))) return;
    const y0 = e.clientY, sh = this._sheet;
    let dy = 0;
    const move = (ev) => { dy = Math.max(0, ev.clientY - y0); sh.style.transform = `translateY(${dy}px)`; };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (dy > 90) this.close();
      else sh.style.transform = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  _pickHour(ms) {
    if (this._hr === ms) return;
    this._hr = ms;
    this._renderHourly(false);
    this._renderSun();
  }

  // ---- data
  // Called on every Home Assistant update; does nothing unless something the sheet shows has changed
  refresh() {
    const o = this._owner;
    if (!this.isOpen || !o || !o._hass) return;
    const hass = o._hass, cfg = o._config, st = hass.states[cfg.weather];
    const ids = this._ids || (this._ids = new WeakMap());
    const id = (x) => { if (!x || typeof x !== "object") return 0; if (!ids.has(x)) ids.set(x, ++GlassHomeWeatherSheet._n); return ids.get(x); };
    const sig = [st && st.last_updated, st && st.state, id(o._fc), id(o._fcd), cfg.indoor && hass.states[cfg.indoor] && hass.states[cfg.indoor].state,
      cfg.climate && hass.states[cfg.climate] && hass.states[cfg.climate].last_updated, Math.floor(Date.now() / 60000), this._trend && this._trend.at].join("|");
    if (sig === this._sig) return;
    this._sig = sig;
    this._render();
  }

  _model() {
    const o = this._owner, hass = o._hass, cfg = o._config, st = hass.states[cfg.weather];
    const a = (st && st.attributes) || {};
    const uT = a.temperature_unit || "°C", uW = a.wind_speed_unit || "km/h", uP = a.precipitation_unit || "mm";
    const C = (v) => wxToC(wxNum(v), uT), K = (v) => wxToKmh(wxNum(v), uW);
    const lat = wxNum(hass.config && hass.config.latitude), lon = wxNum(hass.config && hass.config.longitude);
    const sunMemo = new Map();
    const sunFor = (d) => { if (lat == null || lon == null) return null; const k = wxKey(d); if (!sunMemo.has(k)) sunMemo.set(k, wxSunTimes(d, lat, lon)); return sunMemo.get(k); };
    const isNight = (t) => { const s = sunFor(t); return s ? t < s.rise || t > s.set : t.getHours() < 7 || t.getHours() >= 19; };
    const now = new Date(), todayKey = wxKey(now), tomorrowKey = wxKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const hours = Array.isArray(o._fc) ? o._fc.filter((f) => f.datetime).map((f) => {
      const t = new Date(f.datetime), tc = C(f.temperature), wk = K(f.wind_speed), hum = wxNum(f.humidity), fc = wxFeels(tc, wk, hum);
      const h = { t, ms: t.getTime(), key: wxKey(t), cond: f.condition, temp: wxNum(f.temperature), tc, mm: wxNum(f.precipitation), wind: wxNum(f.wind_speed), wk,
        bearing: wxNum(f.wind_bearing), hum, cloud: wxNum(f.cloud_coverage), uv: wxNum(f.uv_index), feelsC: fc, night: isNight(new Date(t.getTime() + 1800e3)) };
      h.wet = wxIsWet(h);
      return h;
    }).filter((h) => h.ms + 3600e3 > now.getTime()).sort((p, q) => p.ms - q.ms) : null;
    const daily = Array.isArray(o._fcd) ? o._fcd.filter((f) => f.datetime && wxNum(f.temperature) != null) : null;
    // today: the hour-by-hour view rolls on 24 hours from now, and from mid-afternoon the briefing looks on
    // through the night to 09:00 tomorrow
    const nineTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9).getTime();
    const days = daily ? daily.filter((f) => wxKey(new Date(f.datetime)) >= todayKey).slice(0, 6).map((f) => {
      const d = new Date(f.datetime), key = wxKey(d), isToday = key === todayKey;
      const lo = wxNum(f.templow) != null ? wxNum(f.templow) : wxNum(f.temperature);
      const own = hours ? hours.filter((h) => h.key === key) : [];
      const ext = isToday && now.getHours() >= 15 && hours ? hours.filter((h) => h.ms < nineTomorrow) : null;
      return { key, d, f, isToday, span: isToday && hours ? hours.slice(0, 24) : own, ahead: ext && ext.length > own.length ? ext : own, tonight: !!(ext && ext.length > own.length), name: isToday ? "Today" : key === tomorrowKey ? "Tomorrow" : d.toLocaleDateString(GH_LOCALE, { weekday: "long" }),
        short: isToday ? "Today" : d.toLocaleDateString(GH_LOCALE, { weekday: "short" }), cond: f.condition, hi: wxNum(f.temperature), lo, hiC: C(f.temperature), loC: wxToC(lo, uT),
        mm: wxNum(f.precipitation), wind: wxNum(f.wind_speed), wk: K(f.wind_speed), bearing: wxNum(f.wind_bearing), hum: wxNum(f.humidity), uv: wxNum(f.uv_index),
        hours: own, sun: sunFor(d) };
    }) : null;
    if (days && days.length && !days.some((x) => x.key === this._sel)) this._sel = days[0].key;
    const sel = days ? days.find((x) => x.key === this._sel) || null : null;
    const avail = !!st && !["unavailable", "unknown"].includes(st.state);
    const updated = st ? new Date(st.last_updated) : null;
    const cur = { cond: avail ? st.state : null, temp: wxNum(a.temperature), tc: C(a.temperature), hum: wxNum(a.humidity), dew: wxNum(a.dew_point), pressure: wxNum(a.pressure),
      cloud: wxNum(a.cloud_coverage), uv: wxNum(a.uv_index), wind: wxNum(a.wind_speed), wk: K(a.wind_speed), bearing: wxNum(a.wind_bearing), vis: wxNum(a.visibility),
      ozone: wxNum(a.ozone), apparent: wxNum(a.apparent_temperature), gust: wxNum(a.wind_gust_speed) };
    cur.feelsC = cur.apparent != null ? C(cur.apparent) : wxFeels(cur.tc, cur.wk, cur.hum);
    const rainNow = avail && (RAIN_CONDS.includes(cur.cond) || (hours && hours[0] && hours[0].ms <= now.getTime() && hours[0].wet));
    return { o, hass, cfg, st, a, uT, uW, uP, now, todayKey, hours, days, sel, avail, updated, cur, rainNow, isNight, sunFor,
      stale: updated ? now - updated > 2 * 3600e3 : false, scene: avail && typeof o._scene === "function" && typeof o._input === "function" ? o._scene(o._input()) : null };
  }

  // ---- rendering
  _render(opts = {}) {
    const M = (this._M = this._model());
    const hb = this.shadowRoot.querySelector(".hdrbox"), body = this.shadowRoot.querySelector(".body");
    const hdr = this._hdrHtml(M);
    if (hdr !== this._hdrLast) {
      const hadFocus = this.shadowRoot.activeElement && this.shadowRoot.activeElement.classList.contains("x");
      hb.innerHTML = this._hdrLast = hdr;
      if (hadFocus) this.shadowRoot.querySelector(".x").focus({ preventScroll: true });
    }
    const html = this._bodyHtml(M);
    if (html !== this._bodyLast || opts.swap || !body.firstChild) {
      const hs = this.shadowRoot.querySelector(".hs"), keep = hs && !opts.swap ? hs.scrollLeft : null;
      const act = this.shadowRoot.activeElement, fk = act && act.dataset && act.dataset.act ? act.dataset : null;
      const focusSel = fk ? `[data-act="${fk.act}"]${fk.v ? `[data-v="${fk.v}"]` : ""}` : null;
      // open "how this is worked out" sections stay open across a refresh
      const open = [...body.querySelectorAll("details[open] summary")].map((s) => s.parentNode.closest("[data-k]") ? s.parentNode.closest("[data-k]").dataset.k : s.textContent);
      body.innerHTML = this._bodyLast = html;
      body.querySelectorAll("details").forEach((d) => { const k = d.closest("[data-k]") ? d.closest("[data-k]").dataset.k : d.querySelector("summary").textContent; if (open.includes(k)) d.open = true; });
      if (opts.swap) body.querySelectorAll(".brief, .dsel, .hourw, .sunw, .insw").forEach((n) => n.classList.add("swap"));
      this._renderHourly(false, keep);
      this._renderSun();
      if (focusSel) { const n = this.shadowRoot.querySelector(focusSel); if (n) n.focus({ preventScroll: true }); }
    } else {
      // the rest is unchanged, but the time has moved on: the now line and the sun follow it
      this._renderHourly(false);
      this._renderSun();
    }
    this._onScroll();
  }

  _hdrHtml(M) {
    const ago = M.updated ? Math.round((M.now - M.updated) / 60000) : null;
    const when = M.updated ? (M.stale ? `Last updated ${ago >= 120 ? `${Math.floor(ago / 60)} h` : `${ago} min`} ago` : `Updated ${wxHm(M.updated)}`) : "Waiting for the weather service";
    const name = M.a.friendly_name ? wxEsc(M.a.friendly_name) : "";
    const mini = M.avail && M.cur.temp != null ? `<div class="mini" aria-hidden="true"><ha-icon icon="${this._icon(M.cur.cond, M.isNight(M.now))}"></ha-icon>${Math.round(M.cur.temp)}°</div>` : "";
    return `<div class="hdr"><div class="grab" aria-hidden="true"></div><div class="ttl"><h2 id="wxttl">Weather${name ? ` · ${name}` : ""}</h2>
      <div class="sub${M.stale ? " stale" : ""}">${when} · met.no forecast</div></div>${mini}
      <button class="x" data-act="close" aria-label="Close the weather"><ha-icon icon="mdi:close"></ha-icon></button></div>`;
  }

  _icon(cond, night) { return (night && NIGHT_ICON[cond]) || WEATHER_ICON[cond] || "mdi:weather-cloudy-alert"; }
  _text(cond, night) { return night && cond === "sunny" ? "Clear" : WEATHER_TEXT[cond] || (cond ? String(cond).replace(/[-_]/g, " ") : "–"); }
  _deg(M, c) { return c == null ? "–" : `${Math.round(wxFromC(c, M.uT))}°`; }
  _wind(M, v, bearing) { if (v == null) return "–"; const d = wxCompass(bearing); return `${Math.round(v)} ${wxEsc(M.uW)}${d ? ` ${d}` : ""}`; }

  _bodyHtml(M) {
    return [this._nowHtml(M), this._briefHtml(M), this._metsHtml(M), this._daysHtml(M), this._dayHtml(M),
      '<div class="hourw"></div>', '<div class="sunw"></div>', this._insHtml(M), this._aboutHtml(M)].join("");
  }

  _nowHtml(M) {
    if (!M.avail) {
      return `<div class="warn"><ha-icon icon="mdi:cloud-off-outline"></ha-icon><div>The weather service isn't answering right now.${M.days ? " The forecast below is the last one received." : ""}</div></div>`;
    }
    const c = M.cur, night = M.isNight(M.now), sc = M.scene;
    let sky = "";
    if (sc) {
      const L = sc.layers, cl = [...L].filter((x) => /^c\d$/.test(x)).length;
      sky = `<div class="nsky" style="background:${SKY[sc.sky] || SKY.none};--cloud:${sc.cloud || "rgba(255,255,255,0.7)"}">`
        + (L.has("stars") ? '<div class="nstars"></div>' : "") + (L.has("moon") ? '<div class="nmoon"></div>' : "") + (L.has("sun") ? '<div class="nsun"></div>' : "")
        + (cl ? '<div class="ncl c"></div><div class="ncl a"></div>' : "") + (cl >= 3 ? '<div class="ncl b"></div>' : "")
        + (L.has("rain") ? `<div class="nrain${L.has("heavy") ? " hv" : ""}"></div>` : "") + (L.has("snow") ? '<div class="nsnow"></div>' : "")
        + (L.has("flash") ? '<div class="nflash"></div>' : "") + '<div class="nshade"></div></div>';
    }
    const today = M.days && M.days.find((x) => x.isToday);
    const hl = today ? `H <b>${this._deg(M, today.hiC)}</b> · L <b>${this._deg(M, today.loC)}</b>` : "";
    const feels = c.feelsC != null && c.tc != null ? `Feels like <b>${this._deg(M, c.feelsC)}</b>${c.apparent != null ? "" : '<span class="calc">calc.</span>'}` : "";
    const fact = (cls, ic, v, k) => `<div class="fact ${cls}"><ha-icon icon="${ic}"></ha-icon><div><div class="v">${v}</div><div class="k">${k}</div></div></div>`;
    return `<section class="now">${sky}<div class="nmain"><div class="big" aria-label="${c.temp != null ? `${Math.round(c.temp)} degrees` : ""}">${c.temp != null ? `${Math.round(c.temp)}°` : "–"}</div>
        <div class="cond"><div class="c"><ha-icon icon="${this._icon(c.cond, night)}"></ha-icon>${wxEsc(this._text(c.cond, night))}</div>
        ${feels ? `<div class="l">${feels}</div>` : ""}${hl ? `<div class="l">${hl}</div>` : ""}</div></div>
      <div class="facts">${fact("rain", M.rainNow ? "mdi:weather-rainy" : "mdi:umbrella-closed-outline", wxEsc(this._rainLine(M)), "Rain · hourly forecast")}
        ${c.wind != null ? fact("", "mdi:weather-windy", this._wind(M, c.wind, c.bearing), c.gust != null ? `Gusts ${Math.round(c.gust)} ${wxEsc(M.uW)}` : "Wind") : ""}
        ${c.hum != null ? fact("", "mdi:water-percent", `${Math.round(c.hum)}%`, "Humidity") : ""}</div></section>`;
  }

  // Rain now and next, to the hour: "Raining · easing by about 23:00", "Rain from about 15:00", "Dry for the next 30 h"
  _rainLine(M) {
    const H = M.hours;
    if (!H || !H.length) return M.rainNow ? "Raining now" : "No hourly forecast yet";
    const i = H.findIndex((h) => h.wet), hm = wxAt;
    const dayWord = (ms) => { const k = wxKey(new Date(ms)); return k === M.todayKey || wxAt(ms) === "midnight" ? "" : ` ${M.days && M.days[1] && M.days[1].key === k ? "tomorrow" : new Date(ms).toLocaleDateString(GH_LOCALE, { weekday: "long" })}`; };
    if (M.rainNow || i === 0) {
      const j = H.findIndex((h, k) => k > 0 && !h.wet);
      return j < 0 ? "Raining, all through the forecast" : `Raining · easing by about ${hm(H[j].ms)}${dayWord(H[j].ms)}`;
    }
    if (i < 0) return `Dry for the next ${Math.round((H[H.length - 1].ms + 3600e3 - M.now.getTime()) / 3600e3)} h`;
    return `Rain from about ${hm(H[i].ms)}${dayWord(H[i].ms)}`;
  }

  _briefHtml(M) {
    const D = M.sel;
    if (!D) return "";
    const b = wxBrief(M, D);
    const title = D.isToday ? "Today's briefing" : `${D.name}'s briefing`;
    return `<section class="brief" aria-live="polite"><div class="ic"><ha-icon icon="${b[0].ic}"></ha-icon></div><div>
      <div class="hd">${wxEsc(title)} <span class="tag">Forecast</span></div>${b.map((x) => `<p>${wxEsc(x.t)}</p>`).join("")}</div></section>`;
  }

  _metsHtml(M) {
    if (!M.avail) return "";
    const c = M.cur, met = (ic, col, v, k) => `<div class="met"><ha-icon icon="${ic}" style="color:${col}"></ha-icon><div><div class="v">${v}</div><div class="k">${k}</div></div></div>`;
    const tr = this._trend && this._trend.v, tw = tr ? (Math.abs(tr.d) < 0.5 ? "steady" : `${tr.d > 0 ? "rising" : "falling"}${Math.abs(tr.d) < 1.6 ? " slowly" : Math.abs(tr.d) >= 3.6 ? " fast" : ""}`) : "";
    const list = [
      c.dew != null ? met("mdi:thermometer-water", "#7fd1c7", `${Math.round(c.dew)}°`, "Dew point") : "",
      c.pressure != null ? met("mdi:gauge", "#c4b5fd", `${Math.round(c.pressure)} <small style="font-weight:500;font-size:11px">${wxEsc(M.a.pressure_unit || "hPa")}</small>`,
        tr ? `<span title="${tr.d > 0 ? "+" : ""}${tr.d.toFixed(1)} ${wxEsc(M.a.pressure_unit || "hPa")} in 3 hours (calculated from recent readings)">${tw[0].toUpperCase() + tw.slice(1)} ${tr.d > 0 ? "+" : ""}${tr.d.toFixed(1)}/3h</span>` : "Pressure") : "",
      c.cloud != null ? met("mdi:cloud-outline", "#d9d4f2", `${Math.round(c.cloud)}%`, "Cloud cover") : "",
      c.uv != null ? met("mdi:sun-wireless-outline", "#ffd27a", `${Math.round(c.uv)}`, `UV · ${wxUv(c.uv)}`) : "",
      c.vis != null ? met("mdi:eye-outline", "#b9a6ff", `${Math.round(c.vis)} ${wxEsc(M.a.visibility_unit || "km")}`, "Visibility") : "",
    ].join("");
    return list ? `<section><div class="mets">${list}</div></section>` : "";
  }

  _daysHtml(M) {
    if (!M.days) return `<h3>Next days</h3><div class="days" aria-busy="true"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>`;
    if (!M.days.length) return `<h3>Next days</h3><div class="note">No daily forecast from the weather service yet.</div>`;
    const lo = Math.min(...M.days.map((x) => x.loC)), hi = Math.max(...M.days.map((x) => x.hiC)), span = Math.max(1, hi - lo);
    const pos = (c) => ((c - lo) / span) * 100;
    const rows = M.days.map((D) => {
      const l = pos(D.loC), w = Math.max(5, pos(D.hiC) - l), windy = D.wk != null && D.wk >= 35;
      const rain = D.mm != null && D.mm >= 0.1 ? `<div class="rn">${wxMm(D.mm)} mm${windy ? `<small>${Math.round(D.wind)} ${wxEsc(M.uW)}</small>` : ""}</div>`
        : `<div class="rn dry">${D.mm == null ? "–" : "Dry"}${windy ? `<small>${Math.round(D.wind)} ${wxEsc(M.uW)}</small>` : ""}</div>`;
      const dot = D.isToday && M.cur.tc != null && M.cur.tc >= lo && M.cur.tc <= hi ? `<b style="left:${pos(M.cur.tc).toFixed(1)}%" title="Now"></b>` : "";
      const label = `${D.name} ${D.d.toLocaleDateString(GH_LOCALE, { day: "numeric", month: "long" })}: ${this._text(D.cond, false)}, ${this._deg(M, D.loC)} to ${this._deg(M, D.hiC)}${D.mm != null && D.mm >= 0.1 ? `, ${wxMm(D.mm)} mm of rain` : ", dry"}`;
      return `<button class="day${D.key === this._sel ? " sel" : ""}" data-act="day" data-v="${D.key}" aria-pressed="${D.key === this._sel}" aria-label="${wxEsc(label)}">
        <div class="dn">${D.short}<small>${D.d.toLocaleDateString(GH_LOCALE, { day: "numeric", month: "short" })}</small></div>
        <ha-icon icon="${this._icon(D.cond, false)}" style="color:${RAIN_CONDS.includes(D.cond) ? "#9cc8ff" : D.cond === "sunny" ? "#ffd27a" : D.cond === "partlycloudy" ? "#ffe3a3" : "#e6e3f2"}"></ha-icon>
        <div class="cn">${wxEsc(this._text(D.cond, false))}</div>${rain}
        <div class="lo">${this._deg(M, D.loC)}</div><div class="bar"><i style="left:${Math.min(95, l).toFixed(1)}%;width:${Math.min(100 - Math.min(95, l), w).toFixed(1)}%;background:linear-gradient(90deg, ${wxTempCol(D.loC)}, ${wxTempCol(D.hiC)})"></i>${dot}</div>
        <div class="hi">${this._deg(M, D.hiC)}</div></button>`;
    }).join("");
    return `<h3>Next ${M.days.length} days <small>tap a day</small></h3><div class="days">${rows}</div>`;
  }

  // The chosen day in detail, grouped; only what the forecast gives or can be worked out from it
  _dayHtml(M) {
    const D = M.sel;
    if (!D) return "";
    const H = D.hours, has = H.length > 0, row = (k, v) => (v == null || v === "" ? "" : `<div class="row"><span>${k}</span><span>${v}</span></div>`);
    const calc = '<span class="calc">calc.</span>', hm = (ms) => wxHm(new Date(ms));
    const grp = (ic, col, t, rows) => (rows ? `<div class="grp panel"><div class="gh"><ha-icon icon="${ic}" style="color:${col}"></ha-icon>${t}</div>${rows}</div>` : "");
    // temperature
    const feels = has ? H.map((h) => h.feelsC).filter((v) => v != null) : [];
    // frost looks at the same hours as the briefing (today: on through the night from mid-afternoon)
    const coldH = D.ahead.length ? wxColdest(D.ahead) : null;
    const lowC = coldH ? coldH.tc : D.loC, fr = wxFrost(lowC, coldH ? coldH.cloud : null);
    const frost = fr && fr[0].toUpperCase() + fr.slice(1);
    const dewC = D.isToday && M.cur.dew != null ? wxToC(M.cur.dew, M.uT) : has ? (() => { const v = H.map((h) => wxDew(h.tc, h.hum)).filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; })() : null;
    const tRows = row("High", this._deg(M, D.hiC)) + row("Low", this._deg(M, D.loC))
      + (feels.length ? row(`Feels like${calc}`, this._deg(M, Math.min(...feels)) === this._deg(M, Math.max(...feels)) ? this._deg(M, feels[0]) : `${this._deg(M, Math.min(...feels))} to ${this._deg(M, Math.max(...feels))}`) : "")
      + (dewC != null ? row(`Dew point${D.isToday && M.cur.dew != null ? " now" : `, average${calc}`}`, this._deg(M, dewC)) : "")
      + (frost ? row(`Frost risk${D.tonight ? " tonight" : ""}${calc}`, frost === "Low" ? "Low" : `${frost} (low ${this._deg(M, lowC)})`) : "");
    // rain
    let rRows = row("Total", D.mm != null ? (D.mm >= 0.1 ? `${wxMm(D.mm)} mm` : "None") : null);
    if (has) {
      const peak = H.reduce((m, h) => ((h.mm || 0) > (m.mm || 0) ? h : m), H[0]);
      if ((peak.mm || 0) >= 0.1) rRows += row("Heaviest hour", `${hm(peak.ms)} · ${wxMm(peak.mm)} mm (${wxRate(peak.mm)})`);
      let best = null;
      for (let i = 0; i + 3 <= H.length; i++) { const s = wxSum(H.slice(i, i + 3)); if (s >= 0.3 && (!best || s > best.s)) best = { s, i }; }
      if (best) rRows += row("Wettest spell", `${hm(H[best.i].ms)}–${hm(H[best.i + 2].ms + 3600e3)} · ${wxMm(best.s)} mm`);
      const dry = wxSpells(H, (h) => !h.wet).sort((p, q) => q.b - q.a - (p.b - p.a))[0];
      if (dry && dry.b - dry.a + 1 >= 2 && dry.b - dry.a + 1 < H.length) rRows += row("Longest dry spell", `${hm(H[dry.a].ms)}–${hm(H[dry.b].ms + 3600e3)}`);
      else if (dry && dry.b - dry.a + 1 === H.length) rRows += row("Dry spell", D.isToday ? "Rest of the day" : "All day");
    }
    // wind
    const wAvg = has ? H.reduce((s, h) => s + (h.wind || 0), 0) / H.length : D.wind;
    const wTop = has ? H.reduce((m, h) => ((h.wind || 0) > (m.wind || 0) ? h : m), H[0]) : null;
    const brg = D.bearing != null ? D.bearing : wTop && wTop.bearing;
    const comp = brg == null ? "" : `<svg viewBox="-24 -24 48 48" aria-hidden="true"><circle r="21" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.18)"/>
      <text y="-13" text-anchor="middle" font-size="7" fill="rgba(255,255,255,0.6)">N</text>
      <g transform="rotate(${(brg + 180) % 360})"><path d="M0 -15 L5 6 L0 2 L-5 6 Z" fill="#7fd1c7"/></g></svg>`;
    const wRows = row(has ? "Average" : "Wind", wAvg != null ? `${Math.round(wAvg)} ${wxEsc(M.uW)}` : null)
      + (wTop ? row("Strongest", `${Math.round(wTop.wind)} ${wxEsc(M.uW)} at ${hm(wTop.ms)}`) : "")
      + (brg != null ? `<div class="row cmp"><span>From the ${WX_COMPASS_LONG[wxCompass(brg)]}</span>${comp}</div>` : "");
    // atmosphere
    const cl = has ? H.map((h) => h.cloud).filter((v) => v != null) : [];
    const uv = D.uv != null ? D.uv : has && H.some((h) => h.uv != null) ? Math.max(...H.map((h) => h.uv || 0)) : null;
    const aRows = row("Humidity", D.hum != null ? `${Math.round(D.hum)}%` : null)
      + (cl.length ? row("Cloud cover, average", `${Math.round(cl.reduce((s, x) => s + x, 0) / cl.length)}%`) : "")
      + row("UV, highest", uv != null ? `${Math.round(uv)} · ${wxUv(uv)}` : null)
      + (D.isToday && M.cur.pressure != null ? row("Pressure now", `${Math.round(M.cur.pressure)} ${wxEsc(M.a.pressure_unit || "hPa")}`) : "");
    const date = D.d.toLocaleDateString(GH_LOCALE, { weekday: "long", day: "numeric", month: "long" });
    return `<section class="dsel"><h3>${D.isToday ? "Today in detail" : wxEsc(D.name)}</h3>
      <div class="dhd"><span class="n">${wxEsc(D.isToday ? `Today, ${D.d.toLocaleDateString(GH_LOCALE, { day: "numeric", month: "long" })}` : date)}</span>
        <span class="s">${wxEsc(this._text(D.cond, false))} · ${this._deg(M, D.loC)} to ${this._deg(M, D.hiC)}</span></div>
      <div class="grps">${grp("mdi:thermometer", "#ffb36b", "Temperature", tRows)}${grp("mdi:weather-pouring", "#9cc8ff", "Rain", rRows)}
        ${grp("mdi:weather-windy", "#7fd1c7", "Wind", wRows)}${grp("mdi:cloud-outline", "#c4b5fd", "Atmosphere", aRows)}</div></section>`;
  }

  // ---- hour by hour (timeline + chart); re-drawn on its own when the tab or the chosen hour changes
  _renderHourly(fade, keepScroll) {
    const host = this.shadowRoot.querySelector(".hourw"), M = this._M;
    if (!host || !M) return;
    const D = M.sel;
    const hs0 = host.querySelector(".hs"), keep = keepScroll != null ? keepScroll : hs0 ? hs0.scrollLeft : null;
    if (!D) { host.innerHTML = ""; return; }
    if (!M.hours) { host.innerHTML = `<h3>Hour by hour</h3><div class="sk" style="height:180px"></div>`; return; }
    const H = D.span;
    if (!H.length) {
      host.innerHTML = `<h3>Hour by hour</h3><div class="panel note" style="padding:14px 16px">The hourly forecast covers about the next 48 hours, so ${wxEsc(D.name)} only has the daily forecast so far.</div>`;
      return;
    }
    if (this._hr == null || !H.some((h) => h.ms === this._hr)) {
      const noon = H.find((h) => h.t.getHours() === 12);
      this._hr = D.isToday ? H[0].ms : (noon || H[0]).ms;
    }
    const si = H.findIndex((h) => h.ms === this._hr), sh = H[si];
    const n = H.length, W = n * WX_CW, hm = (ms) => wxHm(new Date(ms)), isNow = (h) => D.isToday && h.ms <= M.now.getTime() && M.now.getTime() < h.ms + 3600e3;
    const x0 = H[0].ms, xAt = (ms) => ((ms - x0) / 3600e3) * WX_CW;
    // markers: sunrise, sunset, a lasting change of wind direction, now
    const marks = [];
    // sunrise and sunset of every day the hours cross, and where a new day starts
    [...new Set(H.map((h) => h.key))].forEach((k, j) => {
      const h0 = H.find((h) => h.key === k), sun = M.sunFor(h0.t);
      if (j) marks.push({ x: xAt(h0.ms), c: "dv", h: h0.t.toLocaleDateString(GH_LOCALE, { weekday: "short" }) });
      if (sun) [["sr", "mdi:weather-sunset-up", sun.rise], ["ss", "mdi:weather-sunset-down", sun.set]].forEach(([c, ic, t]) => { const x = xAt(t.getTime()); if (x >= 0 && x <= W) marks.push({ x, c, h: `<ha-icon icon="${ic}"></ha-icon>${wxHm(t)}` }); });
    });
    const sec = (b) => (b == null ? null : Math.round((((b % 360) + 360) % 360) / 45) % 8);
    const S8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    // a wind shift counts when the new direction holds for the next hour too (and was not the direction two hours before)
    for (let i = 2; i < n - 1; i++) {
      const s = sec(H[i].bearing);
      if (s != null && s !== sec(H[i - 1].bearing) && s === sec(H[i + 1].bearing) && s !== sec(H[i - 2].bearing))
        marks.push({ x: i * WX_CW + WX_CW / 2, c: "wd", h: `<ha-icon icon="mdi:weather-windy"></ha-icon>from ${S8[s]}` });
    }
    const nowX = D.isToday && M.now.getTime() >= x0 ? Math.min(W, xAt(M.now.getTime())) : null;
    // sun markers always show; a wind marker only where it does not crowd another marker
    const kept = marks.filter((m) => m.c !== "wd");
    marks.filter((m) => m.c === "wd").forEach((m) => { if (!kept.some((o) => Math.abs(o.x - m.x) < 70)) kept.push(m); });
    const markHtml = kept.map((m) => `<span class="${m.c}" style="left:${Math.min(W - 34, Math.max(34, m.x)).toFixed(0)}px">${m.h}</span>`).join("");
    const cells = H.map((h) => {
      const lab = `${hm(h.ms)}, ${this._text(h.cond, h.night)}, ${this._deg(M, h.tc)}, ${h.mm != null && h.mm >= 0.1 ? `${wxMm(h.mm)} mm of rain` : "no rain"}${h.wind != null ? `, wind ${Math.round(h.wind)} ${M.uW}` : ""}`;
      return `<button class="hc${h.ms === this._hr ? " sel" : ""}${isNow(h) ? " now" : ""}" data-act="hr" data-v="${h.ms}" aria-pressed="${h.ms === this._hr}" aria-label="${wxEsc(lab)}">
        <span class="h">${isNow(h) ? "Now" : String(h.t.getHours()).padStart(2, "0")}</span><ha-icon icon="${this._icon(h.cond, h.night)}"></ha-icon>
        <span class="tp">${this._deg(M, h.tc)}</span><span class="mm">${h.mm != null && h.mm >= 0.1 ? wxMm(h.mm) : ""}</span></button>`;
    }).join("");
    const ti = WX_TABS.findIndex((t) => t[0] === this._tab);
    const seg = `<div class="seg" role="group" aria-label="Chart" style="--i:${ti}"><div class="th"></div>${WX_TABS.map(([k, t, ic]) =>
      `<button data-act="tab" data-v="${k}" aria-pressed="${k === this._tab}" aria-label="${t}"><ha-icon icon="${ic}"></ha-icon><span>${t}</span></button>`).join("")}</div>`;
    // the chosen hour's readout
    const it = (k, v) => (v == null ? "" : `<span class="it">${k} <b>${v}</b></span>`);
    const ro = `<div class="ro" aria-live="polite"><span class="when"><ha-icon icon="${this._icon(sh.cond, sh.night)}"></ha-icon>${isNow(sh) ? "Now" : hm(sh.ms)} · ${wxEsc(this._text(sh.cond, sh.night))}</span>
      ${it("", this._deg(M, sh.tc))}${sh.feelsC != null && sh.tc != null && Math.round(sh.feelsC) !== Math.round(sh.tc) ? it("Feels", `${this._deg(M, sh.feelsC)}<span class="calc">calc.</span>`) : ""}
      ${it("Rain", sh.mm != null ? `${wxMm(sh.mm)} mm${sh.mm >= 0.1 ? ` · ${wxRate(sh.mm)}` : ""}` : null)}
      ${it("Wind", sh.wind != null ? this._wind(M, sh.wind, sh.bearing) : null)}${it("Humidity", sh.hum != null ? `${Math.round(sh.hum)}%` : null)}
      ${it("Cloud", sh.cloud != null ? `${Math.round(sh.cloud)}%` : null)}${sh.uv ? it("UV", Math.round(sh.uv)) : ""}</div>`;
    const sub = D.isToday ? `next ${n} hours` : H[n - 1].t.getHours() < 23 ? `forecast until ${hm(H[n - 1].ms + 3600e3)}` : "";
    host.innerHTML = `<h3>Hour by hour${sub ? ` <small>${sub}</small>` : ""}</h3><section class="hourly panel"><div class="pad">${seg}${ro}</div>
      <div class="hs"><div class="trk" style="width:${W}px"><div class="mk">${markHtml}</div>
        <div class="tl" style="grid-template-columns:repeat(${n}, ${WX_CW}px)" role="group" aria-label="Hours">${cells}</div>${this._chart(M, D, si)}
        ${nowX != null ? `<div class="nowln" style="left:${nowX.toFixed(1)}px"></div>` : ""}</div></div>
      <div class="pad">${this._legend(M, D)}</div></section>`;
    const hs = host.querySelector(".hs");
    if (keep != null) hs.scrollLeft = keep;
    else if (si > 2) hs.scrollLeft = Math.max(0, si * WX_CW - 2 * WX_CW);
    if (fade === false) host.querySelector(".chart").style.animation = "none";
    // a newly chosen hour is scrolled into view when it is off the edge
    const x = si * WX_CW;
    if (x < hs.scrollLeft || x + WX_CW > hs.scrollLeft + hs.clientWidth) hs.scrollLeft = Math.max(0, x - hs.clientWidth / 2);
  }

  _chart(M, D, si) {
    const H = D.span, n = H.length, W = n * WX_CW, CH = 132, base = 112, cx = (i) => i * WX_CW + WX_CW / 2;
    const selRect = `<rect x="${si * WX_CW + 3}" y="0" width="${WX_CW - 6}" height="${CH}" rx="10" fill="rgba(167,139,250,0.14)"/>`;
    const lab = (x, y, t, col, w = 600) => `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="${w}" fill="${col}">${t}</text>`;
    let g = "";
    const defs = `<defs><linearGradient id="wxT" x1="0" y1="20" x2="0" y2="${base}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
      <linearGradient id="wxTA" x1="0" y1="20" x2="0" y2="${base}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="rgba(255,210,122,0.30)"/><stop offset="1" stop-color="rgba(167,139,250,0)"/></linearGradient>
      <linearGradient id="wxH" x1="0" y1="20" x2="0" y2="${base}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="rgba(127,209,199,0.40)"/><stop offset="1" stop-color="rgba(143,180,255,0)"/></linearGradient>
      <linearGradient id="wxR" x1="0" y1="20" x2="0" y2="${base}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8fc4ff"/><stop offset="1" stop-color="#3f7fe6"/></linearGradient></defs>`;
    const baseLine = `<line x1="0" x2="${W}" y1="${base + 0.5}" y2="${base + 0.5}" stroke="rgba(255,255,255,0.12)"/>`;
    if (this._tab === "rain") {
      const max = Math.max(2, ...H.map((h) => h.mm || 0));
      const col = { light: "rgba(143,196,255,0.60)", moderate: "url(#wxR)", heavy: "#6d5cff" };
      H.forEach((h, i) => {
        const mm = h.mm || 0;
        if (mm < 0.1 && !h.wet) return;
        const ht = Math.max(3, (mm / max) * 86), r = wxRate(mm);
        g += `<rect x="${i * WX_CW + 10}" y="${(base - ht).toFixed(1)}" width="${WX_CW - 20}" height="${ht.toFixed(1)}" rx="4" fill="${col[r] || col.light}"${r === "heavy" ? ' style="filter:drop-shadow(0 0 6px rgba(109,92,255,0.6))"' : ""}/>`;
        if (mm >= 0.1) g += lab(cx(i), base - ht - 5, wxMm(mm), "#b9dcff");
      });
      wxSpells(H).filter((s) => s.b - s.a >= 2).forEach((s) => { g += `<rect x="${s.a * WX_CW + 6}" y="${base + 6}" width="${(s.b - s.a + 1) * WX_CW - 12}" height="4" rx="2" fill="rgba(90,169,255,0.55)"/>`; });
      if (!H.some((h) => (h.mm || 0) >= 0.1 || h.wet)) g += lab(Math.min(W / 2, 170), 66, "No rain forecast", "rgba(255,255,255,0.55)", 500);
    } else if (this._tab === "temp") {
      const t = H.map((h) => wxFromC(h.tc, M.uT)), f = H.map((h) => wxFromC(h.feelsC, M.uT));
      const all = [...t, ...f].filter((v) => v != null), lo = Math.min(...all), hi = Math.max(...all), sp = Math.max(2, hi - lo);
      const y = (v) => 100 - ((v - lo) / sp) * 72;
      const pts = t.map((v, i) => (v == null ? null : [cx(i), y(v)])).filter(Boolean), fpts = f.map((v, i) => (v == null ? null : [cx(i), y(v)])).filter(Boolean);
      if (pts.length) {
        const line = wxSmooth(pts);
        g += `<path d="${line} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z" fill="url(#wxTA)"/>`;
        if (fpts.length && f.some((v, i) => v != null && t[i] != null && Math.round(v) !== Math.round(t[i]))) g += `<path d="${wxSmooth(fpts)}" fill="none" stroke="rgba(255,255,255,0.50)" stroke-width="1.6" stroke-dasharray="4 4"/>`;
        g += `<path d="${line}" fill="none" stroke="url(#wxT)" stroke-width="3" stroke-linecap="round"/>`;
        const iMax = t.indexOf(Math.max(...t.filter((v) => v != null))), iMin = t.indexOf(Math.min(...t.filter((v) => v != null)));
        [[iMax, "#ffd27a", -10], [iMin, "#b9a6ff", 18]].forEach(([i, c, dy], k) => {
          if (k === 1 && iMin === iMax) return;
          g += `<circle cx="${cx(i)}" cy="${y(t[i]).toFixed(1)}" r="4.5" fill="${c}" stroke="#1e1546" stroke-width="2"/>` + lab(cx(i), y(t[i]) + dy, `${k ? "L" : "H"} ${Math.round(t[i])}°`, c, 700);
        });
        if (t[si] != null) g += `<circle cx="${cx(si)}" cy="${y(t[si]).toFixed(1)}" r="5" fill="#fff" stroke="#8b5cf6" stroke-width="2.5"/>`;
      }
    } else if (this._tab === "wind") {
      const windyU = wxFromKmh(40, M.uW), max = Math.max(windyU * 0.8, ...H.map((h) => h.wind || 0));
      H.forEach((h, i) => {
        if (h.wind == null) return;
        const ht = Math.max(3, (h.wind / max) * 64), windy = (h.wk || 0) >= 40;
        g += `<rect x="${i * WX_CW + 12}" y="${(base - ht).toFixed(1)}" width="${WX_CW - 24}" height="${ht.toFixed(1)}" rx="4" fill="${windy ? "#ffb36b" : "rgba(127,209,199,0.75)"}"/>`;
        g += lab(cx(i), base - ht - 5, Math.round(h.wind), windy ? "#ffd2a8" : "#bdeee7");
        if (h.bearing != null) g += `<g transform="translate(${cx(i)},14) rotate(${(h.bearing + 180) % 360})"><path d="M0 -7 L4.5 5 L0 2 L-4.5 5 Z" fill="${windy ? "#ffb36b" : "#7fd1c7"}"/></g>`;
      });
      if (max >= windyU) { const yy = base - (windyU / max) * 64; g += `<line x1="0" x2="${W}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="rgba(255,179,107,0.45)" stroke-dasharray="5 5"/>`; }
    } else {
      const y = (v) => base - (v / 100) * 84;
      const pts = H.map((h, i) => (h.hum == null ? null : [cx(i), y(h.hum)])).filter(Boolean);
      if (pts.length) {
        const line = wxSmooth(pts);
        g += `<path d="${line} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z" fill="url(#wxH)"/><path d="${line}" fill="none" stroke="#7fd1c7" stroke-width="2.6" stroke-linecap="round"/>`;
        H.forEach((h, i) => { if (h.hum != null && (i % 3 === 0 || i === si)) g += lab(cx(i), y(h.hum) - 7, `${Math.round(h.hum)}%`, i === si ? "#fff" : "#bdeee7", i === si ? 700 : 600); });
        if (H[si].hum != null) g += `<circle cx="${cx(si)}" cy="${y(H[si].hum).toFixed(1)}" r="4.5" fill="#fff" stroke="#7fd1c7" stroke-width="2.5"/>`;
      }
    }
    const names = { rain: "Rain by the hour", temp: "Temperature by the hour", wind: "Wind by the hour", hum: "Humidity by the hour" };
    return `<svg class="chart" data-act="chart" width="${W}" height="${CH}" viewBox="0 0 ${W} ${CH}" role="img" aria-label="${names[this._tab]}">${defs}${selRect}${baseLine}${g}</svg>`;
  }

  _legend(M, D) {
    if (this._tab === "rain") return `<div class="lg"><span><i style="background:rgba(143,196,255,0.6)"></i>Light, under 0.5 mm/h</span><span><i style="background:#5aa9ff"></i>Moderate</span><span><i style="background:#6d5cff"></i>Heavy, 4 mm/h or more</span><span><i class="ln" style="background:rgba(90,169,255,0.7)"></i>3 h or more of rain</span></div>`;
    if (this._tab === "temp") return `<div class="lg"><span><i class="ln" style="background:linear-gradient(90deg,#a78bfa,#ffd27a)"></i>Temperature</span><span><i class="dash"></i>Feels like<span class="calc">calc.</span></span></div>`;
    if (this._tab === "wind") return `<div class="lg"><span><i style="background:rgba(127,209,199,0.75)"></i>Wind, ${wxEsc(M.uW)}</span><span><i style="background:#ffb36b"></i>Windy, ${Math.round(wxFromKmh(40, M.uW))} ${wxEsc(M.uW)} or more</span><span>Arrows show where the wind blows to</span></div>`;
    return `<div class="lg"><span><i class="ln" style="background:#7fd1c7"></i>Relative humidity</span></div>`;
  }

  // ---- the sun's arc for the chosen day; the sun dot is the real position today, the chosen hour on other days
  _renderSun() {
    const host = this.shadowRoot.querySelector(".sunw"), M = this._M;
    if (!host || !M) return;
    const D = M.sel, s = D && D.sun;
    if (!s) { host.innerHTML = ""; return; }
    const rise = s.rise.getTime(), set = s.set.getTime(), len = (set - rise) / 60000, now = M.now.getTime();
    const yest = M.sunFor(new Date(D.d.getFullYear(), D.d.getMonth(), D.d.getDate() - 1));
    const dlen = yest ? Math.round(len - (yest.set - yest.rise) / 60000) : null;
    const X0 = 30, X1 = 290, Y = 112, R = 92, pt = (p) => { const a = Math.PI * (1 - p); return [160 + 130 * Math.cos(a), Y - R * Math.sin(a)]; };
    let at = null, label = "";
    if (D.isToday) {
      if (now >= rise && now <= set) { at = (now - rise) / (set - rise); label = `<b>${wxDur((set - now) / 60000)}</b> of daylight left`; }
      else if (now < rise) label = `Sunrise in <b>${wxDur((rise - now) / 60000)}</b>`;
      else { const tm = M.sunFor(new Date(D.d.getFullYear(), D.d.getMonth(), D.d.getDate() + 1)); label = `The sun has set${tm ? ` · rises <b>${wxHm(tm.rise)}</b> tomorrow` : ""}`; }
    } else if (this._hr != null && this._hr >= rise && this._hr <= set) { at = (this._hr - rise) / (set - rise); label = `Sun at <b>${wxHm(new Date(this._hr))}</b>, the chosen hour`; }
    else label = `<b>${wxDur(len)}</b> of daylight`;
    const done = at == null ? (D.isToday && now > set ? 1 : 0) : at, [sx, sy] = at == null ? [0, 0] : pt(at);
    const path = `M${X0} ${Y} A130 ${R} 0 0 1 ${X1} ${Y}`;
    host.innerHTML = `<h3>Sun <small>${wxEsc(D.isToday ? "today" : D.name)}</small></h3><section class="sun panel">
      <svg viewBox="0 0 320 132" role="img" aria-label="Sunrise ${wxHm(s.rise)}, sunset ${wxHm(s.set)}, ${wxDur(len)} of daylight">
        <defs><linearGradient id="wxS" x1="${X0}" x2="${X1}" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff9f6b"/><stop offset="0.5" stop-color="#ffd27a"/><stop offset="1" stop-color="#ff8a5c"/></linearGradient>
          <radialGradient id="wxSG"><stop offset="0" stop-color="rgba(255,214,140,0.9)"/><stop offset="1" stop-color="rgba(255,190,100,0)"/></radialGradient></defs>
        <line x1="10" x2="310" y1="${Y + 0.5}" y2="${Y + 0.5}" stroke="rgba(255,255,255,0.18)"/>
        <path d="${path}" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="3" stroke-dasharray="2 6" stroke-linecap="round"/>
        ${done > 0.002 ? `<path d="${path}" fill="none" stroke="url(#wxS)" stroke-width="3.5" stroke-linecap="round" pathLength="1" stroke-dasharray="${done.toFixed(4)} 1"/>` : ""}
        <line x1="160" x2="160" y1="${Y - R - 6}" y2="${Y - R + 6}" stroke="rgba(255,255,255,0.35)"/>
        <text x="160" y="${Y - R - 10}" text-anchor="middle" font-size="10.5" fill="rgba(255,255,255,0.65)">Solar noon ${wxHm(s.noon)}</text>
        ${at != null ? `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="18" fill="url(#wxSG)"/><circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="7" fill="#ffe39a" stroke="#fff6dc" stroke-width="2"/>` : ""}
        <circle cx="${X0}" cy="${Y}" r="4" fill="#ff9f6b"/><circle cx="${X1}" cy="${Y}" r="4" fill="#ff8a5c"/>
      </svg>
      <div class="sl"><div><span>Sunrise</span><b>${wxHm(s.rise)}</b></div><div><span>Daylight</span><b>${wxDur(len)}</b></div><div><span>Sunset</span><b>${wxHm(s.set)}</b></div></div>
      <div class="sm">${label}${dlen ? ` · ${Math.abs(dlen)} min ${dlen > 0 ? "longer" : "shorter"} than the day before` : ""}<span class="calc">calc.</span></div></section>`;
  }

  // ---- insights: best time out, frost risk, home; each only when there is something real to say
  _insHtml(M) {
    const D = M.sel;
    if (!D) return "";
    const cards = [], card = (ic, col, t, d, f, more) => `<div class="card panel" data-k="${wxEsc(t.split(":")[0])}"><div class="ic" style="color:${col}"><ha-icon icon="${ic}"></ha-icon></div><div>
      <div class="t">${t}</div><div class="d">${d}</div>${f ? `<div class="f">${f}</div>` : ""}${more ? `<details><summary>How this is worked out</summary><div class="note">${more}</div></details>` : ""}</div></div>`;
    const hm = (ms) => wxHm(new Date(ms));
    if (D.span.length) {
      // today looks over the next 24 hours, so in the evening this finds tomorrow's best spell
      const b = wxBest(D.span);
      if (b) {
        const r = b.run, a = r[0].ms, z = r[r.length - 1].ms + 3600e3, ts = r.map((h) => h.tc).filter((v) => v != null), ws = Math.max(...r.map((h) => h.wind || 0));
        const temps = ts.length ? `${this._deg(M, Math.min(...ts))}${Math.round(Math.min(...ts)) !== Math.round(Math.max(...ts)) ? `–${this._deg(M, Math.max(...ts))}` : ""}` : "";
        const dayW = r[0].key === M.todayKey || r[0].key === D.key ? "" : `${M.days && M.days[1] && M.days[1].key === r[0].key ? "Tomorrow" : r[0].t.toLocaleDateString(GH_LOCALE, { weekday: "long" })} `;
        cards.push(card("mdi:walk", "#9be3c4", "Best time to go out", b.dry
          ? `<b>${dayW}${hm(a)}–${hm(z)}</b> · dry${temps ? `, ${temps}` : ""}${ws ? `, wind up to ${Math.round(ws)} ${wxEsc(M.uW)}` : ""}`
          : `No dry daylight hours forecast. Least wet: <b>${dayW}${hm(a)}</b> (${wxMm(r[0].mm || 0)} mm).`,
          "Based on the hourly forecast, so not a guarantee.",
          "Each daylight hour starts at 100 points. Rain takes off 60, plus 15 per millimetre. Below 12° takes off 2.5 per degree, above 24° takes off 3 per degree. Wind over 15 km/h takes off 1.2 per km/h. The best run of up to three dry daylight hours in a row is chosen."));
      }
    }
    const lowH = D.ahead.length ? wxColdest(D.ahead) : null;
    const low = lowH ? lowH.tc : D.loC, frost = wxFrost(low, lowH ? lowH.cloud : null);
    if (frost === "high" || frost === "possible") {
      cards.push(card("mdi:snowflake-thermometer", "#9fd0ff", `Frost risk: ${frost}`,
        `Forecast low of <b>${this._deg(M, low)}</b>${lowH ? ` around ${hm(lowH.ms)}` : ""}${lowH && lowH.cloud != null && lowH.cloud < 40 ? " under mostly clear skies" : ""}.`,
        "A risk assessment from the forecast air temperature, not a frost forecast. Ground frost can form a few degrees above 0°.", ""));
    }
    // home: indoor against outdoor, and the heating (facts only)
    const st = M.hass.states, cfg = M.cfg;
    const inS = cfg.indoor && st[cfg.indoor], inC = inS ? wxNum(inS.state) : null;
    if (inC != null && M.cur.temp != null) {
      const diff = inC - M.cur.temp;
      cards.push(card("mdi:home-thermometer-outline", "#c4b5fd", "Inside and out",
        `<b>${inC.toFixed(1)}°</b> indoors, <b>${Math.round(M.cur.temp)}°</b> outside: ${Math.abs(diff) < 0.5 ? "about the same" : `${Math.abs(Math.round(diff))}° ${diff > 0 ? "warmer" : "cooler"} inside`}.`,
        inS.attributes.friendly_name ? `Indoor: ${wxEsc(inS.attributes.friendly_name)}` : "", ""));
    }
    const cl = cfg.climate && st[cfg.climate];
    if (cl && !["unavailable", "unknown"].includes(cl.state)) {
      const act = cl.attributes.hvac_action, tgt = wxNum(cl.attributes.temperature), tonight = D.isToday && lowH ? lowH : null;
      const doing = act === "heating" ? "Heating now" : cl.state === "off" ? "Heating off" : "Heating idle";
      cards.push(card("mdi:radiator", act === "heating" ? "#ffb36b" : "#d9d4f2", doing,
        `${tgt != null && cl.state !== "off" ? `Set to <b>${tgt}°</b>. ` : ""}${tonight ? `Outside is forecast to fall to <b>${this._deg(M, tonight.tc)}</b> around ${hm(tonight.ms)}.` : M.cur.temp != null ? `It's <b>${Math.round(M.cur.temp)}°</b> outside.` : ""}`,
        "The thermostat's own state and the forecast, side by side.", ""));
    }
    return cards.length ? `<section class="insw"><h3>Insights</h3><div class="ins">${cards.join("")}</div></section>` : "";
  }

  _aboutHtml(M) {
    const missing = ["chance of rain", "wind gusts", "visibility", "air quality", "official weather warnings"]
      .filter((k) => !(k === "wind gusts" && M.cur.gust != null) && !(k === "visibility" && M.cur.vis != null));
    return `<details class="about panel"><summary>About this forecast</summary><ul>
      <li>${wxEsc(M.a.attribution || "From the Home Assistant weather entity.")} Now means the forecast model's value for the current hour, not a weather station reading.</li>
      <li>The hourly forecast covers about 48 hours; later days have the daily forecast only. Times are to the hour.</li>
      <li>Marked <span class="calc">calc.</span>: worked out here from the forecast. Feels like uses wind chill or the heat index. Dew point for later hours uses the Magnus formula. Frost risk comes from the forecast low. The pressure trend comes from the last few hours of readings. Daylight and solar noon use the NOAA sun equations. Best time to go out uses the scoring described with it.</li>
      <li>Not provided by this weather service, so not shown: ${missing.join(", ")}. For warnings, check the Met Office.</li></ul></details>`;
  }
}
GlassHomeWeatherSheet._n = 0;
if (!customElements.get("glasshome-weather-sheet")) customElements.define("glasshome-weather-sheet", GlassHomeWeatherSheet);
const wxSheet = () => {
  let s = document.body.querySelector(":scope > glasshome-weather-sheet");
  if (!s) { s = document.createElement("glasshome-weather-sheet"); document.body.appendChild(s); }
  return s;
};

class GlassHomeHeroCard extends HTMLElement {
  setConfig(config) {
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    this._subscribeForecast();
    this._wxRefresh();
    const k = JSON.stringify([this._input(), this._stats()]);
    if (k !== this._key) {
      this._key = k;
      this._render();
    }
  }

  connectedCallback() {
    this._tick();
    // Only animate while the panel is actually on screen (the pager slides pages out of view)
    if (!this._io && "IntersectionObserver" in window) {
      this._io = new IntersectionObserver((es) => es.forEach((e) => this.toggleAttribute("offscreen", !e.isIntersecting)));
      this._io.observe(this);
    }
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
    if (this._io) { this._io.disconnect(); this._io = null; }
    if (this._fcSub) { this._fcSub.then((un) => un && un()).catch(() => {}); this._fcSub = null; }
    if (this._fcdSub) { this._fcdSub.then((un) => un && un()).catch(() => {}); this._fcdSub = null; }
    const sh = document.body.querySelector(":scope > glasshome-weather-sheet");
    if (sh && sh._owner === this) sh.close();
  }

  // the detailed forecast sheet, while it is open from this card
  _wxRefresh() {
    const sh = this._wxSheetEl;
    if (sh && sh.isOpen && sh._owner === this) sh.refresh();
  }

  getCardSize() {
    return 4;
  }

  // Clock and greeting once a minute, on the minute; the scene is re-checked too (hour-based fallback)
  _tick() {
    clearTimeout(this._timer);
    this._clock();
    if (this._hass) this._render();
    const now = new Date();
    this._timer = setTimeout(() => this._tick(), 60500 - now.getSeconds() * 1000 - now.getMilliseconds());
  }

  _clock() {
    if (!this.shadowRoot) return;
    const now = new Date(), tp = ghTimeParts(now), h = tp.h;
    const set = (sel, v) => { const n = this.shadowRoot.querySelector(sel); if (n && n.textContent !== v) n.textContent = v; };
    const part = h >= 22 || h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
    this._setTime(ghClockText(tp));
    set(".date", now.toLocaleDateString(GH_LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: GH_TZ }));
    set(".hello", ghGreeting(part, this._config.family));
  }

  // The clock face: one cell per character, so when the minute changes only the digits that changed
  // glide (the old one up and out, the new one in from below) and nothing else moves. Tabular figures
  // keep every cell the same width. No animation on first paint, off screen, or with reduced motion.
  _setTime(v) {
    const t = this.shadowRoot.querySelector(".time");
    if (!t || t.dataset.v === v) return;
    const still = !t.dataset.v || this.hasAttribute("offscreen") || !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    t.dataset.v = v;
    t.setAttribute("aria-label", v);
    if (t.children.length !== v.length) {
      t.innerHTML = [...v].map((ch) => `<span class="dg${ch === ":" ? " sep" : ""}" aria-hidden="true"><span>${esc(ch)}</span></span>`).join("");
      return;
    }
    [...v].forEach((ch, i) => {
      const cell = t.children[i], cur = cell.lastElementChild;
      if (cur.textContent === ch) return;
      if (still) { cell.innerHTML = `<span>${esc(ch)}</span>`; return; }
      cell.querySelectorAll(".out").forEach((n) => n.remove());
      cur.className = "out";
      const nu = document.createElement("span");
      nu.className = "in";
      nu.textContent = ch;
      cell.appendChild(nu);
      setTimeout(() => { cur.remove(); nu.className = ""; }, 560);
    });
  }

  // The live weather facts the picture is built from (a preview can override them)
  _input() {
    if (this._override) return this._override;
    const st = this._hass.states, ws = st[this._config.weather], sun = st["sun.sun"], h = new Date().getHours();
    const a = (ws && ws.attributes) || {};
    return {
      cond: ws ? ws.state : "unavailable",
      temp: a.temperature != null ? Math.round(a.temperature) : null,
      night: sun ? sun.state === "below_horizon" : h < 7 || h >= 19,
      low: sun ? Number(sun.attributes.elevation) < 10 : false,
      wind: a.wind_speed != null ? Math.round(Number(a.wind_speed) / 5) * 5 : null,
      cover: a.cloud_coverage != null ? Math.round(Number(a.cloud_coverage) / 10) * 10 : null,
    };
  }

  _stats() {
    const c = this._config, st = this._hass.states;
    const cams = (c.cameras || []).map((x) => (x && typeof x === "object" ? x.entity : x)).filter(Boolean);
    return {
      indoor: st[c.indoor] && !isNaN(Number(st[c.indoor].state)) ? `${Number(st[c.indoor].state).toFixed(1)}°` : "–",
      lights: (c.lights || []).filter((e) => st[e] && st[e].state === "on").length,
      camsUp: cams.filter((e) => st[e] && !["unavailable", "unknown"].includes(st[e].state)).length,
      cams: cams.length,
      home: ghFeature("presence") && st[c.person] ? st[c.person].state === "home" : null,
      sun: c.sun_times && st["sun.sun"] ? [st["sun.sun"].attributes.next_rising, st["sun.sun"].attributes.next_setting] : null,
      clim: st[c.climate] ? [st[c.climate].state, st[c.climate].attributes.current_temperature, st[c.climate].attributes.hvac_action] : null,
      // names of the connections with an entity that is missing, unavailable or unknown (or off where off means down)
      down: c.connections ? c.connections.filter((k) => k.entities.some((e) => !st[e]
        || ["unavailable", "unknown"].includes(st[e].state) || (k.off_is_down && st[e].state === "off"))).map((k) => k.name) : null,
    };
  }

  // Weather beats generic day/night styling for rain, snow, fog and storms.
  _scene(w) {
    const c = w.cond, n = w.night;
    const layers = new Set();
    let sky, cloud = null, clouds = 0, bright = false;
    const storm = ["lightning", "lightning-rainy"].includes(c);
    const snow = ["snowy", "snowy-rainy"].includes(c);
    const rain = ["rainy", "pouring", "lightning-rainy", "hail", "snowy-rainy"].includes(c);
    if (storm) {
      sky = "storm"; cloud = CLOUD.storm; clouds = 4; layers.add("flash");
      if (rain) layers.add("rain");
    } else if (snow) {
      sky = n ? "night-snow" : "snow"; cloud = n ? CLOUD.night : CLOUD.snow; clouds = 3; bright = !n;
      layers.add("snow");
      if (rain) layers.add("rain");
    } else if (rain) {
      sky = n ? "night-rain" : "rain"; cloud = n ? CLOUD.night : CLOUD.rain; clouds = 4; layers.add("rain");
      if (c === "pouring" || c === "hail") layers.add("heavy");
    } else if (c === "fog") {
      sky = n ? "night-fog" : "fog"; layers.add("fog"); bright = !n;
      if (!n) layers.add("sunveil");
    } else if (c === "cloudy" || c === "exceptional") {
      sky = n ? "night-overcast" : "overcast"; cloud = n ? CLOUD.night : CLOUD.grey; clouds = 4;
    } else if (c === "partlycloudy" || c === "windy" || c === "windy-variant") {
      if (n) { sky = "night-cloudy"; cloud = CLOUD.night; clouds = 2; layers.add("moon"); layers.add("stars"); }
      else { sky = w.low ? "golden" : "partly"; cloud = CLOUD.day; clouds = 3; layers.add("sun"); bright = true; }
    } else if (c === "sunny" || c === "clear-night") {
      if (n) { sky = "night"; layers.add("moon"); layers.add("stars"); layers.add("stars2"); }
      else {
        sky = w.low ? "golden" : "sunny"; layers.add("sun"); layers.add("rays"); bright = true;
        // Soft white clouds only if the forecast actually reports some cloud
        if (w.cover != null && w.cover >= 15) { cloud = CLOUD.light; clouds = 1; }
      }
    } else {
      sky = n ? "night" : "none";
      if (n) layers.add("stars");
    }
    for (let i = 1; i <= clouds; i++) layers.add(`c${i}`);
    if (layers.has("sun") && w.low) layers.add("low");
    return { sky, cloud, layers, bright };
  }

  _render() {
    const c = this._config, w = this._input(), s = this._stats();
    const scene = this._scene(w);
    if (!this.shadowRoot) this._build();
    const r = this.shadowRoot, card = r.querySelector("ha-card");
    if (scene.sky !== this._skyName) {
      const first = this._skyName === undefined;
      this._skyName = scene.sky;
      const next = first ? 0 : 1 - this._front;
      this._layers[next].style.background = SKY[scene.sky];
      this._layers[next].classList.add("show");
      if (!first) this._layers[this._front].classList.remove("show");
      this._front = next;
    }
    for (const el of r.querySelectorAll(".fx [data-l]")) el.classList.toggle("show", scene.layers.has(el.dataset.l));
    card.classList.toggle("heavy", scene.layers.has("heavy"));
    card.classList.toggle("low", scene.layers.has("low"));
    card.classList.toggle("bright", scene.bright);
    if (scene.cloud) card.style.setProperty("--cloud", scene.cloud);
    // Real wind sets the cloud speed: calm drifts slowly, a breezy day moves faster
    const wf = w.wind == null ? 1 : Math.min(1.6, Math.max(0.45, 1.5 - w.wind / 40));
    // only on a real change: a new duration restarts the drift maths and the clouds jump
    if (card.style.getPropertyValue("--wf") !== wf.toFixed(2)) card.style.setProperty("--wf", wf.toFixed(2));
    const known = WEATHER_TEXT[w.cond];
    const icon = !known ? "mdi:weather-cloudy-alert" : (w.night && NIGHT_ICON[w.cond]) || WEATHER_ICON[w.cond];
    const label = !known ? (["unavailable", "unknown"].includes(w.cond) ? "Weather unavailable" : String(w.cond).replace(/[-_]/g, " ")) : (w.night && w.cond === "sunny" ? "Clear" : WEATHER_TEXT[w.cond]);
    r.querySelector(".wx ha-icon").setAttribute("icon", icon);
    r.querySelector(".wx .t").textContent = w.temp != null && known ? `${w.temp}°` : "–";
    r.querySelector(".wx .d").textContent = label;
    r.querySelector(".wx").style.display = c.weather && ghFeature("weather") ? "" : "none";
    const camTone = s.camsUp === s.cams ? STATUS.green : s.camsUp ? STATUS.amber : STATUS.red;
    const pill = (icon2, value, lbl, tone) => `<div class="pill"><ha-icon icon="${icon2}" style="color: rgb(${tone}); background: rgba(${tone},0.18)"></ha-icon>
      <div><div class="v">${value}</div><div class="k">${lbl}</div></div></div>`;
    const [cState, cTemp, cAction] = s.clim || [], heating = cAction === "heating", cOff = cState === "unavailable";
    const climPill = !ghFeature("climate") || (!s.clim && !c.indoor) ? "" : !s.clim ? pill("mdi:home-thermometer-outline", s.indoor, "Indoor", STATUS.amber)
      : pill(heating ? "mdi:fire" : "mdi:thermostat", cTemp != null ? `${Number(cTemp).toFixed(1)}°` : "–",
        cOff ? "Climate offline" : heating ? "Heating" : "Climate", heating ? STATUS.amber : cOff ? STATUS.red : STATUS.grey);
    // one connection down is named; more are counted
    const connPill = !s.down ? "" : pill(s.down.length ? "mdi:lan-disconnect" : "mdi:lan-check",
      !s.down.length ? "All OK" : s.down.length === 1 ? `${s.down[0]} down` : `${s.down.length} down`, "Connections", s.down.length ? STATUS.red : STATUS.green);
    // sun.sun gives the next sunrise and sunset, so after sunset both are tomorrow's
    const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString(GH_LOCALE, GH_HM) : "–");
    const sunPill = !s.sun ? "" : `<div class="pill sun2">
      <div class="ln"><ha-icon icon="mdi:weather-sunset-up" style="color:#ffd27a"></ha-icon>${hm(s.sun[0])}<small>Sunrise</small></div>
      <div class="ln"><ha-icon icon="mdi:weather-sunset-down" style="color:#ff9f6b"></ha-icon>${hm(s.sun[1])}<small>Sunset</small></div></div>`;
    const pills = climPill
      + (this._config.news === false
        ? (!ghFeature("lighting") || !(c.lights || []).length ? "" : pill("mdi:lightbulb-outline", `${s.lights} on`, s.lights === 1 ? "Light" : "Lights", s.lights ? STATUS.purple : STATUS.grey))
        : pill("mdi:newspaper-variant-outline", "News", "Headlines", STATUS.purple).replace('<div class="pill">', '<div class="pill news" role="button" tabindex="0" aria-label="Open the news">'))
      + sunPill + connPill
      + (!ghFeature("cctv") || !s.cams ? "" : pill("mdi:cctv", `${s.camsUp}/${s.cams} online`, "Cameras", camTone))
      // home/away only when the config names a person
      + (s.home === null ? "" : pill(s.home ? "mdi:home-account" : "mdi:account-arrow-right-outline", s.home ? "Home" : "Away", esc(this._config.person_name || ((this._hass.states[this._config.person] || {}).attributes || {}).friendly_name || "Presence"), s.home ? STATUS.green : STATUS.grey));
    const host = r.querySelector(".pills");
    if (host.innerHTML !== pills) host.innerHTML = pills;
    this._rainMsg();
    this._clock();
  }

  // Hourly forecast for the rain message (only with `rain_alert: true`). Home Assistant pushes a new
  // forecast whenever the weather integration updates and re-subscribes after a reconnect.
  _subscribeForecast() {
    if (!this._fcdSub && this._config.forecast !== false && this._hass && this._hass.connection && this._config.weather) {
      this._fcdSub = this._hass.connection.subscribeMessage((m) => { this._fcd = m.forecast || []; this._days(); this._wxRefresh(); },
        { type: "weather/subscribe_forecast", entity_id: this._config.weather, forecast_type: "daily" })
        .catch(() => { this._fcdSub = null; });
    }
    if (this._fcSub || !this._config.weather || (!this._config.rain_alert && this._config.forecast === false) || !this._hass || !this._hass.connection) return;
    this._fcSub = this._hass.connection.subscribeMessage((m) => { this._fc = m.forecast || []; this._rainMsg(); this._wxRefresh(); },
      { type: "weather/subscribe_forecast", entity_id: this._config.weather, forecast_type: "hourly" })
      .catch(() => { this._fcSub = null; });
  }

  // The next four days from the weather entity's own daily forecast; hidden when there is none
  _days() {
    const box = this.shadowRoot && this.shadowRoot.querySelector(".fc");
    if (!box) return;
    const start = new Date().setHours(0, 0, 0, 0);
    const days = (this._fcd || []).filter((f) => f.datetime && new Date(f.datetime).setHours(0, 0, 0, 0) > start)
      .slice(0, 4).filter((f) => Number.isFinite(Number(f.temperature)));
    if (!days.length) { box.hidden = true; box.innerHTML = ""; return; }
    const hi = (f) => Number(f.temperature), lo = (f) => (Number.isFinite(Number(f.templow)) ? Number(f.templow) : Number(f.temperature));
    const min = Math.min(...days.map(lo)), max = Math.max(...days.map(hi)), span = Math.max(1, max - min);
    const html = days.map((f) => {
      const d = new Date(f.datetime);
      const icon = WEATHER_ICON[f.condition] || "mdi:weather-cloudy-alert";
      const col = RAIN_CONDS.includes(f.condition) ? "#9cc8ff" : f.condition === "sunny" ? "#ffd27a" : f.condition === "partlycloudy" ? "#ffe3a3" : "#e6e3f2";
      const l = ((lo(f) - min) / span) * 100, w = Math.max(8, ((hi(f) - lo(f)) / span) * 100);
      const pp = Number(f.precipitation_probability), mm = Number(f.precipitation);
      const wet = Number.isFinite(pp) && pp >= 20 ? `${Math.round(pp)}% chance of rain` : Number.isFinite(mm) && mm >= 0.5 ? `${mm < 10 ? mm.toFixed(1) : Math.round(mm)} mm rain` : "";
      return `<div class="day" data-d="${wxKey(d)}" title="${WEATHER_TEXT[f.condition] || f.condition || ""}${wet ? ` · ${wet}` : ""}"><div class="dy">${d.toLocaleDateString(GH_LOCALE, { weekday: "short" })}</div>`
        + `<ha-icon icon="${icon}" style="color:${col}"></ha-icon><div class="tt">${Math.round(hi(f))}° <span>${Math.round(lo(f))}°</span></div>`
        + `<div class="rg"><i style="left:${Math.min(92, l).toFixed(0)}%;width:${Math.min(100 - Math.min(92, l), w).toFixed(0)}%"></i></div>`
        + "</div>";
    }).join("");
    if (box.innerHTML !== html) box.innerHTML = html;
    box.hidden = false;
  }

  // Shown only when an hour still to come today has rain in the forecast: "Rain expected from 15:00
  // until 18:00", "Rain now until 17:00", "Heavy rain …". Nothing at all when no rain is forecast.
  _rainMsg() {
    const box = this.shadowRoot && this.shadowRoot.querySelector(".rainmsg");
    if (!box) return;
    const now = new Date(), day = now.toDateString();
    const wet = (f) => Number(f.precipitation) >= 0.1 || RAIN_CONDS.includes(f.condition);
    const hrs = (this._fc || []).filter((f) => { const t = new Date(f.datetime); return t.toDateString() === day && t.getTime() + 3600e3 > now.getTime(); });
    const first = hrs.findIndex(wet);
    let text = "";
    if (first >= 0) {
      let last = first;
      while (last + 1 < hrs.length && wet(hrs[last + 1])) last++;
      const hm = (d) => d.toLocaleTimeString(GH_LOCALE, GH_HM);
      const start = new Date(hrs[first].datetime), end = new Date(new Date(hrs[last].datetime).getTime() + 3600e3);
      const heavy = hrs.slice(first, last + 1).some((f) => f.condition === "pouring" || Number(f.precipitation) >= 4);
      const what = heavy ? "Heavy rain" : "Rain";
      const until = end.toDateString() === day && last + 1 < hrs.length ? ` until ${hm(end)}` : " for the rest of the day";
      text = start <= now ? `${what} now${until}` : `${what} expected from ${hm(start)}${until}`;
      if (hrs.slice(last + 1).some(wet)) text += ", and again later";
    }
    box.hidden = !text;
    const span = box.querySelector("span");
    if (span.textContent !== text) span.textContent = text;
  }

  _build() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { position: relative; overflow: hidden; border-radius: 28px; border: 1px solid rgba(255,255,255,0.12); color: #fff;
          padding: 15px 22px 15px; background: #1e1546; isolation: isolate;
          box-shadow: 0 14px 36px rgba(20,10,50,0.45), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(255,255,255,0.06); --cloud: rgba(255,255,255,0.8); --wf: 1; }
        .sky { position: absolute; inset: 0; opacity: 0; transition: opacity 1.6s ease; }
        .sky.show { opacity: 1; }
        .fx { position: absolute; inset: 0; overflow: hidden; pointer-events: none; contain: layout paint; }
        /* moving layers get their own GPU layer before they start, so the tablet slides them rather than repainting */
        .fx .cl.show, .fx .rain.show, .fx .snow.show, .fx .fog.show, .fx .rays.show { will-change: transform; backface-visibility: hidden; }
        /* Every effect fades in and out; animations only run while shown */
        .fx [data-l] { position: absolute; opacity: 0; transition: opacity 1.6s ease; animation-play-state: paused !important; }
        .fx [data-l].show { opacity: 1; animation-play-state: running !important; }
        /* Layers the current weather does not use have no animation at all (not merely paused) */
        .fx [data-l]:not(.show) { animation: none !important; }
        :host([offscreen]) .fx [data-l], :host([wxopen]) .fx [data-l] { animation-play-state: paused !important; }

        /* Sun with a slow halo and turning rays; it sits lower and warmer at golden hour */
        .sun { width: 58px; height: 58px; left: 63%; top: 14%; border-radius: 50%;
          background: radial-gradient(circle at 42% 40%, #fffbe8 0%, #ffe39a 55%, #ffc65c 100%);
          box-shadow: 0 0 34px 10px rgba(255,214,120,0.55), 0 0 90px 30px rgba(255,190,100,0.25); animation: pulse 7s ease-in-out infinite alternate; }
        .rays { width: 300px; height: 300px; left: calc(63% + 29px - 150px); top: calc(14% + 29px - 150px);
          background: repeating-conic-gradient(rgba(255,236,190,0.16) 0 5deg, transparent 5deg 20deg);
          -webkit-mask-image: radial-gradient(circle, #000 18%, transparent 68%); mask-image: radial-gradient(circle, #000 18%, transparent 68%);
          animation: spin 90s linear infinite; }
        .low .sun { top: 46%; left: 66%; background: radial-gradient(circle at 42% 40%, #fff4e0 0%, #ffc07a 55%, #ff9a52 100%);
          box-shadow: 0 0 40px 14px rgba(255,160,90,0.55), 0 0 110px 40px rgba(255,130,80,0.25); }
        .low .rays { top: calc(46% + 29px - 150px); left: calc(66% + 29px - 150px); }
        .sunveil { width: 70px; height: 70px; left: 64%; top: 16%; border-radius: 50%; background: radial-gradient(circle, rgba(255,250,235,0.55), rgba(255,250,235,0) 70%); }

        /* Moon and two star fields twinkling out of step */
        .moon { width: 44px; height: 44px; left: 64%; top: 16%; border-radius: 50%;
          background: radial-gradient(circle at 36% 34%, #fffef6 0%, #ebe6f7 55%, #c9c1e4 100%);
          box-shadow: 0 0 26px 6px rgba(215,205,255,0.35), 0 0 80px 26px rgba(160,150,255,0.15); animation: float 12s ease-in-out infinite alternate; }
        .moon::before { content: ""; position: absolute; width: 9px; height: 9px; left: 22px; top: 12px; border-radius: 50%; background: rgba(170,160,200,0.35); box-shadow: -10px 12px 0 -1px rgba(170,160,200,0.3), 4px 20px 0 -2px rgba(170,160,200,0.25); }
        /* Twinkle lives on a pseudo-element so it never fights the layer's own fade in/out */
        .stars, .stars2 { inset: 0; }
        .stars::before, .stars2::before { content: ""; position: absolute; inset: 0; background-size: cover; background-position: center top; }
        .stars::before { background-image: ${STARS_A}; animation: twinkle 4.5s ease-in-out infinite alternate; }
        .stars2::before { background-image: ${STARS_B}; animation: twinkle 6s ease-in-out -3s infinite alternate; }
        .stars:not(.show)::before, .stars2:not(.show)::before { animation: none; }
        :host([offscreen]) .stars::before, :host([offscreen]) .stars2::before, :host([wxopen]) .stars::before, :host([wxopen]) .stars2::before { animation-play-state: paused; }

        /* Clouds: soft overlapping ellipses drifting across; speed follows the wind */
        .cl { width: 280px; height: 96px; left: 0;
          background: radial-gradient(ellipse 36% 48% at 30% 62%, var(--cloud) 0 58%, transparent 72%),
            radial-gradient(ellipse 30% 56% at 52% 44%, var(--cloud) 0 58%, transparent 72%),
            radial-gradient(ellipse 32% 42% at 73% 62%, var(--cloud) 0 58%, transparent 72%),
            radial-gradient(ellipse 52% 30% at 50% 76%, var(--cloud) 0 62%, transparent 76%);
          animation: drift calc(60s * var(--wf)) linear infinite; }
        .cl[data-l="c1"] { top: 2%; animation-delay: calc(-15s * var(--wf)); }
        .cl[data-l="c2"] { top: 26%; transform: scale(0.75); animation-duration: calc(75s * var(--wf)); animation-delay: calc(-48s * var(--wf)); }
        .cl[data-l="c3"] { top: 44%; animation-duration: calc(90s * var(--wf)); animation-delay: calc(-25s * var(--wf)); }
        .cl[data-l="c4"] { top: -6%; width: 360px; height: 120px; animation-duration: calc(68s * var(--wf)); animation-delay: calc(-35s * var(--wf)); }

        /* Rain: two depths of falling streaks, tilted by the wind; heavy rain is faster and denser */
        .rain { left: -20%; right: -20%; top: -140px; height: calc(100% + 280px); background-image: ${RAIN_TILE}; background-size: 140px 140px;
          animation: fall 0.75s linear infinite; }
        .rain.r2 { background-size: 210px 210px; opacity: 0; animation: fall2 1.2s linear infinite; }
        .rain.r2.show { opacity: 0.55; }
        .heavy .rain { animation-duration: 0.45s; }
        .heavy .rain.r2 { animation-duration: 0.7s; }
        .heavy .rain.r2.show { opacity: 0.9; }
        .rainwrap { position: absolute; inset: 0; transform: rotate(11deg) scale(1.15); }

        /* Snow drifting down in two layers */
        .snow { left: -10%; right: -10%; top: -160px; height: calc(100% + 320px); background-image: ${SNOW_TILE}; background-size: 160px 160px;
          animation: snow 10s linear infinite; }
        .snow.n2 { background-size: 240px 240px; animation: snow2 16s linear infinite; }
        .snow.n2.show { opacity: 0.7; }

        /* Fog banks sliding slowly */
        .fog { left: -50%; width: 200%; height: 70%; bottom: -10%;
          background: radial-gradient(ellipse 30% 60% at 25% 60%, rgba(225,228,238,0.42), transparent 70%),
            radial-gradient(ellipse 35% 50% at 65% 55%, rgba(225,228,238,0.36), transparent 70%),
            radial-gradient(ellipse 25% 45% at 90% 65%, rgba(225,228,238,0.32), transparent 70%);
          animation: mist 38s ease-in-out infinite alternate; }
        .fog.f2 { top: -5%; bottom: auto; height: 60%; animation-duration: 52s; animation-direction: alternate-reverse; }
        .fog.f2.show { opacity: 0.75; }

        /* Lightning: a rare double flash with a bolt */
        .flash { inset: 0; background: radial-gradient(80% 90% at 30% 0%, rgba(230,225,255,0.85), rgba(200,190,255,0.25) 60%, transparent 85%);
          animation: flash 9s linear infinite; }
        .flash svg { position: absolute; left: 24%; top: 0; width: 46px; height: 120px; }

        .shade { position: absolute; inset: 0; transition: background 1.6s ease;
          background: linear-gradient(90deg, rgba(8,6,24,0.40) 0%, rgba(8,6,24,0.12) 55%, rgba(8,6,24,0.04) 100%),
            linear-gradient(180deg, rgba(8,6,24,0) 45%, rgba(8,6,24,0.40) 100%); }
        .bright .shade { background: linear-gradient(90deg, rgba(10,8,34,0.48) 0%, rgba(10,8,34,0.18) 55%, rgba(10,8,34,0.08) 100%),
            linear-gradient(180deg, rgba(10,8,34,0) 40%, rgba(10,8,34,0.48) 100%); }
        .in { position: relative; text-shadow: 0 1px 14px rgba(0,0,0,0.35); container-type: inline-size; }
        .hello { font-size: 15px; font-weight: 500; color: rgba(255,255,255,0.76); letter-spacing: 0.2px; }
        .row { display: flex; align-items: center; gap: 18px; margin-top: 2px; }
        /* The hero's height is budgeted: the homepage must fit the wall tablet on one screen, so the clock's
           size is paid for by tighter padding and gaps (the hero is no taller than with the old 72px clock).
           The clock is the centrepiece: large light Space Grotesk, white with a faint lavender tint and glow,
           and a soft pool of purple light behind it so the moving sky never washes it out */
        .time { position: relative; isolation: isolate; display: flex; width: -moz-fit-content; width: fit-content; white-space: nowrap;
          font-family: "Space Grotesk", "Sora", "Inter", var(--ha-font-family-heading, -apple-system, "SF Pro Display", Roboto, "Segoe UI"), sans-serif;
          font-size: 108px; font-weight: 300; letter-spacing: -0.02em; line-height: 0.86; color: #f7f3ff; margin: 2px 0 0 -0.03em;
          font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1;
          text-shadow: 0 0 34px rgba(167,139,250,0.42), 0 2px 16px rgba(10,6,30,0.50); }
        .time::before { content: ""; position: absolute; z-index: -1; inset: -20% -13% -16% -13%; border-radius: 50%; pointer-events: none;
          background: radial-gradient(closest-side, rgba(139,92,246,0.36), rgba(139,92,246,0.13) 58%, transparent 100%); }
        .dg { display: inline-grid; } .dg > span { grid-area: 1 / 1; }
        .dg.sep > span { opacity: 0.84; transform: translateY(-0.045em); }
        .dg .out { animation: clk-out 0.5s cubic-bezier(0.3, 0, 0.2, 1) forwards; }
        .dg .in { animation: clk-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
        @keyframes clk-out { to { opacity: 0; transform: translateY(-0.24em); } }
        @keyframes clk-in { from { opacity: 0; transform: translateY(0.24em); } }
        @media (prefers-reduced-motion: reduce) { .dg .out { display: none; } .dg .in { animation: none; } }
        /* phones draw the hero wider and scale it down, so the clock is set larger there to read big on screen;
           this is as large as fits beside the forecast strip */
        @media (max-width: 600px) { .time { font-size: 126px; } }
        /* Icon beside the temperature, description under both; kept clear of the edit pencil above */
        .wx { position: absolute; top: 0; right: 0; text-align: right; display: grid; grid-template-columns: 1fr auto auto; align-items: center; column-gap: 8px; }
        /* the weather icon always sits right beside the temperature, however wide the forecast below is */
        .wx > ha-icon { grid-column: 2; } .wx > .t { grid-column: 3; }
        .hello { padding-right: 150px; }
        /* Next days: day, icon, high / low and a small bar showing each day's range against the whole week */
        .fc { grid-column: 1 / -1; justify-self: end; display: grid; grid-auto-flow: column; grid-auto-columns: 46px; gap: 2px; margin-top: 6px; padding: 5px 5px 6px;
          border-radius: 14px; background: linear-gradient(155deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 60%), rgba(12,10,32,0.40); border: 1px solid rgba(255,255,255,0.16);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 4px 14px rgba(6,3,20,0.18); text-shadow: none; text-align: center; line-height: 1.1; }
        /* no backdrop blur here: the sky moves behind the strip, so a blur would be redrawn every frame and the
           wall tablet's GPU (Galaxy Tab A) drops frames on the whole scene; a slightly denser fill instead */
        .fc[hidden] { display: none; }
        @container (max-width: 470px) {
          .time { font-size: 54px; letter-spacing: -2px; }
          .fc > :nth-child(n+4) { display: none; }
          .hello { font-size: 16px; padding-right: 120px; }
          .wx .d { display: none; } .fc { margin-top: 4px; }
          .row { min-height: 104px; align-items: flex-end; }
        }
        @container (max-width: 296px) { .fc { display: none; } }
        .fc .dy { font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px; color: rgba(255,255,255,0.82); text-transform: uppercase; }
        .wx .fc ha-icon { --mdc-icon-size: 19px; width: 19px; height: 19px; margin: 2px auto 1px; display: block; filter: none; }
        .fc .tt { font-size: 12px; font-weight: 700; white-space: nowrap; } .fc .tt span { font-weight: 500; color: rgba(255,255,255,0.62); }
        .fc .rg { position: relative; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.12); margin: 4px 4px 0; }
        .fc .rg i { position: absolute; top: 0; bottom: 0; border-radius: 2px; background: linear-gradient(90deg, #7cc8ff, #ffd27a); }
        .wx ha-icon { --mdc-icon-size: 44px; display: block; width: 44px; height: 44px; color: #fff; filter: drop-shadow(0 2px 10px rgba(0,0,0,0.3)); }
        .wx .t { font-size: 34px; font-weight: 600; line-height: 1; }
        .wx .d { grid-column: 1 / -1; margin-top: 4px; }
        /* the weather opens the detailed forecast */
        .wx { cursor: pointer; -webkit-tap-highlight-color: transparent; border-radius: 16px; outline: none; }
        .wx:focus-visible { box-shadow: 0 0 0 2px rgba(190,160,255,0.8); }
        .wx .fc { transition: transform 0.12s ease, background 0.12s ease; }
        .wx:active .fc { transform: scale(0.97); background: rgba(12,10,32,0.42); }
        /* Rain warning: only present when the forecast has rain for the rest of today */
        .rainmsg { display: flex; align-items: center; gap: 8px; margin-top: 9px; padding: 8px 12px; border-radius: 14px; width: fit-content; max-width: 100%; box-sizing: border-box;
          background: rgba(56,140,255,0.22); border: 1px solid rgba(120,180,255,0.45); font-size: 15px; font-weight: 600; text-shadow: none; }
        .rainmsg[hidden] { display: none; }
        .rainmsg ha-icon { --mdc-icon-size: 20px; color: #9cc8ff; flex: none; }
        /* Sunrise and sunset share one pill, each with its own small icon */
        .pill.sun2 { gap: 0; flex-direction: column; align-items: stretch; justify-content: center; padding: 6px 12px; }
        .sun2 .ln { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; line-height: 1.25; }
        .sun2 .ln ha-icon { --mdc-icon-size: 18px; width: 18px; height: 18px; border-radius: 0; background: none !important; }
        .sun2 .ln small { font-size: 12px; font-weight: 400; color: rgba(255,255,255,0.78); margin-left: auto; }
        .wx .d { font-size: 14px; color: rgba(255,255,255,0.88); }
        .date { font-size: 16px; font-weight: 500; letter-spacing: 0.2px; color: rgba(255,255,255,0.86); margin-top: 6px; }
        .pills { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 8px; margin-top: 10px; text-shadow: none; }
        .pill { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 18px; min-width: 0;
          background: linear-gradient(155deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 55%, rgba(255,255,255,0.04) 100%), rgba(12,10,32,0.30);
          border: 1px solid rgba(255,255,255,0.16); box-shadow: inset 0 1px 0 rgba(255,255,255,0.16), 0 4px 14px rgba(6,3,20,0.18); }
        .pill ha-icon { --mdc-icon-size: 20px; width: 34px; height: 34px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
        .pill .v { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pill .k { font-size: 12px; color: rgba(255,255,255,0.78); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pill > div { min-width: 0; }
        .pill.news { cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; transition: background 0.2s ease; }
        .pill.news:active { transform: scale(0.97); background: rgba(139,92,246,0.35); }
        ${NARROW_CSS_HERO}

        @keyframes pulse { from { transform: scale(1); } to { transform: scale(1.06); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes float { from { transform: translateY(0); } to { transform: translateY(-4px); } }
        @keyframes twinkle { from { opacity: 1; } to { opacity: 0.35; } }
        @keyframes drift { from { transform: translate3d(-110%, 0, 0); } to { transform: translate3d(330%, 0, 0); } }
        @keyframes fall { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(0, 140px, 0); } }
        @keyframes fall2 { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(0, 210px, 0); } }
        @keyframes snow { 0% { transform: translate3d(0, 0, 0); } 50% { transform: translate3d(-14px, 80px, 0); } 100% { transform: translate3d(0, 160px, 0); } }
        @keyframes snow2 { 0% { transform: translate3d(0, 0, 0); } 50% { transform: translate3d(18px, 120px, 0); } 100% { transform: translate3d(0, 240px, 0); } }
        @keyframes mist { from { transform: translate3d(0, 0, 0); } to { transform: translate3d(-22%, 0, 0); } }
        @keyframes flash { 0%, 86%, 100% { opacity: 0; } 87% { opacity: 0.9; } 88% { opacity: 0.1; } 90% { opacity: 0.7; } 93% { opacity: 0; } }
        /* Drifting clouds need their scale kept, so the scaled one animates its own copy of drift */
        .cl[data-l="c2"] { animation-name: drift-s; }
        @keyframes drift-s { from { transform: translate3d(-110%, 0, 0) scale(0.75); } to { transform: translate3d(330%, 0, 0) scale(0.75); } }
        /* The flash layer is visible only during its keyframes, so "show" must not force it to full opacity */
        .fx > .flash.show { opacity: 0; }
        .fx > .flash:not(.show) { animation: none !important; }

        /* Reduced motion (Android's "Remove animations" and power saving ask for it) stops everything
           except the slow cloud drift, which the user wants to see */
        @media (prefers-reduced-motion: reduce) {
          .fx [data-l]:not(.cl), .fx [data-l].show:not(.cl), .rainwrap > *, .stars::before, .stars2::before { animation: none !important; }
          .fx > .flash.show { opacity: 0; }
        }
      </style>
      <ha-card>
        <div class="sky"></div><div class="sky"></div>
        <div class="fx">
          <div data-l="rays" class="rays"></div><div data-l="sun" class="sun"></div><div data-l="sunveil" class="sunveil"></div>
          <div data-l="stars" class="stars"></div><div data-l="stars2" class="stars2"></div><div data-l="moon" class="moon"></div>
          <div data-l="c4" class="cl"></div><div data-l="c1" class="cl"></div><div data-l="c2" class="cl"></div><div data-l="c3" class="cl"></div>
          <div data-l="fog" class="fog f2"></div><div data-l="fog" class="fog"></div>
          <div data-l="snow" class="snow n2"></div><div data-l="snow" class="snow"></div>
          <div data-l="flash" class="flash"><svg viewBox="0 0 46 120"><path d="M28 0 L10 58 L22 58 L14 120 L38 46 L25 46 L34 0 Z" fill="rgba(255,255,255,0.9)"/></svg></div>
        </div>
        <div class="fx rainfx"><div class="rainwrap">
          <div data-l="rain" class="rain r2"></div><div data-l="rain" class="rain"></div>
        </div></div>
        <div class="shade"></div>
        <div class="in"><div class="hello"></div>
          <div class="row"><div><div class="time" role="img"></div><div class="date"></div></div>
            <div class="wx" role="button" tabindex="0" aria-label="Open the detailed weather forecast"><ha-icon></ha-icon><div class="t"></div><div class="d"></div><div class="fc" hidden></div></div></div>
          <div class="rainmsg" hidden><ha-icon icon="mdi:umbrella-outline"></ha-icon><span></span></div>
          <div class="pills"></div></div>
      </ha-card>`;
    this._layers = [...this.shadowRoot.querySelectorAll(".sky")];
    this._front = 0;
    // the News pill opens the news page (the only way in)
    const pillHost = this.shadowRoot.querySelector(".pills");
    const openNews = (e) => {
      if (!e.composedPath().some((n) => n.classList && n.classList.contains("news"))) return;
      if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      wnavGo(`${ghBase()}/news`);
    };
    pillHost.addEventListener("click", openNews);
    pillHost.addEventListener("keydown", openNews);
    // the weather (temperature or the next-days strip) opens the detailed forecast, on the day tapped
    const wx = this.shadowRoot.querySelector(".wx");
    const openWx = (e) => {
      if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
      if (!this._config.weather) return;
      e.preventDefault();
      e.stopPropagation();
      const day = e.composedPath().find((n) => n.dataset && n.dataset.d);
      this._wxSheetEl = wxSheet();
      this._wxSheetEl.show(this, day ? day.dataset.d : null);
    };
    wx.addEventListener("click", openWx);
    wx.addEventListener("keydown", openWx);
  }
}

/*
 * Glass Home Chip card: a small glass status tile with a round tinted icon, name and live status.
 * The colour follows the state (green connected/secure, purple active, amber heating, grey idle,
 * red only for real problems). Tap runs tap_action (default: more-info).
 *
 *   type: custom:glasshome-chip-card
 *   kind: climate | heater | laundry | presence | hub | cameras | camera | weather | value
 *   entity: climate.living_room
 *   switch: switch.example_heater    # heater only
 *   machine / completion / finished  # laundry only: machine state, finish time, input_boolean.laundry_finished
 *   entities: [camera.a, camera.b]   # cameras only
 *   name: Climate
 *   icon: mdi:thermostat
 *   tap_action: {action: navigate, navigation_path: ...}
 */
// Narrow: the second status line (e.g. "Not heating · Schedule") wraps onto two lines instead of
// being cut short; a chip that narrow sits in a row already that tall
const NARROW_CSS_CHIP = `
  :host { container-type: inline-size; }
  @container (max-width: 200px) {
    .s2 { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  }`;

class GlassHomeChipCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    this._config = config;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", () => {
        const c = this._config;
        this.dispatchEvent(new CustomEvent("hass-action", { bubbles: true, composed: true,
          detail: { config: { entity: c.entity, tap_action: c.tap_action || { action: "more-info" } }, action: "tap" } }));
      });
    }
  }

  set hass(hass) {
    this._hass = hass;
    const c = this._config, ids = [c.entity, c.switch, c.control, c.machine, c.completion, c.finished, ...(c.entities || []), ...(c.kwh || [])].filter(Boolean);
    const key = ids.map((e) => hass.states[e] && JSON.stringify([hass.states[e].state, hass.states[e].attributes.current_temperature,
      hass.states[e].attributes.hvac_action, hass.states[e].attributes.preset_mode, hass.states[e].attributes.temperature])).join()
      // the laundry chip counts down the minutes left
      + (c.kind === "laundry" ? Math.floor(Date.now() / 60000) : "");
    if (key !== this._key) {
      this._key = key;
      this._render();
    }
  }

  getCardSize() {
    return 1;
  }

  // Returns [status text, tone]
  _status() {
    const c = this._config, st = this._hass.states, s = st[c.entity];
    const bad = (x) => !x || ["unavailable", "unknown"].includes(x.state);
    if (c.kind !== "cameras" && bad(s)) return ["Unavailable", STATUS.red];
    const nice = (v) => String(v).replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase());
    switch (c.kind) {
      case "climate": {
        // Current → target on the first line; heating activity and mode underneath
        const a = s.attributes, cur = a.current_temperature != null ? `${a.current_temperature}°` : "–";
        const temps = a.temperature != null && s.state !== "off" ? `${cur} → ${a.temperature}°` : cur;
        const ctl = c.control && st[c.control];
        const mode = a.preset_mode === "boost" ? "Boost" : s.state === "off" ? "Off" : ctl && ctl.state === "on" ? "Schedule"
          : s.state === "heat" ? "Manual" : s.state === "auto" ? "Hive schedule" : nice(s.state);
        const heating = a.hvac_action === "heating";
        return [temps, heating || a.preset_mode === "boost" ? STATUS.amber : s.state === "off" ? STATUS.grey : STATUS.purple, `${heating ? "Heating" : "Not heating"} · ${mode}`];
      }
      case "heater": {
        const w = Number(s.state), sw = c.switch && st[c.switch];
        const watts = isNaN(w) ? "" : ` · ${Math.round(w * 10) / 10} W`;
        if (w > 1) return [`Heating${watts}`, STATUS.amber];
        if (sw && sw.state === "on") return [`On${watts}`, STATUS.purple];
        return [`Off${watts}`, STATUS.grey];
      }
      case "laundry": {
        // entity: job state; optional machine, completion (finish time) and finished (input_boolean kept by the automations)
        const v = (e) => (e && st[e] ? st[e].state : "");
        const end = Date.parse(v(c.completion)), left = isNaN(end) ? null : Math.max(0, Math.round((end - Date.now()) / 60000));
        if (v(c.machine) === "pause") return ["Paused", STATUS.amber, WASH_STAGE[s.state] || nice(s.state)];
        if (v(c.machine) === "run" || washActive(s.state)) {
          return [WASH_STAGE[s.state] || nice(s.state), STATUS.purple, left != null ? `${left} min left · done ${washHM(end)}` : "Wash in progress"];
        }
        if (v(c.finished) === "on") return ["Finished", STATUS.green, "Ready to unload"];
        return ["Ready", STATUS.grey];
      }
      case "presence":
        return s.state === "home" ? ["Home", STATUS.green] : [s.state === "not_home" ? "Away" : nice(s.state), STATUS.grey];
      case "hub":
        return s.state === "on" ? ["Connected", STATUS.green] : ["Offline", STATUS.red];
      case "cameras": {
        const all = c.entities || [c.entity], up = all.filter((e) => !bad(st[e])).length;
        return [`${up}/${all.length} online`, up === all.length ? STATUS.green : up ? STATUS.amber : STATUS.red];
      }
      case "camera":
        return ["Online", STATUS.green];
      case "weather": {
        const t = s.attributes.temperature;
        return [`${WEATHER_TEXT[s.state] || nice(s.state)}${t != null ? ` · ${Math.round(t)}°` : ""}`, STATUS.purple];
      }
      case "energy": {
        // Home Mini live watts, then today's estimated costs (entities: electricity cost, gas cost)
        const [ec, gc] = (c.entities || []).map((e) => (bad(st[e]) ? null : Number(st[e].state)));
        const gbp = (n) => ghMoney(n);
        const tot = ec == null && gc == null ? null : (ec || 0) + (gc || 0);
        if (tot == null) {
          const [ek, gk] = (c.kwh || []).map((e) => (!e || bad(st[e]) || isNaN(Number(st[e].state)) ? null : Number(st[e].state)));
          const kw = (n) => (n == null ? "–" : `${Math.round(n * 10) / 10} kWh`);
          const live = isNaN(Number(s.state)) ? "–" : `${Math.round(Number(s.state)).toLocaleString(GH_LOCALE)} W now`;
          if (ek != null || gk != null) return [`${live} · ${kw(ek)} today`, STATUS.purple, gk == null ? "Electricity used today" : `Electricity ${kw(ek)} · Gas ${kw(gk)}`];
          return [live, STATUS.purple, "Live use"];
        }
        return [`${Math.round(Number(s.state)).toLocaleString("en-GB")} W now · ${gbp(tot)} today`, STATUS.purple,
          `Electricity ${gbp(ec)} · Gas ${gbp(gc)} · estimated`];
      }
      case "value": {
        const n = Number(s.state), u = s.attributes.unit_of_measurement;
        return [`${isNaN(n) ? nice(s.state) : Math.round(n * 10) / 10}${u ? ` ${u}` : ""}`, STATUS.grey];
      }
      default:
        return [nice(s.state), STATUS.grey];
    }
  }

  _render() {
    const c = this._config, [text, tone, sub] = this._status();
    const big = c.kind === "camera";
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        ha-card { box-sizing: border-box; height: 100%; min-height: ${big ? 78 : 66}px; display: flex; align-items: center; gap: 11px;
          padding: 10px 12px; border-radius: 22px; background: ${GLASS_BG}; border: ${GLASS_BORDER}; box-shadow: ${GLASS_EDGE};
          color: #fff; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; }
        ha-card:active { transform: scale(0.97); }
        ha-icon { --mdc-icon-size: 22px; width: 42px; height: 42px; flex: none; border-radius: 50%; display: flex; align-items: center;
          justify-content: center; color: rgb(${tone}); background: rgba(${tone},0.15); box-shadow: 0 0 14px rgba(${tone},0.18); }
        .t { min-width: 0; }
        .n { font-size: 15.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s { font-size: 13px; color: ${tone === STATUS.grey ? "#8e8aa0" : `rgb(${tone})`}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
        .s2 { font-size: 12.5px; color: #a29db8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
        ${NARROW_CSS_CHIP}
      </style>
      <ha-card role="button" aria-label="${c.name || ""}: ${text}${sub ? `, ${sub}` : ""}"><ha-icon icon="${c.icon || "mdi:circle-outline"}"></ha-icon>
        <div class="t"><div class="n">${c.name || ""}</div><div class="s">${text}</div>${sub ? `<div class="s2">${sub}</div>` : ""}</div></ha-card>`;
  }
}

/*
 * Glass Home Laundry card: the Laundry page's live washing machine panel (Samsung, SmartThings).
 * "Running" comes from the machine state OR an active wash stage: SmartThings sometimes leaves the
 * machine state on "stop" for a whole cycle while the stage and finish time keep updating.
 * The machine switches itself off the moment a wash finishes, so "Finished" is kept by Home
 * Assistant (input_boolean, set by the "Laundry: wash finished" automation) until the next wash
 * starts or someone taps Unloaded. The wash's start time and meter readings at the start come from
 * input_text.laundry_current_cycle (written by "Laundry: wash started"); this wash's energy and
 * water are the meters now minus those readings. Progress is an estimate from the start to the
 * machine's own finish time. SmartThings does not report the programme name for this model.
 *
 *   type: custom:glasshome-laundry-card
 *   machine: sensor.x_machine_state      job: sensor.x_job_state      completion: sensor.x_completion_time
 *   energy: sensor.x_energy              water: sensor.x_water_consumption
 *   temperature: select.x_water_temperature   spin: select.x_spin_level   rinses: number.x_rinse_cycles
 *   power: binary_sensor.x_power
 *   current: input_text.laundry_current_cycle   finished: input_boolean.laundry_finished
 *   logs: [input_text.laundry_wash_log_1, ...]  # newest first, for the last finish time
 */
const WASH_STAGE = { none: "Ready", weight_sensing: "Weighing the load", pre_wash: "Pre-wash", wash: "Washing", ai_wash: "AI wash",
  rinse: "Rinsing", ai_rinse: "AI rinse", spin: "Spinning", ai_spin: "AI spin", drying: "Drying", air_wash: "Air wash", cooling: "Cooling",
  delay_wash: "Delayed start", wrinkle_prevent: "Wrinkle prevention", freeze_protection: "Freeze protection", finish: "Finished" };
const WASH_STEPS = [["weight_sensing", "Weigh"], ["wash", "Wash"], ["rinse", "Rinse"], ["spin", "Spin"], ["finish", "Done"]];
const WASH_STEP_OF = { weight_sensing: 0, pre_wash: 1, wash: 1, ai_wash: 1, air_wash: 1, rinse: 2, ai_rinse: 2, spin: 3, ai_spin: 3, drying: 3, cooling: 3, wrinkle_prevent: 4, finish: 4 };
const WASH_BAD = ["none", "unknown", "unavailable", "", "-"];
const washActive = (js) => !!js && !["none", "finish", "unavailable", "unknown"].includes(js);
const washTemp = (t) => (WASH_BAD.includes(t) || t == null ? "–" : t === "cold" ? "Cold" : `${t}°C`);
const washSpin = (s) => (WASH_BAD.includes(s) || s == null ? "–" : { rinse_hold: "Rinse hold", no_spin: "No spin" }[s] || `${s} rpm`);
const washDur = (m) => (m == null ? "–" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`);
const washHM = (ms) => new Date(ms).toLocaleTimeString(GH_LOCALE, GH_HM);
const washNum = (v) => { const n = Number(v); return v !== "" && v != null && v !== "-" && Number.isFinite(n) ? n : null; };

// The wash in progress, from input_text.laundry_current_cycle: "start|kWh|L|temp|spin|rinses|bubble"
function washCurrent(hass, id) {
  const s = id && hass.states[id] ? hass.states[id].state : "";
  const p = s.split("|");
  if (p.length !== 7 || !washNum(p[0])) return null;
  return { start: Number(p[0]) * 1000, e0: washNum(p[1]), w0: washNum(p[2]), temp: p[3], spin: p[4], rinse: p[5], bubble: p[6] === "1" };
}

// Logged washes, newest first: "start,minutes,temp,spin,rinses,bubble,kWh,L,f|x" separated by ";"
function washLog(hass, ids) {
  const out = [];
  for (const id of ids || []) {
    const s = hass.states[id] ? hass.states[id].state : "";
    for (const r of s.split(";")) {
      const p = r.split(",");
      if (p.length !== 9 || !washNum(p[0])) continue;
      const start = Number(p[0]) * 1000, mins = washNum(p[1]);
      out.push({ start, mins, end: start + (mins || 0) * 60000, temp: p[2], spin: p[3], rinse: washNum(p[4]), bubble: p[5] === "1",
        kwh: washNum(p[6]), litres: washNum(p[7]), done: p[8] === "f" });
    }
  }
  return out.sort((a, b) => b.start - a.start);
}

class GlassHomeLaundryCard extends HTMLElement {
  setConfig(config) {
    if (!config.job || !config.machine) throw new Error("machine and job are required");
    this._config = config;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]");
        if (b && b.dataset.act === "unloaded" && this._config.finished) {
          this._hass.callService("input_boolean", "turn_off", { entity_id: this._config.finished });
        }
      });
    }
  }

  set hass(hass) {
    this._hass = hass;
    const c = this._config, v = (e) => (e && hass.states[e] ? hass.states[e].state : "");
    const key = JSON.stringify([c.machine, c.job, c.completion, c.energy, c.water, c.temperature, c.spin, c.rinses, c.power, c.current, c.finished,
      ...(c.logs || [])].map(v));
    if (key === this._key) return;
    this._key = key;
    this._render();
  }

  connectedCallback() {
    // Remaining time and progress move on by themselves; refresh them twice a minute
    clearInterval(this._timer);
    this._timer = setInterval(() => { if (this._hass) this._render(); }, 30000);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
  }

  getCardSize() {
    return 4;
  }

  _render() {
    const c = this._config, st = this._hass.states, s = (e) => e && st[e];
    const ms = s(c.machine) ? st[c.machine].state : "unavailable", js = s(c.job) ? st[c.job].state : "unavailable";
    const now = Date.now(), cyc = washCurrent(this._hass, c.current);
    const endT = s(c.completion) ? Date.parse(st[c.completion].state) : NaN;
    const num = (e) => (s(e) ? washNum(st[e].state) : null);
    const offline = ["unavailable", "unknown"].includes(js) && ["unavailable", "unknown"].includes(ms);
    const paused = !offline && ms === "pause";
    const running = !offline && !paused && (ms === "run" || washActive(js));
    const last = washLog(this._hass, c.logs)[0];
    const finished = !offline && !running && !paused && s(c.finished) && st[c.finished].state === "on";
    const powered = s(c.power) && st[c.power].state === "on";
    let title, sub, tone, icon = "mdi:washing-machine";
    if (offline) { title = "Unavailable"; sub = "SmartThings is not sending the washing machine's status"; tone = STATUS.red; icon = "mdi:washing-machine-alert"; }
    else if (paused) { title = "Paused"; sub = `${WASH_STAGE[js] || nice(js)}${cyc ? ` · started ${washHM(cyc.start)}` : ""}`; tone = STATUS.amber; icon = "mdi:pause-circle-outline"; }
    else if (running) { title = WASH_STAGE[js] || nice(js); sub = cyc ? `Started ${washHM(cyc.start)}` : "Wash in progress"; tone = STATUS.purple; }
    else if (finished) { title = "Finished"; sub = `${last && last.done ? `Done at ${washHM(last.end)} · ` : ""}ready to unload`; tone = STATUS.green; icon = "mdi:check-circle-outline"; }
    else if (powered) { title = "Ready"; sub = "Machine on · choose a programme on the washer"; tone = STATUS.purple; }
    else { title = "Off"; sub = last ? `Last wash ${new Date(last.start).toLocaleDateString(GH_LOCALE, { weekday: "short", day: "numeric", month: "short" })} at ${washHM(last.end)}` : "No wash running"; tone = STATUS.grey; icon = "mdi:washing-machine-off"; }

    const active = running || paused;
    // The finish time is only meaningful during a wash (when idle SmartThings leaves a stale value)
    const left = active && !isNaN(endT) ? Math.max(0, Math.round((endT - now) / 60000)) : null;
    const pct = active && cyc && !isNaN(endT) && endT > cyc.start ? Math.max(0, Math.min(99, Math.round(((now - cyc.start) / (endT - cyc.start)) * 100))) : null;
    const step = active ? WASH_STEP_OF[js] : finished ? 4 : -1;
    const chips = [];
    if (active && cyc) {
      const eNow = num(c.energy), wNow = num(c.water);
      if (eNow != null && cyc.e0 != null) chips.push(["mdi:lightning-bolt", `${(Math.max(0, eNow - cyc.e0)).toFixed(1)} kWh`, "Energy so far"]);
      if (wNow != null && cyc.w0 != null) chips.push(["mdi:water", `${Math.round(Math.max(0, wNow - cyc.w0))} L`, "Water so far"]);
      chips.push(["mdi:timer-sand", washDur(Math.round((now - cyc.start) / 60000)), "Running for"]);
    } else if (finished && last && last.done) {
      if (last.kwh != null) chips.push(["mdi:lightning-bolt", `${last.kwh.toFixed(1)} kWh`, "Energy"]);
      if (last.litres != null) chips.push(["mdi:water", `${Math.round(last.litres)} L`, "Water"]);
      chips.push(["mdi:timer-sand", washDur(last.mins), "Took"]);
    }
    if (active) {
      // Live settings, else the ones noted at the start of this wash
      const val = (e, fb) => { const x = s(e) ? st[e].state : ""; return WASH_BAD.includes(x) ? fb : x; };
      const temp = val(c.temperature, cyc && cyc.temp), spin = val(c.spin, cyc && cyc.spin), rin = num(c.rinses) ?? washNum(cyc && cyc.rinse);
      if (!WASH_BAD.includes(temp) && temp) chips.push(["mdi:thermometer-water", washTemp(temp), "Temperature"]);
      if (!WASH_BAD.includes(spin) && spin) chips.push(["mdi:rotate-right", washSpin(spin), "Spin"]);
      if (rin != null) chips.push(["mdi:water-sync", `${rin}`, rin === 1 ? "Rinse" : "Rinses"]);
    }
    const ids = [c.job, c.machine, c.energy, c.water, c.completion, c.power].filter((e) => s(e));
    const updated = ids.length ? Math.max(...ids.map((e) => Date.parse(st[e].last_updated))) : null;

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { box-sizing: border-box; padding: 22px 24px; border-radius: 28px; color: #fff; position: relative; overflow: hidden;
          background: radial-gradient(110% 150% at 100% 0%, rgba(${tone},0.22) 0%, transparent 55%), ${GLASS_BG}; border: ${GLASS_BORDER}; box-shadow: ${GLASS_EDGE}; }
        .top { display: flex; align-items: center; gap: 18px; }
        .ic { position: relative; width: 76px; height: 76px; flex: none; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          background: rgba(${tone},0.16); color: rgb(${tone}); box-shadow: 0 0 26px rgba(${tone},0.28); --mdc-icon-size: 38px; }
        .ic.spin::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; border: 2px solid transparent;
          border-top-color: rgba(${tone},0.9); border-right-color: rgba(${tone},0.35); animation: rot 1.6s linear infinite; }
        .ic.spin ha-icon { animation: wob 3s ease-in-out infinite; }
        @keyframes rot { to { transform: rotate(360deg); } }
        @keyframes wob { 0%, 100% { transform: rotate(0); } 25% { transform: rotate(-4deg); } 75% { transform: rotate(4deg); } }
        .ic.done::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; border: 2px solid rgba(${tone},0.55); animation: ping 2.4s ease-out infinite; }
        @keyframes ping { from { transform: scale(0.92); opacity: 1; } to { transform: scale(1.18); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .ic::after, .ic ha-icon { animation: none !important; } }
        .tt { flex: 1 1 auto; min-width: 0; }
        .nm { font-size: 13px; font-weight: 600; letter-spacing: 0.6px; text-transform: uppercase; color: #a29db8; }
        .h { font-size: 30px; font-weight: 700; letter-spacing: -0.4px; margin-top: 2px; }
        .s { font-size: 15px; color: #c9c4dc; margin-top: 3px; }
        .left { text-align: right; flex: none; }
        .left .n { font-size: 46px; font-weight: 300; letter-spacing: -1.5px; line-height: 1; font-variant-numeric: tabular-nums; }
        .left .n small { font-size: 17px; font-weight: 500; color: #a29db8; letter-spacing: 0; margin-left: 4px; }
        .left .f { font-size: 14px; color: #a29db8; margin-top: 5px; }
        .left .f b { color: #fff; font-weight: 600; }
        .unl { flex: none; border: 0; font: inherit; font-size: 15px; font-weight: 600; color: #fff; padding: 0 18px; height: 48px; border-radius: 16px; cursor: pointer;
          background: linear-gradient(160deg, rgba(52,211,153,0.55), rgba(16,150,110,0.45)); box-shadow: 0 0 16px rgba(52,211,153,0.25); display: flex; align-items: center; gap: 8px; --mdc-icon-size: 20px; }
        .unl:active { transform: scale(0.96); }
        .bar { height: 10px; border-radius: 5px; background: rgba(255,255,255,0.08); margin-top: 20px; overflow: hidden; }
        .bar i { display: block; height: 100%; border-radius: 5px; background: linear-gradient(90deg, #7c3aed, #a78bfa, #c4b5fd, #a78bfa, #7c3aed);
          background-size: 200% 100%; animation: flow 3s linear infinite; box-shadow: 0 0 14px rgba(167,139,250,0.6); transition: width 1s ease; }
        @keyframes flow { to { background-position: -200% 0; } }
        @media (prefers-reduced-motion: reduce) { .bar i { animation: none; } }
        .pl { display: flex; justify-content: space-between; font-size: 12.5px; color: #8e8aa0; margin-top: 6px; }
        .pl b { color: #e9e5f5; font-weight: 600; }
        .steps { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-top: 16px; }
        .st { text-align: center; font-size: 13px; color: #6f6a86; font-weight: 600; }
        .st i { display: block; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.08); margin-bottom: 7px; }
        .st.done { color: #a29db8; } .st.done i { background: rgba(167,139,250,0.55); }
        .st.now { color: #fff; } .st.now i { background: #a78bfa; box-shadow: 0 0 10px rgba(167,139,250,0.8); }
        .chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-top: 16px; }
        .chip { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: 16px; background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.07); --mdc-icon-size: 20px; }
        .chip ha-icon { color: #c4b5fd; }
        .chip .v { font-size: 15.5px; font-weight: 600; white-space: nowrap; }
        .chip .k { font-size: 12px; color: #8e8aa0; white-space: nowrap; }
        .foot { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #8e8aa0; margin-top: 16px; }
        .foot i { width: 8px; height: 8px; border-radius: 4px; background: rgb(${offline ? STATUS.red : STATUS.green}); box-shadow: 0 0 8px rgb(${offline ? STATUS.red : STATUS.green}); }
        ${NARROW_CSS_LAUNDRY}
      </style>
      <ha-card>
        <div class="top">
          <div class="ic${running ? " spin" : finished ? " done" : ""}"><ha-icon icon="${icon}"></ha-icon></div>
          <div class="tt"><div class="nm">${esc(c.name || "Washing machine")}</div><div class="h">${esc(title)}</div><div class="s">${esc(sub)}</div></div>
          ${left != null ? `<div class="left"><div class="n">${left}<small>min</small></div><div class="f">left · done <b>${washHM(endT)}</b></div></div>` : ""}
          ${finished && c.finished ? `<button class="unl" data-act="unloaded">${hcIcon("check")}Unloaded</button>` : ""}
        </div>
        ${pct != null ? `<div class="bar"><i style="width:${Math.max(2, pct)}%"></i></div><div class="pl"><span><b>${pct}%</b> · estimate</span><span>from the start time and the machine's finish time</span></div>` : ""}
        ${step >= 0 ? `<div class="steps">${WASH_STEPS.map(([, label], k) => `<div class="st${k < step ? " done" : k === step ? " now" : ""}"><i></i>${label}</div>`).join("")}</div>` : ""}
        ${chips.length ? `<div class="chips">${chips.map(([ic, v, k]) => `<div class="chip"><ha-icon icon="${ic}"></ha-icon><div><div class="v">${esc(v)}</div><div class="k">${k}</div></div></div>`).join("")}</div>` : ""}
        <div class="foot"><i></i>${offline ? "SmartThings not reporting" : "SmartThings connected"}${updated ? ` · last update ${washHM(updated)}` : ""}</div>
      </ha-card>`;
  }
}

/*
 * Glass Home Washer card: the rest of the Laundry page, one section per card.
 *
 *   type: custom:glasshome-washer-card
 *   section: settings | usage | insights | history
 *   energy: sensor.x_energy   water: sensor.x_water_consumption      # lifetime meters (total_increasing)
 *   rate: sensor.octopus_..._current_rate                             # £/kWh for cost estimates (usage)
 *   logs: [input_text.laundry_wash_log_1, ...]   current: input_text.laundry_current_cycle   counter: counter.laundry_washes_completed
 *   operation: select.x   temperature: select.x_water_temperature   spin: select.x_spin_level
 *   rinses: number.x_rinse_cycles   bubble: switch.x_bubble_soak   remote: binary_sensor.x_remote_control
 *   child_lock: binary_sensor.x_child_lock   machine: sensor.x_machine_state   job: sensor.x_job_state   counter_since: 3 Nov
 *
 * Daily, weekly and monthly energy and water come from Home Assistant's long-term statistics of the
 * machine's own meters (no extra utility meters, nothing counted twice); the current hour is added
 * from the live meter. Per-wash figures come from the wash log the automations keep. Settings can only
 * be changed while the washer's Smart Control (remote control) is on; until then the controls are
 * disabled and say so.
 */
const WASH_TEMPS = [["cold", "Cold"], ["20", "20°"], ["30", "30°"], ["40", "40°"], ["60", "60°"], ["90", "90°"]];
const WASH_SPINS = [["rinse_hold", "Hold"], ["no_spin", "None"], ["400", "400"], ["800", "800"], ["1000", "1000"], ["1200", "1200"], ["1400", "1400"]];
const WASH_E = "#a78bfa", WASH_W = "#60a5fa";
const WASH_STATS = { at: 0, p: null, key: "" };
function washStats(hass, c, force = false) {
  const key = `${c.energy}|${c.water}`;
  if (!force && WASH_STATS.p && WASH_STATS.key === key && Date.now() - WASH_STATS.at < 1800000) return WASH_STATS.p;
  const start = new Date(); start.setMonth(start.getMonth() - 6, 1); start.setHours(0, 0, 0, 0);
  WASH_STATS.at = Date.now(); WASH_STATS.key = key;
  WASH_STATS.p = hass.callWS({ type: "recorder/statistics_during_period", start_time: start.toISOString(), period: "day", types: ["change", "state"],
    statistic_ids: [c.energy, c.water] }).then((r) => {
    const days = {}, last = {};
    for (const [id, f] of [[c.energy, "e"], [c.water, "w"]]) {
      for (const x of r[id] || []) { (days[enKey(new Date(x.start))] = days[enKey(new Date(x.start))] || {})[f] = x.change || 0; last[f] = x.state; }
    }
    return { days, last, first: Object.keys(days).sort()[0] || null };
  }).catch((err) => ({ days: {}, last: {}, first: null, error: (err && err.message) || "error" }));
  return WASH_STATS.p;
}

// Narrow: setting labels sit above their controls, option buttons wrap onto a second row, the badges
// move under the title, usage tiles wrap (text wrapping rather than cut off) and chart labels stay readable
// Narrow (a foldable's cover screen, a phone): the laundry status card keeps its layout with smaller type
// and icon; the time left drops under the title instead of squeezing it
const NARROW_CSS_LAUNDRY = `
  :host { container-type: inline-size; }
  @container (max-width: 480px) {
    ha-card { padding: 16px 16px; border-radius: 24px; }
    .top { gap: 12px; flex-wrap: wrap; }
    .ic { width: 56px; height: 56px; --mdc-icon-size: 28px; }
    .tt { flex: 1 1 150px; }
    .nm { font-size: 11.5px; letter-spacing: 0.4px; }
    .h { font-size: 23px; }
    .s { font-size: 13.5px; }
    .left { flex: 1 1 100%; text-align: left; display: flex; align-items: baseline; gap: 10px; }
    .left .n { font-size: 34px; }
    .left .f { margin-top: 0; }
    .unl { height: 44px; font-size: 14px; }
    .steps { gap: 4px; }
    .st { font-size: 11px; }
    .chips { grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); }
    .chip { padding: 8px 10px; gap: 8px; }
    .chip .v { font-size: 14px; }
    .pl span:last-child { display: none; }
  }`;

const NARROW_CSS_WASHER = `
  :host { container-type: inline-size; }
  @container (max-width: 560px) {
    .hd { flex-wrap: wrap; row-gap: 8px; }
    .hd .t { flex: 1 1 160px; }
    .row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .seg { grid-auto-flow: row; grid-template-columns: repeat(auto-fit, minmax(64px, 1fr)); }
    .tiles { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
    .tile b, .tile span { white-space: normal; }
    svg text { font-size: 21px; }
  }
  @container (max-width: 480px) {
    ha-card { padding: 14px 14px; border-radius: 24px; }
    .hd { gap: 10px; margin-bottom: 10px; }
    .hd > ha-icon { width: 34px; height: 34px; --mdc-icon-size: 19px; }
    .hd .n { font-size: 16px; } .hd .s { font-size: 12px; }
    .badge { font-size: 12px; padding: 5px 8px; }
    .rl { font-size: 13px; }
    .seg { grid-template-columns: repeat(auto-fit, minmax(54px, 1fr)); gap: 5px; }
    .seg button { min-height: 40px; font-size: 13px; padding: 0 4px; }
    .ops button { min-height: 46px; font-size: 14px; }
    .warn { font-size: 12.5px; padding: 9px 10px; }
    .wash { grid-template-columns: 44px minmax(0, 1fr); padding: 9px 10px; gap: 10px; }
    .wash .pillst { grid-column: 2; justify-self: start; }
    .wash .d b { font-size: 17px; }
    .wash .m .l1 { font-size: 14px; } .wash .m .l2 { font-size: 12px; }
  }`;

class GlassHomeWasherCard extends HTMLElement {
  setConfig(config) {
    if (!config.section) throw new Error("section is required");
    this._config = { logs: [], ...config };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._click(e));
    }
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    const c = this._config, v = (e) => (e && hass.states[e] ? hass.states[e].state : "");
    const key = JSON.stringify([c.energy, c.water, c.rate, c.current, c.counter, c.operation, c.temperature, c.spin, c.rinses, c.bubble, c.remote,
      c.child_lock, c.machine, c.job, ...c.logs].map(v));
    if (["usage", "insights"].includes(c.section) && (first || !this._stats)) this._load();
    if (key === this._key) return;
    // A wash that has just been logged changes the statistics too
    if (this._key && ["usage", "insights"].includes(c.section) && JSON.stringify(c.logs.map(v)) !== this._logKey) this._load(true);
    this._logKey = JSON.stringify(c.logs.map(v));
    this._key = key;
    this._render();
  }

  getCardSize() {
    return 5;
  }

  async _load(force = false) {
    if (this._loading) return;
    this._loading = true;
    this._stats = await washStats(this._hass, this._config, force);
    this._loading = false;
    this._render();
  }

  _call(domain, service, data) {
    this._err = "";
    return this._hass.callService(domain, service, data).catch((e) => { this._err = (e && e.message) || "SmartThings refused the change"; this._render(); });
  }

  _click(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const c = this._config, a = b.dataset.act, v = b.dataset.v;
    if (a === "temp") this._call("select", "select_option", { entity_id: c.temperature, option: v });
    else if (a === "spin") this._call("select", "select_option", { entity_id: c.spin, option: v });
    else if (a === "rinse") {
      const n = washNum(this._hass.states[c.rinses].state) ?? 0, nx = Math.max(0, Math.min(5, n + Number(v)));
      if (nx !== n) this._call("number", "set_value", { entity_id: c.rinses, value: nx });
    } else if (a === "bubble") this._call("switch", "toggle", { entity_id: c.bubble });
    else if (a === "op") {
      // Stopping cancels the wash, so it needs a second tap within 4 seconds
      if (v === "stop" && !this._armed) { this._armed = true; this._render(); setTimeout(() => { this._armed = false; this._render(); }, 4000); return; }
      this._armed = false;
      this._call("select", "select_option", { entity_id: c.operation, option: v });
    } else if (a === "chart") { this._chart = v; this._render(); }
    else if (a === "period") { this._period = v; this._render(); }
    else if (a === "reload") this._load(true);
    else if (a === "more") { this._more = !this._more; this._render(); }
  }

  _render() {
    if (!this._hass) return;
    const sec = this._config.section;
    const body = sec === "settings" ? this._settings() : sec === "usage" ? this._usage() : sec === "insights" ? this._insights() : this._history();
    this.shadowRoot.innerHTML = `<style>${EN_CSS}
        ha-card { padding: 18px 20px; }
        .hd { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .hd > ha-icon { --mdc-icon-size: 22px; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          color: #c4b5fd; background: rgba(139,92,246,0.16); box-shadow: 0 0 14px rgba(139,92,246,0.2); flex: none; }
        .hd .t { flex: 1; min-width: 0; } .hd .n { font-size: 18px; font-weight: 650; } .hd .s { font-size: 13px; color: #a29db8; margin-top: 1px; }
        .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 12px; font-size: 13px; font-weight: 600;
          background: rgba(255,255,255,0.06); color: #c9c4dc; --mdc-icon-size: 16px; white-space: nowrap; }
        .badge.on { color: rgb(${STATUS.green}); background: rgba(${STATUS.green},0.12); }
        .row { display: grid; grid-template-columns: 118px minmax(0, 1fr); align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.06); }
        .rows .row:first-child { border-top: 0; }
        .rl { font-size: 14px; font-weight: 600; color: #e9e5f5; display: flex; align-items: center; gap: 8px; --mdc-icon-size: 19px; }
        .rl ha-icon { color: #a78bfa; }
        .seg { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 6px; }
        .seg button { min-height: 44px; padding: 0 6px; }
        .step { display: flex; align-items: center; gap: 10px; } .step b { font-size: 20px; min-width: 28px; text-align: center; font-variant-numeric: tabular-nums; }
        .step button { width: 48px; } .step span { font-size: 13px; color: #a29db8; }
        .tog { width: 64px; height: 36px; min-height: 0; border-radius: 18px; padding: 3px; justify-content: flex-start; background: rgba(255,255,255,0.1); }
        .tog i { width: 30px; height: 30px; border-radius: 15px; background: #c9c4dc; transition: transform 0.2s ease; }
        .tog.on { background: linear-gradient(160deg, rgba(139,92,246,0.85), rgba(109,40,217,0.7)); } .tog.on i { transform: translateX(28px); background: #fff; }
        .ops { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
        .ops button { min-height: 52px; font-size: 15px; } .ops button.arm { color: #fff; background: rgba(${STATUS.red},0.45); }
        button:disabled { opacity: 0.38; cursor: default; }
        /* the machine's current setting stays readable while the controls are locked */
        button.on:disabled { opacity: 0.8; }
        .warn { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 14px; background: rgba(255,179,64,0.12);
          color: #ffd79a; font-size: 13.5px; line-height: 1.4; margin-bottom: 10px; --mdc-icon-size: 19px; }
        .warn.err { background: rgba(255,107,107,0.14); color: #ffb4b4; }
        .tile.e b { color: #ddd6fe; } .tile.w b { color: #bfdbfe; } .tile.c b { color: #fde68a; }
        .tile .tag { display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: 0.3px; padding: 1px 6px; border-radius: 6px; margin-top: 4px;
          background: rgba(255,255,255,0.07); color: #a29db8; }
        .segs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
        .segs .sp { flex: 1; }
        .chart { position: relative; }
        .hist { display: grid; gap: 8px; }
        .wash { display: grid; grid-template-columns: 54px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 16px; background: rgba(255,255,255,0.04); }
        .wash .d { text-align: center; line-height: 1.1; } .wash .d b { display: block; font-size: 20px; } .wash .d span { font-size: 11.5px; color: #a29db8; text-transform: uppercase; letter-spacing: 0.5px; }
        .wash .m { min-width: 0; } .wash .m .l1 { font-size: 15px; font-weight: 600; } .wash .m .l2 { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; color: #a29db8; margin-top: 3px; }
        .wash .m .l2 span { display: inline-flex; align-items: center; gap: 4px; --mdc-icon-size: 15px; white-space: nowrap; }
        .pillst { font-size: 12.5px; font-weight: 600; padding: 5px 10px; border-radius: 10px; white-space: nowrap; }
        .pillst.f { color: rgb(${STATUS.green}); background: rgba(${STATUS.green},0.12); } .pillst.x { color: rgb(${STATUS.amber}); background: rgba(${STATUS.amber},0.12); }
        .pillst.r { color: #ddd6fe; background: rgba(139,92,246,0.22); }
        ${NARROW_CSS_WASHER}
      </style><ha-card>${body}</ha-card>`;
  }

  // ---------------------------------------------------------------- settings
  _settings() {
    const c = this._config, st = this._hass.states, s = (e) => (e && st[e] ? st[e].state : "unavailable");
    const remote = s(c.remote) === "on", lock = s(c.child_lock) === "on";
    const running = s(c.machine) === "run" || washActive(s(c.job)), paused = s(c.machine) === "pause";
    const canSet = remote && !running && !paused, canOp = remote;
    const temp = s(c.temperature), spin = s(c.spin), rin = washNum(s(c.rinses)), bub = s(c.bubble) === "on", op = s(c.operation);
    const seg = (act, list, cur, ok) => `<div class="seg">${list.map(([v, l]) => `<button data-act="${act}" data-v="${v}" class="${cur === v ? "on" : ""}" ${ok ? "" : "disabled"}>${l}</button>`).join("")}</div>`;
    const note = !remote ? `<div class="warn">${hcIcon("remote-off")}<div><b>Remote control is off.</b> To start a wash or change settings from here, press Smart Control on the washer first. Until then these controls only show the machine's settings.</div></div>`
      : running || paused ? `<div class="warn">${hcIcon("information-outline")}<div>A wash is running, so only Pause, Resume and Stop are available.</div></div>` : "";
    const ops = [
      ["run", paused ? "Resume" : "Start", paused ? "play" : "play", canOp && !running],
      ["pause", "Pause", "pause", canOp && running],
      ["stop", this._armed ? "Tap to stop" : "Stop", "stop", canOp && (running || paused)],
    ];
    return `<div class="hd">${hcIcon("tune-variant")}<div class="t"><div class="n">Wash settings</div><div class="s">As reported by the washer${temp === "none" ? " · shown while the machine is on" : ""}</div></div>
        <span class="badge ${remote ? "on" : ""}">${hcIcon(remote ? "remote" : "remote-off")}Remote ${remote ? "on" : "off"}</span>
        <span class="badge ${lock ? "on" : ""}">${hcIcon(lock ? "lock" : "lock-open-variant-outline")}Child lock ${lock ? "on" : "off"}</span></div>
      ${note}${this._err ? `<div class="warn err">${hcIcon("alert-circle-outline")}<div>${esc(this._err)}</div></div>` : ""}
      <div class="rows"><div class="row"><div class="rl">${hcIcon("thermometer-water")}Temperature</div>${seg("temp", WASH_TEMPS, temp, canSet)}</div>
      <div class="row"><div class="rl">${hcIcon("rotate-right")}Spin (rpm)</div>${seg("spin", WASH_SPINS, spin, canSet)}</div>
      <div class="row"><div class="rl">${hcIcon("water-sync")}Rinses</div><div class="step">
        <button data-act="rinse" data-v="-1" ${canSet && rin > 0 ? "" : "disabled"} aria-label="Fewer rinses">${hcIcon("minus")}</button><b>${rin ?? "–"}</b>
        <button data-act="rinse" data-v="1" ${canSet && rin != null && rin < 5 ? "" : "disabled"} aria-label="More rinses">${hcIcon("plus")}</button><span>0 to 5</span></div></div>
      <div class="row"><div class="rl">${hcIcon("chart-bubble")}Bubble soak</div><div><button class="tog ${bub ? "on" : ""}" data-act="bubble" ${canSet ? "" : "disabled"} aria-label="Bubble soak"><i></i></button></div></div>
      <div class="row"><div class="rl">${hcIcon("play-pause")}Machine</div><div class="ops">${ops.map(([v, l, ic, ok]) => `<button data-act="op" data-v="${v}" class="${v === "stop" && this._armed ? "arm" : op === v && ok ? "on" : ""}" ${ok ? "" : "disabled"}>${hcIcon(ic)}${l}</button>`).join("")}</div></div></div>`;
  }

  // ---------------------------------------------------------------- usage
  _periods() {
    const st = this._stats, c = this._config, s = this._hass.states;
    if (!st || st.error) return null;
    const days = JSON.parse(JSON.stringify(st.days));
    const today = enKey(new Date());
    // The statistics run to the last full hour; the live meters add the hour in progress
    for (const [id, f] of [[c.energy, "e"], [c.water, "w"]]) {
      const live = s[id] ? washNum(s[id].state) : null;
      if (live != null && st.last[f] != null && live > st.last[f]) (days[today] = days[today] || {})[f] = ((days[today] || {})[f] || 0) + (live - st.last[f]);
    }
    const now = new Date(), mon = enAdd(now, -((now.getDay() + 6) % 7)); mon.setHours(0, 0, 0, 0);
    const m1 = new Date(now.getFullYear(), now.getMonth(), 1);
    const sum = (from, f) => Object.entries(days).filter(([k]) => enDay(k) >= from).reduce((a, [, v]) => a + (v[f] || 0), 0);
    const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
    return { days, today: { e: sum(t0, "e"), w: sum(t0, "w") }, week: { e: sum(mon, "e"), w: sum(mon, "w") }, month: { e: sum(m1, "e"), w: sum(m1, "w") } };
  }

  _usage() {
    const c = this._config, s = this._hass.states, P = this._periods();
    const rate = c.rate && s[c.rate] ? washNum(s[c.rate].state) : null;
    const eL = c.energy && s[c.energy] ? washNum(s[c.energy].state) : null, wL = c.water && s[c.water] ? washNum(s[c.water].state) : null;
    const kwh = (n) => (n == null ? "–" : `${n.toFixed(1)} kWh`), lit = (n) => (n == null ? "–" : `${Math.round(n).toLocaleString("en-GB")} L`);
    const gbp = (n) => (n == null || rate == null ? "–" : ghMoney(n * rate));
    const since = this._stats && this._stats.first ? enDay(this._stats.first).toLocaleDateString(GH_LOCALE, { day: "numeric", month: "short" }) : null;
    const tile = (cls, v, k, tag) => `<div class="tile ${cls}"><b>${v}</b><span>${k}</span>${tag ? `<em class="tag">${tag}</em>` : ""}</div>`;
    return `<div class="hd">${hcIcon("lightning-bolt-circle")}<div class="t"><div class="n">Energy and water</div>
        <div class="s">Measured by the washer and read from Home Assistant's statistics${since ? ` · recorded since ${since}` : ""}</div></div></div>
      ${this._stats && this._stats.error ? `<div class="warn err">${hcIcon("alert-circle-outline")}<div>Could not read the statistics: ${esc(this._stats.error)}</div></div>` : ""}
      <div class="lab" style="margin-bottom:6px">Electricity</div>
      <div class="tiles" style="--n:4">${tile("e", kwh(P && P.today.e), "Today")}${tile("e", kwh(P && P.week.e), "This week")}${tile("e", kwh(P && P.month.e), "This month")}${tile("e", kwh(eL), "Lifetime", "machine meter")}</div>
      <div class="lab" style="margin:12px 0 6px">Water</div>
      <div class="tiles" style="--n:4">${tile("w", lit(P && P.today.w), "Today")}${tile("w", lit(P && P.week.w), "This week")}${tile("w", lit(P && P.month.w), "This month")}${tile("w", lit(wL), "Lifetime", "machine meter")}</div>
      <div class="lab" style="margin:12px 0 6px">Running cost <span style="text-transform:none;letter-spacing:0;font-weight:500">· estimate</span></div>
      <div class="tiles" style="--n:3">${tile("c", gbp(P && P.today.e), "Today", "estimate")}${tile("c", gbp(P && P.week.e), "This week", "estimate")}${tile("c", gbp(P && P.month.e), "This month", "estimate")}</div>
      <div class="note" style="margin-top:10px">${rate != null ? `Cost = the washer's kWh × your unit rate, <b>${ghRate(rate)}/kWh</b>; the standing charge is not included.` : "No unit rate is available, so costs cannot be estimated."}
        The washer reports energy in 0.1 kWh steps, and weeks start on Monday. Water cost is not shown: no water tariff is set up in Home Assistant.</div>`;
  }

  // ---------------------------------------------------------------- insights
  _insights() {
    const c = this._config, P = this._periods(), log = washLog(this._hass, c.logs).filter((w) => w.done);
    const metric = this._chart || "e", period = this._period || "day";
    const f = metric, color = f === "e" ? WASH_E : WASH_W, unit = f === "e" ? "kWh" : "L";
    let bars = [];
    if (P) {
      const now = new Date();
      if (period === "day") {
        for (let i = 13; i >= 0; i--) { const d = enAdd(now, -i), k = enKey(d); bars.push({ l: i === 0 ? "Today" : d.toLocaleDateString(GH_LOCALE, { weekday: "narrow" }), sub: String(d.getDate()), v: P.days[k] ? P.days[k][f] || 0 : null, k }); }
      } else if (period === "week") {
        const mon = enAdd(now, -((now.getDay() + 6) % 7)); mon.setHours(0, 0, 0, 0);
        for (let i = 7; i >= 0; i--) {
          const a = enAdd(mon, -7 * i), b = enAdd(a, 7);
          const ks = Object.keys(P.days).filter((k) => enDay(k) >= a && enDay(k) < b);
          bars.push({ l: a.toLocaleDateString(GH_LOCALE, { day: "numeric", month: "short" }), v: ks.length ? ks.reduce((x, k) => x + (P.days[k][f] || 0), 0) : null });
        }
      } else {
        for (let i = 5; i >= 0; i--) {
          const a = new Date(now.getFullYear(), now.getMonth() - i, 1), b = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
          const ks = Object.keys(P.days).filter((k) => enDay(k) >= a && enDay(k) < b);
          bars.push({ l: a.toLocaleDateString(GH_LOCALE, { month: "short" }), v: ks.length ? ks.reduce((x, k) => x + (P.days[k][f] || 0), 0) : null });
        }
      }
    }
    // Washes per week for the last 8 weeks (from the wash log)
    const now = new Date(), mon = enAdd(now, -((now.getDay() + 6) % 7)); mon.setHours(0, 0, 0, 0);
    const oldest = log.length ? log[log.length - 1].start : Date.now();
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const a = enAdd(mon, -7 * i), b = enAdd(a, 7);
      weeks.push({ l: a.toLocaleDateString(GH_LOCALE, { day: "numeric", month: "short" }), v: b.getTime() <= oldest ? null : log.filter((w) => w.start >= a && w.start < b).length });
    }
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const aE = avg(log.map((w) => w.kwh).filter((x) => x != null)), aW = avg(log.map((w) => w.litres).filter((x) => x != null)), aM = avg(log.map((w) => w.mins).filter((x) => x != null));
    const mode = (xs) => { const n = {}; xs.filter((x) => !WASH_BAD.includes(x)).forEach((x) => { n[x] = (n[x] || 0) + 1; }); const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0]; return top ? top : null; };
    const mt = mode(log.map((w) => w.temp)), msp = mode(log.map((w) => w.spin));
    const cnt = c.counter && this._hass.states[c.counter] ? washNum(this._hass.states[c.counter].state) : null;
    const btn = (act, v, l, on) => `<button data-act="${act}" data-v="${v}" class="${on ? "on" : ""}">${l}</button>`;
    const total = bars.reduce((a, b) => a + (b.v || 0), 0);
    return `<div class="hd">${hcIcon("chart-bar")}<div class="t"><div class="n">Insights</div><div class="s">Statistics of the washer's meters and the wash log · nothing estimated</div></div>
        <button data-act="reload" aria-label="Refresh">${hcIcon("refresh")}</button></div>
      <div class="tiles" style="--n:4">
        <div class="tile"><b>${cnt ?? "–"}</b><span>Washes completed</span><small>${c.counter_since ? `since ${esc(c.counter_since)}` : "counted by Home Assistant"}</small></div>
        <div class="tile e"><b>${aE != null ? `${aE.toFixed(1)} kWh` : "–"}</b><span>Average per wash</span><small>${aE != null && aW != null ? `${Math.round(aW)} L water` : "no washes logged yet"}</small></div>
        <div class="tile"><b>${aM != null ? washDur(Math.round(aM)) : "–"}</b><span>Average duration</span><small>${log.length} logged wash${log.length === 1 ? "" : "es"}</small></div>
        <div class="tile"><b>${mt ? washTemp(mt[0]) : "–"}${msp ? ` · ${washSpin(msp[0]).replace(" rpm", "")}` : ""}</b><span>Most used settings</span><small>programme not reported</small></div>
      </div>
      <div class="segs" style="margin-top:14px">${btn("chart", "e", `${hcIcon("lightning-bolt")}Electricity`, f === "e")}${btn("chart", "w", `${hcIcon("water")}Water`, f === "w")}<span class="sp"></span>
        ${btn("period", "day", "Days", period === "day")}${btn("period", "week", "Weeks", period === "week")}${btn("period", "month", "Months", period === "month")}</div>
      <div class="chart">${P ? washBars(bars, color, unit) : `<div class="empty">${this._stats && this._stats.error ? "Statistics unavailable" : "Loading statistics…"}</div>`}</div>
      <div class="note" style="margin-top:6px">${P ? `${period === "day" ? "Last 14 days" : period === "week" ? "Last 8 weeks" : "Last 6 months"}: <b>${f === "e" ? `${total.toFixed(1)} kWh` : `${Math.round(total).toLocaleString("en-GB")} L`}</b>. Bars are blank before recording began.` : ""}</div>
      <div class="h" style="margin-top:16px">Washes per week <span>from the wash log</span></div>
      ${washBars(weeks, "#34d399", "", 120, true)}`;
  }

  // ---------------------------------------------------------------- history
  _history() {
    const c = this._config, all = washLog(this._hass, c.logs), cur = washCurrent(this._hass, c.current);
    const st = this._hass.states, js = c.job && st[c.job] ? st[c.job].state : "";
    const list = this._more ? all : all.slice(0, 6);
    const row = (w, live) => {
      const d = new Date(w.start);
      const bits = [
        ["timer-sand", live ? `${washDur(Math.round((Date.now() - w.start) / 60000))} so far` : washDur(w.mins)],
        ["thermometer-water", washTemp(w.temp)], ["rotate-right", washSpin(w.spin)],
        ["water-sync", w.rinse != null && !WASH_BAD.includes(String(w.rinse)) ? `${w.rinse} rinse${Number(w.rinse) === 1 ? "" : "s"}` : "–"],
      ];
      if (w.bubble) bits.push(["chart-bubble", "Bubble soak"]);
      if (!live) { bits.push(["lightning-bolt", w.kwh != null ? `${w.kwh.toFixed(1)} kWh` : "–"]); bits.push(["water", w.litres != null ? `${Math.round(w.litres)} L` : "–"]); }
      const status = live ? ["r", WASH_STAGE[js] || "Running"] : w.done ? ["f", "Finished"] : ["x", "Stopped early"];
      return `<div class="wash"><div class="d"><b>${d.getDate()}</b><span>${d.toLocaleDateString(GH_LOCALE, { month: "short" })}</span></div>
        <div class="m"><div class="l1">${d.toLocaleDateString(GH_LOCALE, { weekday: "long" })} · ${washHM(w.start)}${live ? "" : `–${washHM(w.end)}`}</div>
        <div class="l2">${bits.map(([ic, t]) => `<span>${hcIcon(ic)}${esc(t)}</span>`).join("")}</div></div>
        <span class="pillst ${status[0]}">${esc(status[1])}</span></div>`;
    };
    const live = cur ? row({ start: cur.start, temp: cur.temp, spin: cur.spin, rinse: washNum(cur.rinse), bubble: cur.bubble }, true) : "";
    return `<div class="hd">${hcIcon("history")}<div class="t"><div class="n">Wash history</div><div class="s">Kept by Home Assistant · the last ${all.length >= 18 ? "18" : all.length} wash${all.length === 1 ? "" : "es"}</div></div>
        ${all.length > 6 ? `<button data-act="more">${this._more ? "Show fewer" : `Show all ${all.length}`}</button>` : ""}</div>
      <div class="hist">${live}${list.map((w) => row(w, false)).join("") || (live ? "" : `<div class="empty">No washes logged yet. Each wash appears here a few minutes after it finishes.</div>`)}</div>
      <div class="note" style="margin-top:10px">Energy and water per wash are the washer's meter readings at the end minus those at the start (0.1 kWh steps). SmartThings does not report which programme was used.</div>`;
  }
}

// Bar chart for the Laundry insights: values may be null (no data recorded yet: drawn as a blank slot)
function washBars(bars, color, unit, h = 190, ints = false) {
  const W = 760, top = 22, bottom = 30, left = 6, n = bars.length || 1, gap = 10, bw = (W - left * 2 - gap * (n - 1)) / n;
  const max = Math.max(ints ? 2 : 0.1, ...bars.map((b) => b.v || 0));
  const ch = h - top - bottom;
  const fmt = (v) => (ints ? String(v) : unit === "L" ? `${Math.round(v)}` : v.toFixed(1));
  const els = bars.map((b, i) => {
    const x = left + i * (bw + gap), has = b.v != null, bh = has ? Math.max(b.v > 0 ? 3 : 0, (b.v / max) * ch) : 0, y = top + ch - bh;
    return `${has ? `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(bw)}" height="${f1(bh)}" rx="${f1(Math.min(8, bw / 3))}" fill="url(#g${color.slice(1)})"/>` : `<rect x="${f1(x)}" y="${f1(top + ch - 2)}" width="${f1(bw)}" height="2" rx="1" fill="rgba(255,255,255,0.08)"/>`}
      ${has && b.v > 0 ? `<text x="${f1(x + bw / 2)}" y="${f1(y - 6)}" text-anchor="middle" font-size="12" fill="#e9e5f5" font-weight="600">${fmt(b.v)}</text>` : ""}
      <text x="${f1(x + bw / 2)}" y="${f1(h - (b.sub ? 15 : 9))}" text-anchor="middle" font-size="12" fill="#a29db8">${esc(b.l)}</text>
      ${b.sub ? `<text x="${f1(x + bw / 2)}" y="${f1(h - 1)}" text-anchor="middle" font-size="11" fill="#6f6a86">${esc(b.sub)}</text>` : ""}`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${h}" role="img"><defs><linearGradient id="g${color.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0.35"/></linearGradient></defs>
    <line x1="0" x2="${W}" y1="${top + ch}" y2="${top + ch}" stroke="rgba(255,255,255,0.08)"/>${els}</svg>`;
}

/*
 * ================================================================ BIN COLLECTION SCHEDULE
 * The one place the bin calendar lives. Both the reminder banner and the bin status tile read it.
 * The calendar comes from bins: in the glasshome: settings (a list of dates, or a repeating rotation).
 * A date with two bins is one combined collection.
 */
const BIN_TYPES = { ...{
  blue: { name: "Blue bin", short: "Blue", waste: "Bottles", main: "#3b82f6", dark: "#1d4ea8", lid: "#2a62c9", glow: "59,130,246" },
  grey: { name: "Grey bin", short: "Grey", waste: "General Waste", main: "#8d929e", dark: "#4f5460", lid: "#6a6f7b", glow: "160,165,180" },
  brown: { name: "Brown bin", short: "Brown", waste: "Garden Waste", main: "#9a6235", dark: "#5a371b", lid: "#7a4a25", glow: "180,115,60" },
  green: { name: "Green bin", short: "Green", waste: "Paper Waste", main: "#2fa864", dark: "#19663a", lid: "#22854d", glow: "47,168,100" },
}, ...((GH_CFG.bins && GH_CFG.bins.types) || {}) };
// bins.schedule: { "YYYY-MM-DD": ["grey"], ... } and/or bins.rotation: { start: "YYYY-MM-DD", every_days: 7,
// pattern: [["grey"], ["blue", "brown"]], weeks: 104 } (start is the first collection; pattern repeats)
const BIN_SCHEDULE = (() => {
  const b = GH_CFG.bins || {}, out = {};
  const r = b.rotation;
  if (r && /^\d{4}-\d{2}-\d{2}$/.test(r.start || "") && Array.isArray(r.pattern) && r.pattern.length) {
    const step = Math.max(1, Number(r.every_days) || 7), n = Math.min(520, Math.max(1, Number(r.weeks) || 104));
    const d = new Date(`${r.start}T12:00:00Z`);
    for (let i = 0; i < n; i++) {
      out[d.toISOString().slice(0, 10)] = [].concat(r.pattern[i % r.pattern.length]);
      d.setUTCDate(d.getUTCDate() + step);
    }
  }
  for (const [date, bins] of Object.entries(b.schedule || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(date)) out[date] = [].concat(bins);
  return out;
})();
const BIN_REMINDER_HOUR = Number.isFinite(Number((GH_CFG.bins || {}).reminder_hour)) ? Number(GH_CFG.bins.reminder_hour) : 18; // the evening before
const BIN_DATES = Object.keys(BIN_SCHEDULE).sort();

// Today's date and hour in the household's time zone (household.timezone), whatever the device itself uses
const localNow = (now) => {
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: GH_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(now).forEach((x) => { p[x.type] = x.value; });
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
};
const isoAddDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isoDaysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const binDateText = (iso, withYear = true) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(GH_LOCALE,
  { weekday: "long", day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).replace(",", "");

// The reminder is due from 6 pm the evening before a collection until the end of collection day
const binReminder = (now = new Date()) => {
  const { date, hour } = localNow(now);
  if (BIN_SCHEDULE[date]) return { date, bins: BIN_SCHEDULE[date], today: true };
  const tomorrow = isoAddDays(date, 1);
  if (BIN_SCHEDULE[tomorrow] && hour >= BIN_REMINDER_HOUR) return { date: tomorrow, bins: BIN_SCHEDULE[tomorrow], today: false };
  return null;
};

// The next collection from today (collection day itself counts until midnight)
const nextBinCollection = (now = new Date()) => {
  const { date } = localNow(now);
  const next = BIN_DATES.find((d) => d >= date);
  return next ? { date: next, bins: BIN_SCHEDULE[next], days: isoDaysBetween(date, next) } : null;
};

// Wheelie bin drawing in the bin's colour (body, lid, handle, front ridges, wheels)
const binSvg = (id) => {
  const b = BIN_TYPES[id];
  return `<svg class="binsvg" viewBox="0 0 48 60" aria-hidden="true">
    <defs><linearGradient id="g-${id}" x1="0" x2="1"><stop offset="0" stop-color="${b.dark}"/><stop offset="0.45" stop-color="${b.main}"/><stop offset="1" stop-color="${b.dark}"/></linearGradient></defs>
    <rect x="17" y="2.5" width="14" height="4.5" rx="2.2" fill="${b.lid}"/>
    <path d="M9 14.5 H39 L36.2 51 H11.8 Z" fill="url(#g-${id})"/>
    <path d="M11 15.5 H16 L14.6 49.5 H13.2 Z" fill="rgba(255,255,255,0.16)"/>
    <path d="M17.5 21 L18 44 M24 21 V44 M30.5 21 L30 44" stroke="rgba(0,0,0,0.20)" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M5.5 9.5 Q5.5 6.5 8.5 6.5 H39.5 Q42.5 6.5 42.5 9.5 V14.5 H5.5 Z" fill="${b.lid}"/>
    <path d="M7 8.2 H41" stroke="rgba(255,255,255,0.22)" stroke-width="1.2" stroke-linecap="round"/>
    <circle cx="13.5" cy="52.5" r="5" fill="#17151f" stroke="#3b3848" stroke-width="1.6"/><circle cx="13.5" cy="52.5" r="1.6" fill="#55516a"/>
    <circle cx="34.5" cy="52.5" r="5" fill="#17151f" stroke="#3b3848" stroke-width="1.6"/><circle cx="34.5" cy="52.5" r="1.6" fill="#55516a"/>
  </svg>`;
};

// Minute timer shared by both bin components (re-checks on the minute; works for any opening time)
const binTimer = (el) => {
  clearTimeout(el._timer);
  el._update();
  const n = new Date();
  el._timer = setTimeout(() => binTimer(el), 60500 - n.getSeconds() * 1000 - n.getMilliseconds());
};

/*
 * Glass Home Bin banner: the "bin collection tomorrow" reminder. Purely informational, no buttons.
 * Shown from 6 pm the evening before a collection until the end of collection day; otherwise it
 * takes no space at all (it tells the page to hide its slot with a glasshome-visibility event).
 *
 *   type: custom:glasshome-bin-banner-card
 */
class GlassHomeBinBannerCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) { this._started = true; binTimer(this); }
  }

  connectedCallback() {
    // Announce again once attached: the page only hears the banner when it is inside its slot
    if (this._started) { this._shown = undefined; binTimer(this); }
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
  }

  getCardSize() {
    return this._key ? 2 : 0;
  }

  _now() {
    return this._testNow ? new Date(this._testNow) : new Date();
  }

  _visible(on) {
    this.style.display = on ? "" : "none";
    this.dispatchEvent(new CustomEvent("glasshome-visibility", { bubbles: true, detail: { visible: on } }));
  }

  _update() {
    const r = binReminder(this._now());
    const key = r ? `${r.date}|${r.today}` : "";
    if (key === this._key && this._shown !== undefined) return;
    const was = !!this._key;
    this._key = key;
    clearTimeout(this._outT);
    if (r) {
      this._render(r);
      this._shown = true;
      this._visible(true);
    } else if (was) {
      // Fade out, then give the space back
      const b = this.shadowRoot.querySelector(".b");
      if (b) { b.classList.remove("in"); b.classList.add("out"); }
      this._outT = setTimeout(() => { this.shadowRoot.innerHTML = ""; this._shown = false; this._visible(false); }, 380);
    } else {
      this._shown = false;
      this._visible(false);
    }
  }

  _render(r) {
    const bins = r.bins.map((id) => {
      const b = BIN_TYPES[id];
      return `<div class="bin" style="--g:${b.glow}">${binSvg(id)}<div><div class="bn">${b.name}</div><div class="bw">${b.waste}</div></div></div>`;
    }).join("");
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .b { position: relative; overflow: hidden; box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 14px 16px 14px 22px;
          border-radius: 24px; color: #fff; border: 1px solid rgba(167,139,250,0.34);
          background: radial-gradient(120% 170% at 0% 0%, rgba(139,92,246,0.30) 0%, transparent 55%),
            linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)), rgba(24,18,44,0.94);
          box-shadow: 0 10px 28px rgba(0,0,0,0.35), 0 0 24px rgba(139,92,246,0.20), inset 0 1px 0 rgba(255,255,255,0.08); }
        .b::before { content: ""; position: absolute; left: 0; top: 14px; bottom: 14px; width: 4px; border-radius: 0 4px 4px 0;
          background: linear-gradient(180deg, #c4b5fd, #8b5cf6); box-shadow: 0 0 12px rgba(167,139,250,0.7); }
        .txt { flex: 1 1 220px; min-width: 0; }
        .h { font-size: 15px; font-weight: 800; letter-spacing: 1.3px; color: #ede7ff; text-transform: uppercase; }
        .s { font-size: 14px; color: #cfc8e6; margin-top: 3px; }
        .d { font-size: 13px; color: #a29db8; margin-top: 8px; }
        .d b { color: #e9e2ff; font-weight: 600; }
        .bins { flex: 0 0 auto; max-width: 100%; display: flex; flex-wrap: wrap; gap: 10px; }
        @media (max-width: 600px) { .bins { flex: 1 1 100%; } .bins > .bin { flex: 1 1 140px; min-width: 0; } }
        .bin { display: flex; align-items: center; gap: 10px; padding: 8px 14px 8px 10px; border-radius: 18px;
          background: radial-gradient(90% 120% at 20% 50%, rgba(var(--g),0.20), transparent 70%), rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08); }
        .binsvg { width: 44px; height: 55px; flex: none; filter: drop-shadow(0 4px 9px rgba(var(--g),0.38)); }
        .bn { font-size: 13.5px; font-weight: 800; letter-spacing: 0.7px; text-transform: uppercase; white-space: nowrap; }
        .bw { font-size: 13px; color: #cfc8e6; white-space: nowrap; margin-top: 1px; }
        .b.in { animation: binIn 0.45s cubic-bezier(0.2, 0.8, 0.3, 1) both; }
        .b.out { animation: binOut 0.36s ease both; }
        @keyframes binIn { from { opacity: 0; transform: translateY(-8px) scale(0.985); } to { opacity: 1; transform: none; } }
        @keyframes binOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-6px) scale(0.985); } }
        @media (prefers-reduced-motion: reduce) { .b.in, .b.out { animation: none; } }
      </style>
      <div class="b in" role="status">
        <div class="txt">
          <div class="h">${r.today ? "Bin collection today" : "Bin collection tomorrow"}</div>
          <div class="s">${r.today ? "Your bins should be out for collection today." : "Don't forget to put your bins out tonight."}</div>
          <div class="d">Collection: <b>${binDateText(r.date)}</b></div>
        </div>
        <div class="bins">${bins}</div>
      </div>`;
  }
}

/*
 * Glass Home Bin card: homepage status tile with the next collection, its bins and waste types, and
 * a countdown. It can be moved, resized or removed in the homepage editor; the reminder banner
 * works independently of it.
 *
 *   type: custom:glasshome-bin-card
 */
class GlassHomeBinCard extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) { this._started = true; binTimer(this); }
  }

  connectedCallback() {
    if (this._started) binTimer(this);
    if (!this._ro) {
      // Narrow tile (a third or half width): drop the detail lines
      this._ro = new ResizeObserver(() => {
        const c = this.shadowRoot.querySelector("ha-card");
        if (c) c.classList.toggle("narrow", this.clientWidth < 520);
      });
      this._ro.observe(this);
    }
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
  }

  getCardSize() {
    return 1;
  }

  _now() {
    return this._testNow ? new Date(this._testNow) : new Date();
  }

  _update() {
    const n = nextBinCollection(this._now());
    const key = n ? `${n.date}|${n.days}` : "none";
    if (key === this._key) return;
    this._key = key;
    const types = n ? n.bins.map((id) => BIN_TYPES[id]) : [];
    const count = !n ? "" : n.days === 0 ? "Today" : n.days === 1 ? "Tomorrow" : `In ${n.days} days`;
    const tone = !n ? STATUS.grey : n.days <= 1 ? STATUS.purple : STATUS.grey;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        ha-card { box-sizing: border-box; height: 100%; min-height: 66px; display: flex; align-items: center; gap: 14px; padding: 8px 14px;
          border-radius: 22px; background: ${GLASS_BG}; border: ${GLASS_BORDER}; box-shadow: ${GLASS_EDGE}; color: #fff; }
        .ic { flex: none; display: flex; align-items: flex-end; }
        .ic .binsvg { width: 34px; height: 43px; }
        .ic .binsvg + .binsvg { margin-left: -9px; }
        .t { min-width: 0; flex: 1 1 auto; }
        .n { font-size: 15.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s { font-size: 13px; color: #a29db8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
        .s b { color: #e9e2ff; font-weight: 600; }
        .m { flex: 0 1 auto; min-width: 0; font-size: 13px; color: #a29db8; line-height: 1.45; }
        .m b { color: #fff; font-weight: 600; }
        .m div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cd { flex: none; padding: 7px 12px; border-radius: 14px; font-size: 13.5px; font-weight: 700; white-space: nowrap;
          color: ${tone === STATUS.grey ? "#d8d4e8" : `rgb(${tone})`}; background: rgba(${tone},0.16); border: 1px solid rgba(${tone},0.28); }
        .narrow .m { display: none; }
        .narrow { gap: 10px; }
      </style>
      <ha-card class="${this.clientWidth && this.clientWidth < 520 ? "narrow" : ""}" aria-label="Bin collection">
        <div class="ic">${types.length ? n.bins.map(binSvg).join("") : `<ha-icon icon="mdi:delete-outline"></ha-icon>`}</div>
        <div class="t"><div class="n">Bin collection</div>
          <div class="s">${n ? `Next collection: <b>${binDateText(n.date, false)}</b>` : "No more dates in the schedule"}</div></div>
        ${n ? `<div class="m"><div>Bins: <b>${types.map((b) => b.short).join(" + ")}</b></div><div>Waste: <b>${types.map((b) => b.waste).join(" + ")}</b></div></div>
        <div class="cd">${count}</div>` : ""}
      </ha-card>`;
  }
}

// Read-only access to the schedule logic (handy for checking dates from the browser console)
window.GlassHomeBins = Object.freeze({ types: BIN_TYPES, schedule: BIN_SCHEDULE, reminder: binReminder, next: nextBinCollection });

/*
 * Glass Home Heating card: the Climate page's heating control centre for the Hive thermostat.
 *
 *   type: custom:glasshome-heating-card
 *   section: control | schedule | insights      # one card per section, so each can sit in the page grid
 *   (entity ids come from heating: in the glasshome: settings through the dashboard's [[heating.*]] tokens)
 *
 * control:  live temperature, target −/+, heating activity, mode (Schedule / Manual / Off) and Hive boost.
 * schedule: the weekly heating schedule. This is Home Assistant's schedule helper, run by the
 *           "Heating schedule control" automation with the Hive in Manual. Home Assistant's Hive
 *           integration cannot read or write the Hive app's own schedule, so the card never shows
 *           this as the Hive app schedule. Each period carries its own temperature (block data);
 *           between periods the eco temperature applies.
 * insights: the last 24 hours of indoor and target temperature with boiler activity, and boiler
 *           running time per day for the last 7 days, all from Home Assistant's history.
 * Every control calls the real Hive services and waits for the Hive to confirm the change.
 */
const HEAT_DEFAULTS = {
  entity: "climate.thermostat", schedule: "schedule.heating_schedule", control: "automation.heating_schedule_control",
  comfort: "input_number.heating_comfort", eco: "input_number.heating_eco", current: "sensor.thermostat_current_temperature",
  target: "sensor.thermostat_target_temperature", boiler: "binary_sensor.thermostat_state", boost: "binary_sensor.thermostat_boost",
  hub: "binary_sensor.hive_hub_status", battery: "sensor.thermostat_battery_level", boost_key: "glasshome_heating_boost",
};
const HC_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const HC_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HC_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HC_BAD = ["unavailable", "unknown"];
const HC_BOOSTS = [[30, "30 min"], [60, "1 hour"], [120, "2 hours"], [180, "3 hours"]];
const hcNum = (v) => { const n = Number(v); return v !== null && v !== "" && Number.isFinite(n) ? n : null; };
const hcT = (n) => (n == null ? "–" : `${n.toFixed(1)}°`);
const hcMin = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + (m || 0); };
const hcHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hcToday = () => (new Date().getDay() + 6) % 7;
const hcNowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hcDur = (min) => (min < 60 ? `${Math.round(min)} min` : `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`);
const hcIcon = (name) => `<ha-icon icon="mdi:${name}"></ha-icon>`;

// Temperature colours: cool slate for frost/setback, purple for eco, amber to red as it gets warmer
const HC_STOPS = [[7, [91, 107, 140]], [15, [124, 108, 240]], [18, [214, 140, 70]], [21, [249, 115, 22]], [25, [239, 68, 68]]];
function hcCol(t) {
  if (t <= HC_STOPS[0][0]) return `rgb(${HC_STOPS[0][1]})`;
  for (let i = 1; i < HC_STOPS.length; i++) {
    const [t1, c1] = HC_STOPS[i], [t0, c0] = HC_STOPS[i - 1];
    if (t <= t1) { const f = (t - t0) / (t1 - t0); return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * f))})`; }
  }
  return `rgb(${HC_STOPS[HC_STOPS.length - 1][1]})`;
}

// The schedule helper's configuration, fetched once and shared by every section
const HEAT_SCHED = { stamp: null, t: 0, p: null };
function heatSchedule(hass, entity, force = false) {
  const st = hass.states[entity], stamp = st ? st.last_updated : "";
  if (force || !HEAT_SCHED.p || HEAT_SCHED.stamp !== stamp || Date.now() - HEAT_SCHED.t > 600000) {
    HEAT_SCHED.stamp = stamp;
    HEAT_SCHED.t = Date.now();
    HEAT_SCHED.p = hass.callWS({ type: "schedule/list" })
      .then((list) => list.find((s) => `schedule.${s.id}` === entity) || null).catch(() => null);
  }
  return HEAT_SCHED.p;
}

// A day as editable periods in minutes: [{ a, b, t }] (b may be 1440 = midnight at the end of the day)
const hcPeriods = (sched, day, comfort) => ((sched && sched[day]) || [])
  .map((p) => ({ a: hcMin(p.from), b: hcMin(p.to) || 1440, t: hcNum(p.data && p.data.temperature) ?? comfort }))
  .sort((x, y) => x.a - y.a);

// The whole day as segments, with the eco temperature filling the gaps between periods
function hcSegments(periods, eco) {
  const out = [];
  let at = 0;
  for (const p of periods) {
    if (p.a > at) out.push({ a: at, b: p.a, t: eco, p: false });
    out.push({ ...p, p: true });
    at = p.b;
  }
  if (at < 1440) out.push({ a: at, b: 1440, t: eco, p: false });
  return out;
}

// The next time the scheduled temperature changes: { k: days ahead, a: minute of that day, t }
function hcNext(week, eco) {
  const d = hcToday(), now = hcNowMin();
  const today = hcSegments(week[d], eco);
  let cur = (today.find((s) => s.a <= now && now < s.b) || today[0]).t;
  for (let k = 0; k < 8; k++) {
    for (const s of hcSegments(week[(d + k) % 7], eco)) {
      if (k === 0 && s.a <= now) continue;
      if (Math.abs(s.t - cur) > 0.01) return { k, a: s.a, t: s.t };
      cur = s.t;
    }
  }
  return null;
}
const hcWhen = (n) => (!n ? "" : n.k === 0 ? hcHHMM(n.a) : n.k === 1 ? `tomorrow ${hcHHMM(n.a)}` : `${HC_SHORT[(hcToday() + n.k) % 7]} ${hcHHMM(n.a)}`);

// Ambient glow of the thermostat card from the real indoor temperature, blended smoothly between the stops
// (icy blue when cold to rich gold when warm). Neutral when there is no reading.
const HC_GLOW_STOPS = [[16, [125, 200, 255]], [17, [96, 165, 250]], [18, [128, 150, 196]], [19, [190, 176, 164]],
  [20, [246, 178, 92]], [21, [250, 192, 52]], [22, [245, 158, 11]]];
const HC_GLOW_NEUTRAL = "rgba(167,160,190,0.10)";
// a registered colour property can be eased by the browser; it lives on the card element itself, which is
// never rebuilt, so the glow fades smoothly however often the card redraws
try { if (window.CSS && CSS.registerProperty) CSS.registerProperty({ name: "--hc-glow", syntax: "<color>", inherits: true, initialValue: "rgba(167,160,190,0.10)" }); }
catch (e) { /* already registered */ }
function hcGlow(t) {
  if (t == null || !Number.isFinite(t)) return HC_GLOW_NEUTRAL;
  const S = HC_GLOW_STOPS;
  let rgb = S[S.length - 1][1];
  if (t <= S[0][0]) rgb = S[0][1];
  else for (let k = 1; k < S.length; k++) {
    if (t <= S[k][0]) {
      const [t0, a] = S[k - 1], [t1, b] = S[k], f = (t - t0) / (t1 - t0);
      rgb = a.map((v, j) => Math.round(v + (b[j] - v) * f));
      break;
    }
  }
  return `rgba(${rgb.join(",")},0.30)`;
}

const HC_CSS = `
  :host { display: block; }
  ha-card { box-sizing: border-box; padding: 16px 18px 14px; border-radius: 26px; color: #fff; background: ${GLASS_BG}; border: ${GLASS_BORDER};
    box-shadow: ${GLASS_EDGE}; -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }
  button { font: inherit; color: #fff; border: 0; cursor: pointer; border-radius: 16px; background: rgba(255,255,255,0.08);
    min-height: 48px; min-width: 48px; padding: 0 14px; font-size: 15px; font-weight: 600; display: inline-flex; align-items: center;
    justify-content: center; gap: 7px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  button:active { background: rgba(255,255,255,0.18); }
  button:disabled { opacity: 0.35; }
  button.pri { background: linear-gradient(160deg, rgba(139,92,246,0.85), rgba(109,40,217,0.65)); box-shadow: 0 0 16px rgba(139,92,246,0.3); }
  button.ghost { background: transparent; color: #c9c4dc; }
  button ha-icon { --mdc-icon-size: 21px; }
  .hd { display: flex; align-items: center; gap: 12px; }
  .hd > ha-icon { --mdc-icon-size: 24px; width: 46px; height: 46px; flex: none; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; color: #fdba74; background: rgba(249,115,22,0.15); }
  .hd .t { flex: 1; min-width: 0; }
  .hd .n { font-size: 19px; font-weight: 700; letter-spacing: -0.2px; }
  .hd .s { font-size: 13.5px; color: #a29db8; margin-top: 2px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 14px; font-size: 13px; font-weight: 600;
    background: rgba(var(--c),0.14); color: rgb(var(--c)); white-space: nowrap; }
  .chip ha-icon { --mdc-icon-size: 16px; }
  .msg { min-height: 18px; margin-top: 8px; font-size: 14px; color: #a29db8; display: flex; align-items: center; gap: 6px; }
  .msg.ok { color: rgb(${STATUS.green}); } .msg.warn { color: rgb(${STATUS.amber}); } .msg.err { color: rgb(${STATUS.red}); }
  .msg ha-icon { --mdc-icon-size: 18px; }
  .note { font-size: 14px; color: #c9c4dc; line-height: 1.4; }
  .note b { color: #fff; }
  .warnbox { margin-top: 12px; padding: 10px 12px; border-radius: 16px; background: rgba(${STATUS.amber},0.12); color: #ffd79a;
    font-size: 14px; display: flex; align-items: center; gap: 10px; }
  .warnbox span { flex: 1; }
  /* compact (compact: true): the same content, tighter, so the Climate page fits the wall tablet on one
     screen. Buttons stay at least 46px tall for touch. */
  :host([compact]) ha-card { padding: 12px 16px 10px; }
  :host([compact]) .hd > ha-icon { width: 40px; height: 40px; --mdc-icon-size: 22px; }
  :host([compact]) .hd .n { font-size: 17.5px; }
  :host([compact]) .hd .s { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  :host([compact]) .msg:empty { min-height: 0; margin-top: 0; }
  :host([compact]) .main { margin-top: 6px; gap: 14px; }
  :host([compact]) .big { font-size: 62px; margin: 0 0 4px; }
  :host([compact]) .big sup { font-size: 28px; vertical-align: 22px; }
  :host([compact]) .tgt { padding: 8px 12px; }
  :host([compact]) .tgt .row { margin-top: 2px; }
  :host([compact]) .tgt button { width: 52px; height: 52px; }
  :host([compact]) .tv { font-size: 36px; }
  :host([compact]) .tnote { margin-top: 2px; }
  :host([compact]) .seg { padding: 4px; }
  :host([compact]) .seg button, :host([compact]) .boostbtn { min-height: 46px; }
  :host([compact]) .axis { margin: 4px 0 2px; }
  :host([compact]) .day { min-height: 26px; }
  :host([compact]) .bar { height: 20px; border-radius: 7px; }
  :host([compact]) .foot { margin-top: 4px; }
  :host([compact]) .stats { margin-top: 8px; }
  :host([compact]) .stat { padding: 6px 10px; }
  :host([compact]) .cols { margin-top: 8px; }
`;

// Narrow: the target temperature control moves under the current temperature, modes and boost stack;
// in the schedule editor each period's value sits above its two buttons; insights stats go two by two
const NARROW_CSS_HEATING = `
  :host { container-type: inline-size; }
  @container (max-width: 560px) {
    .hd { flex-wrap: wrap; row-gap: 8px; }
    .hd > .t { flex: 1 1 180px; }
    .hd > .chips { flex: 1 1 100%; justify-content: flex-start; padding-left: 58px; }
    .hd > .tag { margin-left: 58px; }
    .main { grid-template-columns: minmax(0, 1fr); }
    .tgt .row { justify-content: center; }
    .modes { grid-template-columns: minmax(0, 1fr); }
    .durs { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .per { grid-template-columns: 8px repeat(3, minmax(0, 1fr)) 40px; gap: 6px; }
    .grp { flex-wrap: wrap; }
    .grp .val { order: -1; flex: 1 1 100%; }
    .grp button { flex: 1; width: auto; min-width: 0; }
    .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cols { grid-template-columns: minmax(0, 1fr); }
    /* the 24-hour chart is drawn 560 wide, so its labels are enlarged to stay readable once shrunk */
    .cols > div:first-child svg text { font-size: 17px; }
  }`;

class GlassHomeHeatingCard extends HTMLElement {
  setConfig(config) {
    this._config = { section: "control", ...HEAT_DEFAULTS, ...config };
    this.toggleAttribute("compact", !!this._config.compact);
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._click(e));
    }
    this._key = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._hidden) return;
    this._update();
  }

  getCardSize() {
    return this._config.section === "control" ? 6 : 5;
  }

  // Off screen (another page of the pager): skip updates and timers, catch up on return
  connectedCallback() {
    if (!this._io && "IntersectionObserver" in window) {
      this._io = new IntersectionObserver((es) => es.forEach((e) => {
        this._hidden = !e.isIntersecting;
        if (!this._hidden && this._hass) this._update();
        this._timers();
      }));
      this._io.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    this._hidden = true;
    this._timers();
    clearTimeout(this._sendT);
    clearTimeout(this._msgT);
  }

  _st(k) {
    return this._hass && this._hass.states[this._config[k]];
  }

  _num(k, attr) {
    const s = this._st(k);
    if (!s || HC_BAD.includes(s.state)) return null;
    return hcNum(attr ? s.attributes[attr] : s.state);
  }

  // ------------------------------------------------------------------ shared state
  _mode() {
    const c = this._st("entity"), ctl = this._st("control");
    if (!c || HC_BAD.includes(c.state)) return "offline";
    if (c.state === "off") return "off";
    if (ctl && ctl.state === "on") return "schedule";
    if (c.state === "heat") return "manual";
    return "hive";
  }

  _boostOn() {
    const c = this._st("entity"), b = this._st("boost");
    return (b && b.state === "on") || (c && c.attributes.preset_mode === "boost");
  }

  _week(sched, comfort) {
    return HC_DAYS.map((d) => hcPeriods(sched, d, comfort));
  }

  _update() {
    const s = this._config.section;
    if (s === "schedule") this._updSchedule();
    else if (s === "insights") this._updInsights();
    else this._updControl();
  }

  _timers() {
    const want = !this._hidden && this.isConnected;
    // Boost countdown: once a minute while a boost is running and the card is on screen
    const boost = want && this._config.section === "control" && this._boostOn();
    if (boost && !this._tick) this._tick = setInterval(() => { this._key = null; this._updControl(); }, 30000);
    if (!boost && this._tick) { clearInterval(this._tick); this._tick = null; }
    // Insights refresh every 15 minutes while visible
    const ins = want && this._config.section === "insights";
    if (ins && !this._insT) this._insT = setInterval(() => this._loadHistory(), 900000);
    if (!ins && this._insT) { clearInterval(this._insT); this._insT = null; }
  }

  // Run a real service call, then wait until the Hive reports the change (or say that it has not yet)
  async _act(label, call, confirmed) {
    clearTimeout(this._msgT);
    this._msg = { text: `${label}…`, tone: "", icon: "progress-clock" };
    this._pending = confirmed;
    this._pendingLabel = label;
    this._key = null;
    this._update();
    try {
      await call();
    } catch (err) {
      this._pending = null;
      this._msg = { text: `Could not send: ${err && err.message ? err.message : "error"}`, tone: "err", icon: "alert-circle" };
      this._key = null;
      this._update();
      return;
    }
    this._checkPending();
    if (this._pending) {
      this._msgT = setTimeout(() => {
        if (!this._pending) return;
        this._pending = null;
        this._msg = { text: `${label}: sent, but the Hive has not confirmed it yet`, tone: "warn", icon: "clock-alert-outline" };
        this._key = null;
        this._update();
      }, 30000);
    }
  }

  _checkPending() {
    if (!this._pending || !this._pending(this._hass)) return;
    this._pending = null;
    clearTimeout(this._msgT);
    this._msg = { text: `${this._pendingLabel}: confirmed by the Hive`, tone: "ok", icon: "check-circle" };
    this._draft = null;
    this._key = null;
    this._msgT = setTimeout(() => { this._msg = null; this._key = null; this._update(); }, 6000);
  }

  _call(domain, service, data, target) {
    return this._hass.callService(domain, service, data, target);
  }

  _click(e) {
    const b = e.composedPath().find((n) => n.dataset && n.dataset.act);
    if (!b || b.disabled) return;
    const s = this._config.section;
    if (s === "schedule") this._schedClick(b.dataset.act, b.dataset);
    else if (s === "insights") { if (b.dataset.act === "reload") this._loadHistory(); }
    else this._ctlClick(b.dataset.act, b.dataset);
  }

  // ------------------------------------------------------------------ control section
  _updControl() {
    if (!this._hass) return;
    this._checkPending();
    const c = this._config, keys = ["entity", "control", "boost", "boiler", "hub", "battery", "current", "schedule", "eco", "comfort"];
    const key = JSON.stringify([keys.map((k) => { const s = this._st(k); return s ? [s.state, s.last_updated] : null; }),
      this._draft, this._msg, this._boostUi, this._boostInfo && this._boostInfo.end, !!this._sched]);
    if (!this._boostLoaded) {
      this._boostLoaded = true;
      this._hass.callWS({ type: "frontend/get_system_data", key: c.boost_key })
        .then((r) => { this._boostInfo = r && r.value; this._key = null; this._updControl(); }).catch(() => {});
    }
    heatSchedule(this._hass, c.schedule).then((s) => { if (s !== this._sched) { this._sched = s; this._key = null; this._updControl(); } });
    this._timers();
    if (key === this._key) return;
    this._key = key;
    this._renderControl();
  }

  _renderControl() {
    const c = this._config, cl = this._st("entity"), a = (cl && cl.attributes) || {};
    const mode = this._mode(), boost = this._boostOn();
    const cur = this._num("current") ?? hcNum(a.current_temperature), target = hcNum(a.temperature);
    const glow = hcGlow(cur);
    const shown = this._draft ?? target, eco = this._num("eco") ?? 16, comfort = this._num("comfort") ?? 20;
    const heating = a.hvac_action === "heating" || (this._st("boiler") || {}).state === "on";
    const hub = this._st("hub"), batt = this._num("battery");
    const conn = mode === "offline" ? ["Thermostat offline", STATUS.red, "wifi-off"]
      : hub && hub.state !== "on" ? ["Hive hub offline", STATUS.red, "access-point-network-off"] : ["Hub connected", STATUS.green, "access-point-network"];
    const chips = `<span class="chip" style="--c:${conn[1]}">${hcIcon(conn[2])}${conn[0]}</span>`
      + (batt != null ? `<span class="chip" style="--c:${batt < 25 ? STATUS.amber : STATUS.grey}">${hcIcon(batt < 25 ? "battery-low" : "battery-medium")}${Math.round(batt)}%</span>` : "");

    // What the thermostat is doing, in words
    const week = this._sched ? this._week(this._sched, comfort) : null;
    const next = week ? hcNext(week, eco) : null;
    const schedOn = (this._st("schedule") || {}).state === "on";
    const expected = schedOn ? (hcNum((this._st("schedule").attributes || {}).temperature) ?? comfort) : eco;
    let line = "", warn = "";
    if (mode === "offline") line = "The thermostat is not reachable, so it cannot be controlled right now.";
    else if (boost) line = `<b>Boost</b> is running. Afterwards the thermostat goes back to ${mode === "schedule" ? "your schedule" : mode === "off" ? "off" : "its previous setting"}.`;
    else if (mode === "schedule") {
      const nx = next ? ` · next change <b>${hcWhen(next)}</b> → <b>${hcT(next.t)}</b>` : "";
      line = target != null && Math.abs(target - expected) > 0.25
        ? `<b>Temporary override</b> of the schedule (${hcT(expected)}) until ${next ? `<b>${hcWhen(next)}</b>` : "the next change"}, then the schedule continues.`
        : `<b>Following your schedule</b>${nx}`;
      if (cl.state !== "heat") warn = "The Hive has switched back to its own app schedule. Re-apply the dashboard schedule to take control again.";
    } else if (mode === "manual") line = "<b>Manual</b>: holds this temperature until you change it. The schedule is paused.";
    else if (mode === "off") line = "<b>Heating off</b>. The Hive keeps frost protection on (7°). The schedule is paused.";
    else line = "The Hive is following its <b>own app schedule</b>. Choose Schedule to use the dashboard schedule instead.";
    const pendingNote = this._draft != null && mode === "schedule" && !boost
      ? `<div class="tnote">Temporary · until ${next ? hcWhen(next) : "the next change"}</div>`
      : this._draft != null ? `<div class="tnote">Sending…</div>` : `<div class="tnote">${mode === "schedule" ? "Schedule" : mode === "manual" ? "Manual" : ""}</div>`;
    const canSet = !["off", "offline"].includes(mode) && !boost;

    const seg = [["schedule", "Schedule", "calendar-clock"], ["manual", "Manual", "hand-back-right-outline"], ["off", "Off", "power"]]
      .map(([m, l, i]) => `<button data-act="mode" data-m="${m}" class="${mode === m ? "on" : ""}" ${mode === "offline" ? "disabled" : ""}>${hcIcon(i)}${l}</button>`).join("");

    // Boost
    let boostHtml;
    const info = this._boostInfo, left = boost && info && info.end > Date.now() ? (info.end - Date.now()) / 60000 : null;
    if (boost) {
      boostHtml = `<div class="boost on"><div class="bi">${hcIcon("fire")}</div><div class="bt"><b>Boost on · ${hcT(target)}</b>
        <span>${left != null ? `${hcDur(left)} left` : "Started outside the dashboard, so the time left is not known"}</span></div>
        <button data-act="boost-off">${hcIcon("close")}Cancel boost</button></div>`;
    } else if (this._boostUi) {
      const u = this._boostUi;
      boostHtml = `<div class="boost pick"><div class="bh"><b>Boost</b><span>Heats to the boost temperature, then returns to the current mode</span></div>
        <div class="durs">${HC_BOOSTS.map(([m, l]) => `<button data-act="bdur" data-m="${m}" class="${u.min === m ? "on" : ""}">${l}</button>`).join("")}</div>
        <div class="brow"><span>Temperature</span><button data-act="btemp" data-d="-0.5">${hcIcon("minus")}</button><div class="bv">${hcT(u.t)}</div>
          <button data-act="btemp" data-d="0.5">${hcIcon("plus")}</button>
          <button class="ghost" data-act="boost-close">Close</button><button class="pri" data-act="boost-on">${hcIcon("fire")}Start boost</button></div></div>`;
    } else {
      boostHtml = `<button class="boostbtn" data-act="boost-open" ${mode === "offline" ? "disabled" : ""}>${hcIcon("fire")}Boost</button>`;
    }

    const m = this._msg;
    this.shadowRoot.innerHTML = `<style>${HC_CSS}
        .chips { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
        .main { display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; margin-top: 10px; }
        .lab { font-size: 13px; color: #a29db8; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase; }
        .big { font-size: 76px; font-weight: 300; letter-spacing: -3px; line-height: 0.95; margin: 2px 0 6px; font-variant-numeric: tabular-nums; }
        .big sup { font-size: 34px; letter-spacing: 0; vertical-align: 28px; margin-left: 2px; }
        .act { display: inline-flex; align-items: center; gap: 7px; font-size: 15px; font-weight: 600; color: #8e8aa0; }
        .act ha-icon { --mdc-icon-size: 20px; }
        .act.on { color: #fdba74; }
        .tgt { text-align: center; padding: 12px 14px; border-radius: 22px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07); }
        .tgt .row { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
        .tgt button { width: 64px; height: 64px; border-radius: 50%; --mdc-icon-size: 28px; padding: 0; }
        .tv { font-size: 40px; font-weight: 600; min-width: 112px; font-variant-numeric: tabular-nums; }
        .tv.draft { color: #c4b5fd; }
        .tnote { font-size: 13px; color: #a29db8; margin-top: 6px; min-height: 17px; }
        .line { margin-top: 10px; }
        .modes { display: grid; grid-template-columns: 3fr 1fr; gap: 8px; margin-top: 12px; align-items: stretch; }
        .seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 5px; border-radius: 20px;
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07); }
        .seg button { min-height: 56px; background: transparent; color: #c9c4dc; font-size: 16px; }
        .seg button.on { color: #fff; background: linear-gradient(160deg, rgba(139,92,246,0.75), rgba(109,40,217,0.55)); box-shadow: 0 0 16px rgba(139,92,246,0.3); }
        .boostbtn { width: 100%; height: 100%; min-height: 56px; font-size: 16px; border-radius: 20px; color: #fdba74; background: rgba(249,115,22,0.12); }
        .boost { margin-top: 10px; padding: 12px; border-radius: 20px; background: rgba(249,115,22,0.10); border: 1px solid rgba(249,115,22,0.25); }
        .boost.on { display: flex; align-items: center; gap: 12px; }
        .bi { width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: rgba(249,115,22,0.2); color: #fdba74; flex: none; }
        .bt { flex: 1; min-width: 0; } .bt b { display: block; font-size: 17px; } .bt span { font-size: 13.5px; color: #e8c7a8; }
        .bh b { font-size: 16px; } .bh span { display: block; font-size: 13px; color: #c9b8a8; margin-top: 2px; }
        .durs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; }
        .durs button.on, .boost .pri { background: linear-gradient(160deg, rgba(249,115,22,0.85), rgba(234,88,12,0.7)); box-shadow: none; }
        .brow { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
        .brow > span { font-size: 14px; color: #e8c7a8; margin-right: 2px; }
        .bv { font-size: 22px; font-weight: 600; min-width: 70px; text-align: center; }
        .brow .ghost { margin-left: auto; }
        ${NARROW_CSS_HEATING}
        ha-card { position: relative; isolation: isolate; overflow: hidden; }
        .amb { position: absolute; inset: 0; z-index: -1; pointer-events: none; background-color: var(--hc-glow, ${HC_GLOW_NEUTRAL});
          -webkit-mask-image: radial-gradient(130% 95% at 12% 0%, #000 0%, rgba(0,0,0,0.45) 45%, transparent 78%);
          mask-image: radial-gradient(130% 95% at 12% 0%, #000 0%, rgba(0,0,0,0.45) 45%, transparent 78%); }
      </style>
      <ha-card>
        <div class="amb"></div>
        <div class="hd">${hcIcon("thermostat")}<div class="t"><div class="n">${esc(c.title || "Thermostat")}</div><div class="s">Hive · ${esc(a.friendly_name || "Thermostat")}</div></div>
          <div class="chips">${chips}</div></div>
        <div class="main">
          <div><div class="lab">Indoor now</div><div class="big">${cur != null ? cur.toFixed(1) : "–"}<sup>°</sup></div>
            <div class="act ${heating ? "on" : ""}">${hcIcon(heating ? "fire" : "fire-off")}${heating ? "Heating now" : "Not heating"}</div></div>
          <div class="tgt"><div class="lab">Target</div>
            <div class="row"><button data-act="t" data-d="-0.5" ${canSet ? "" : "disabled"} aria-label="Lower">${hcIcon("minus")}</button>
              <div class="tv ${this._draft != null ? "draft" : ""}">${hcT(shown)}</div>
              <button data-act="t" data-d="0.5" ${canSet ? "" : "disabled"} aria-label="Raise">${hcIcon("plus")}</button></div>${pendingNote}</div>
        </div>
        <div class="note line">${line}</div>
        ${warn ? `<div class="warnbox">${hcIcon("alert")}<span>${warn}</span><button data-act="reapply">Re-apply</button></div>` : ""}
        ${boost || this._boostUi ? `<div class="seg" style="margin-top:12px">${seg}</div>${boostHtml}` : `<div class="modes"><div class="seg">${seg}</div>${boostHtml}</div>`}
        <div class="msg ${m ? m.tone : ""}">${m ? `${hcIcon(m.icon)}${esc(m.text)}` : ""}</div>
      </ha-card>`;
    // the glow eases from the colour it had to the new one (first paint: straight to it)
    if (this._glow !== glow) {
      const ease = this._glow && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.style.transition = ease ? "--hc-glow 2.4s ease" : "none";
      this.style.setProperty("--hc-glow", glow);
      this._glow = glow;
    }
  }

  // The Hive is in Heat at the temperature the schedule asks for right now
  _atSchedule(hs) {
    const c = this._config, cl = hs.states[c.entity], sc = hs.states[c.schedule];
    const num = (e) => hcNum(hs.states[e] && hs.states[e].state);
    const want = sc && sc.state === "on" ? (hcNum(sc.attributes.temperature) ?? num(c.comfort) ?? 20) : (num(c.eco) ?? 16);
    return cl.state === "heat" && Math.abs((hcNum(cl.attributes.temperature) ?? -99) - want) < 0.01;
  }

  _ctlClick(act, d) {
    const c = this._config, h = this._hass, cl = this._st("entity"), a = (cl && cl.attributes) || {};
    const ent = { entity_id: c.entity };
    if (act === "t") {
      const lo = hcNum(a.min_temp) ?? 5, hi = hcNum(a.max_temp) ?? 32;
      const base = this._draft ?? hcNum(a.temperature) ?? 20;
      this._draft = Math.min(hi, Math.max(lo, Math.round((base + Number(d.d)) * 2) / 2));
      this._key = null;
      this._updControl();
      // Taps are gathered for a moment, then one change is sent to the Hive
      clearTimeout(this._sendT);
      this._sendT = setTimeout(() => {
        const t = this._draft;
        this._act(`Target ${hcT(t)}`, () => this._call("climate", "set_temperature", { temperature: t }, ent),
          (hs) => Math.abs((hcNum(hs.states[c.entity].attributes.temperature) ?? -99) - t) < 0.01);
      }, 1100);
    } else if (act === "mode") {
      const m = d.m;
      if (m === this._mode()) return;
      if (m === "schedule") {
        this._act("Following the schedule", async () => {
          await this._call("automation", "turn_on", {}, { entity_id: c.control });
          await this._call("automation", "trigger", { skip_condition: false }, { entity_id: c.control });
        }, (hs) => hs.states[c.control].state === "on" && this._atSchedule(hs));
      } else if (m === "manual") {
        this._act("Manual mode", async () => {
          await this._call("automation", "turn_off", {}, { entity_id: c.control });
          await this._call("climate", "set_hvac_mode", { hvac_mode: "heat" }, ent);
        }, (hs) => hs.states[c.control].state === "off" && hs.states[c.entity].state === "heat");
      } else if (m === "off") {
        this._act("Heating off", async () => {
          await this._call("automation", "turn_off", {}, { entity_id: c.control });
          await this._call("climate", "set_hvac_mode", { hvac_mode: "off" }, ent);
        }, (hs) => hs.states[c.entity].state === "off");
      }
    } else if (act === "reapply") {
      this._act("Re-applying the schedule", () => this._call("automation", "trigger", { skip_condition: false }, { entity_id: c.control }),
        (hs) => this._atSchedule(hs));
    } else if (act === "boost-open") {
      const t = hcNum(a.temperature) ?? 20;
      this._boostUi = { min: 60, t: Math.min(25, Math.max(18, Math.round((t + 1) * 2) / 2)) };
      this._key = null;
      this._updControl();
    } else if (act === "boost-close") {
      this._boostUi = null;
      this._key = null;
      this._updControl();
    } else if (act === "bdur") {
      this._boostUi.min = Number(d.m);
      this._key = null;
      this._updControl();
    } else if (act === "btemp") {
      this._boostUi.t = Math.min(32, Math.max(7, this._boostUi.t + Number(d.d)));
      this._key = null;
      this._updControl();
    } else if (act === "boost-on") {
      const { min, t } = this._boostUi;
      this._boostUi = null;
      this._act(`Boost ${hcT(t)} for ${hcDur(min)}`, async () => {
        await this._call("hive", "boost_heating_on", { time_period: `${hcHHMM(min)}:00`, temperature: t }, ent);
        // Remember when it ends so the countdown is shown on every screen (Hive does not report it)
        this._boostInfo = { end: Date.now() + min * 60000, temperature: t, minutes: min };
        h.callWS({ type: "frontend/set_system_data", key: c.boost_key, value: this._boostInfo }).catch(() => {});
      }, (hs) => (hs.states[c.boost] && hs.states[c.boost].state === "on") || hs.states[c.entity].attributes.preset_mode === "boost");
    } else if (act === "boost-off") {
      this._act("Boost cancelled", async () => {
        await this._call("hive", "boost_heating_off", { entity_id: c.entity });
        this._boostInfo = null;
        h.callWS({ type: "frontend/set_system_data", key: c.boost_key, value: null }).catch(() => {});
      }, (hs) => !((hs.states[c.boost] && hs.states[c.boost].state === "on") || hs.states[c.entity].attributes.preset_mode === "boost"));
    }
  }

  // ------------------------------------------------------------------ schedule section
  _updSchedule() {
    if (!this._hass) return;
    const c = this._config;
    heatSchedule(this._hass, c.schedule).then((s) => { if (s !== this._sched) { this._sched = s; this._key = null; this._updSchedule(); } });
    // Redraw the "now" line every few minutes at most, and when anything relevant changes
    const key = JSON.stringify([["control", "schedule", "eco", "comfort", "entity"].map((k) => { const s = this._st(k); return s ? [s.state, s.last_updated] : null; }),
      !!this._sched, this._ed, this._msg, Math.floor(Date.now() / 300000)]);
    if (key === this._key) return;
    this._key = key;
    if (this._ed) this._renderEditor();
    else this._renderWeek();
  }

  _bar(segs, nowMin) {
    const blocks = segs.map((s) => {
      const w = ((s.b - s.a) / 1440) * 100;
      return `<div class="sg ${s.p ? "p" : ""}" style="left:${((s.a / 1440) * 100).toFixed(3)}%;width:${w.toFixed(3)}%;background:${hcCol(s.t)}">${s.p && w > 7 ? `${s.t.toFixed(s.t % 1 ? 1 : 0)}°` : ""}</div>`;
    }).join("");
    const now = nowMin != null ? `<div class="nowl" style="left:${((nowMin / 1440) * 100).toFixed(3)}%"></div>` : "";
    return `<div class="bar">${blocks}${now}</div>`;
  }

  _schedCss() {
    return `<style>${HC_CSS}
      .hd > ha-icon { color: #c4b5fd; background: rgba(139,92,246,0.18); }
      .tag { font-size: 12px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; color: #c4b5fd; padding: 6px 10px;
        border-radius: 12px; background: rgba(139,92,246,0.16); white-space: nowrap; }
      .axis { display: grid; grid-template-columns: 54px 1fr; margin: 8px 0 2px; }
      .ticks { position: relative; height: 14px; font-size: 11.5px; color: #8e8aa0; }
      .ticks span { position: absolute; transform: translateX(-50%); }
      .ticks span:first-child { transform: none; } .ticks span:last-child { transform: translateX(-100%); }
      .day { display: grid; grid-template-columns: 54px 1fr; align-items: center; min-height: 33px; border-radius: 14px; cursor: pointer; }
      .day:active { background: rgba(255,255,255,0.06); }
      .day .dn { font-size: 15px; font-weight: 600; color: #c9c4dc; padding-left: 4px; }
      .day.today .dn { color: #fff; }
      .day.today .dn::after { content: ""; display: inline-block; width: 6px; height: 6px; border-radius: 3px; background: #a78bfa; margin-left: 6px; vertical-align: middle; }
      .bar { position: relative; height: 25px; border-radius: 9px; overflow: hidden; background: rgba(255,255,255,0.04); }
      .day.today .bar { box-shadow: 0 0 0 2px rgba(167,139,250,0.55); }
      .sg { position: absolute; top: 0; bottom: 0; opacity: 0.38; font-size: 12px; font-weight: 700; color: #fff; display: flex; align-items: center;
        justify-content: center; overflow: hidden; white-space: nowrap; }
      .sg.p { opacity: 0.95; border-left: 1px solid rgba(0,0,0,0.25); border-right: 1px solid rgba(0,0,0,0.25); }
      .nowl { position: absolute; top: -2px; bottom: -2px; width: 3px; margin-left: -1px; background: #fff; border-radius: 2px; }
      .foot { display: flex; align-items: center; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
      .foot .note { flex: 1; min-width: 200px; }
      .legend { display: flex; gap: 12px; font-size: 12.5px; color: #a29db8; }
      .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
      .days { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; margin-top: 12px; }
      .days button { min-height: 50px; padding: 0; font-size: 15px; background: rgba(255,255,255,0.06); }
      .days button.on { background: linear-gradient(160deg, rgba(139,92,246,0.75), rgba(109,40,217,0.55)); }
      .days button.today:not(.on) { box-shadow: inset 0 0 0 2px rgba(167,139,250,0.5); }
      .ebar { margin-top: 12px; }
      .per { display: grid; grid-template-columns: 8px 1fr 1fr 1fr 52px; gap: 8px; align-items: center; margin-top: 8px; padding: 6px;
        border-radius: 18px; background: rgba(255,255,255,0.05); }
      .sw { align-self: stretch; border-radius: 4px; }
      .grp { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
      .grp button { width: 48px; padding: 0; }
      .val { text-align: center; flex: 1; }
      .val small { display: block; font-size: 11px; color: #8e8aa0; font-weight: 600; letter-spacing: 0.3px; text-transform: uppercase; }
      .val b { font-size: 19px; font-variant-numeric: tabular-nums; }
      .del { color: #ff9a9a; padding: 0; }
      .row2 { display: flex; align-items: center; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
      .row2 > span { font-size: 14px; color: #c9c4dc; }
      .row2 .val { flex: none; min-width: 74px; }
      .grow { flex: 1; }
      .copy { margin-top: 10px; padding: 10px; border-radius: 18px; background: rgba(255,255,255,0.04); }
      .copy .days { margin-top: 8px; }
      .acts { display: flex; gap: 8px; margin-top: 12px; }
      .acts button { flex: 1; min-height: 56px; font-size: 16px; }
      .empty { padding: 14px 4px; color: #a29db8; font-size: 14px; }
      ${NARROW_CSS_HEATING}
    </style>`;
  }

  _schedHeader(sub) {
    return `<div class="hd">${hcIcon("calendar-clock")}<div class="t"><div class="n">Heating schedule</div><div class="s">${sub}</div></div>
      <span class="tag">Home Assistant schedule</span></div>`;
  }

  _renderWeek() {
    const c = this._config, mode = this._mode(), eco = this._num("eco") ?? 16, comfort = this._num("comfort") ?? 20;
    if (!this._sched) {
      this.shadowRoot.innerHTML = `${this._schedCss()}<ha-card>${this._schedHeader("Loading…")}</ha-card>`;
      return;
    }
    const week = this._week(this._sched, comfort), today = hcToday(), now = hcNowMin(), next = hcNext(week, eco);
    const rows = week.map((p, i) => `<div class="day ${i === today ? "today" : ""}" data-act="edit" data-i="${i}"><div class="dn">${HC_SHORT[i]}</div>
      ${this._bar(hcSegments(p, eco), i === today ? now : null)}</div>`).join("");
    const active = mode === "schedule";
    const status = active ? (next ? `Next change <b>${hcWhen(next)}</b> → <b>${hcT(next.t)}</b>` : "No changes coming up")
      : mode === "hive" ? "Not in use: the Hive is following its own app schedule. Choose Schedule above to use this one."
        : `Paused while the thermostat is in <b>${mode === "off" ? "Off" : mode === "manual" ? "Manual" : "an unknown state"}</b>. Choose Schedule above to follow it.`;
    this.shadowRoot.innerHTML = `${this._schedCss()}<ha-card>
      ${this._schedHeader(`Runs your Hive from Home Assistant · between periods ${hcT(eco)} · tap a day to edit`)}
      <div class="axis"><div></div><div class="ticks"><span style="left:0">00</span><span style="left:25%">06</span><span style="left:50%">12</span>
        <span style="left:75%">18</span><span style="left:100%">24</span></div></div>
      ${rows}
      <div class="foot"><div class="note">${status}</div>
        <div class="legend"><span><i style="background:${hcCol(16)}"></i>16°</span><span><i style="background:${hcCol(19)}"></i>19°</span><span><i style="background:${hcCol(21)}"></i>21°</span></div></div>
      ${this._msg ? `<div class="msg ${this._msg.tone}">${hcIcon(this._msg.icon)}${esc(this._msg.text)}</div>` : ""}
    </ha-card>`;
  }

  _openEditor(day) {
    const comfort = this._num("comfort") ?? 20;
    this._ed = { day, week: this._week(this._sched, comfort), eco: this._num("eco") ?? 16, dirty: false, copy: null };
    this._msg = null;
    this._key = null;
    this._updSchedule();
  }

  _renderEditor() {
    const e = this._ed, ps = e.week[e.day], today = hcToday();
    const days = HC_SHORT.map((d, i) => `<button data-act="day" data-i="${i}" class="${i === e.day ? "on" : ""} ${i === today ? "today" : ""}">${d}</button>`).join("");
    const rows = ps.length ? ps.map((p, i) => `<div class="per"><div class="sw" style="background:${hcCol(p.t)}"></div>
        <div class="grp"><button data-act="pa" data-i="${i}" data-d="-15">${hcIcon("minus")}</button><div class="val"><small>From</small><b>${hcHHMM(p.a)}</b></div>
          <button data-act="pa" data-i="${i}" data-d="15">${hcIcon("plus")}</button></div>
        <div class="grp"><button data-act="pb" data-i="${i}" data-d="-15">${hcIcon("minus")}</button><div class="val"><small>To</small><b>${hcHHMM(p.b)}</b></div>
          <button data-act="pb" data-i="${i}" data-d="15">${hcIcon("plus")}</button></div>
        <div class="grp"><button data-act="pt" data-i="${i}" data-d="-0.5">${hcIcon("minus")}</button><div class="val"><small>Temp</small><b>${hcT(p.t)}</b></div>
          <button data-act="pt" data-i="${i}" data-d="0.5">${hcIcon("plus")}</button></div>
        <button class="del" data-act="pdel" data-i="${i}" aria-label="Delete period">${hcIcon("trash-can-outline")}</button></div>`).join("")
      : `<div class="empty">No heating periods: ${HC_LONG[e.day]} stays at ${hcT(e.eco)} all day.</div>`;
    const copy = e.copy ? `<div class="copy"><div class="note">Copy <b>${HC_LONG[e.day]}</b> to:</div>
        <div class="days">${HC_SHORT.map((d, i) => `<button data-act="ctog" data-i="${i}" class="${e.copy.includes(i) ? "on" : ""}" ${i === e.day ? "disabled" : ""}>${d}</button>`).join("")}</div>
        <div class="row2"><button data-act="cset" data-v="wk">Weekdays</button><button data-act="cset" data-v="we">Weekend</button><button data-act="cset" data-v="all">Every day</button>
          <span class="grow"></span><button class="ghost" data-act="cclose">Cancel</button><button class="pri" data-act="capply" ${e.copy.length ? "" : "disabled"}>Copy</button></div></div>` : "";
    const free = this._gap(ps);
    this.shadowRoot.innerHTML = `${this._schedCss()}<ha-card>
      ${this._schedHeader(`Editing ${HC_LONG[e.day]} · changes apply when you save`)}
      <div class="days">${days}</div>
      <div class="ebar">${this._bar(hcSegments(ps, e.eco), e.day === today ? hcNowMin() : null)}</div>
      ${rows}
      <div class="row2"><button data-act="padd" ${free ? "" : "disabled"}>${hcIcon("plus")}Add period</button>
        <button data-act="copy">${hcIcon("content-copy")}Copy day…</button><span class="grow"></span>
        <span>Between periods</span><button data-act="eco" data-d="-0.5">${hcIcon("minus")}</button><div class="val"><b>${hcT(e.eco)}</b></div>
        <button data-act="eco" data-d="0.5">${hcIcon("plus")}</button></div>
      ${copy}
      <div class="acts"><button class="ghost" data-act="cancel">${e.dirty ? "Discard changes" : "Close"}</button>
        <button class="pri" data-act="save" ${e.dirty ? "" : "disabled"}>${hcIcon("content-save")}Save schedule</button></div>
      ${this._msg ? `<div class="msg ${this._msg.tone}">${hcIcon(this._msg.icon)}${esc(this._msg.text)}</div>` : ""}
    </ha-card>`;
  }

  // The biggest free stretch in a day (at least 30 minutes) for a new period: [start, end] or null
  _gap(ps) {
    let best = null, at = 0;
    for (const p of [...ps, { a: 1440, b: 1440 }]) {
      if (p.a - at >= 30 && (!best || p.a - at > best[1] - best[0])) best = [at, p.a];
      at = Math.max(at, p.b);
    }
    return best;
  }

  _schedClick(act, d) {
    const c = this._config, comfort = this._num("comfort") ?? 20;
    if (act === "edit") { if (this._sched) this._openEditor(Number(d.i)); return; }
    const e = this._ed;
    if (!e) return;
    const ps = e.week[e.day], i = Number(d.i), p = ps[i];
    const redraw = (dirty = true) => { if (dirty) e.dirty = true; this._key = null; this._updSchedule(); };
    if (act === "day") { e.day = i; e.copy = null; redraw(false); }
    else if (act === "pa") {
      const lo = i > 0 ? ps[i - 1].b : 0;
      p.a = Math.min(p.b - 15, Math.max(lo, p.a + Number(d.d)));
      redraw();
    } else if (act === "pb") {
      const hi = i < ps.length - 1 ? ps[i + 1].a : 1440;
      p.b = Math.max(p.a + 15, Math.min(hi, p.b + Number(d.d)));
      redraw();
    } else if (act === "pt") { p.t = Math.min(30, Math.max(5, p.t + Number(d.d))); redraw(); }
    else if (act === "pdel") { ps.splice(i, 1); redraw(); }
    else if (act === "padd") {
      const g = this._gap(ps);
      if (!g) return;
      const len = Math.min(120, g[1] - g[0]);
      ps.push({ a: g[0], b: g[0] + len, t: comfort });
      ps.sort((x, y) => x.a - y.a);
      redraw();
    } else if (act === "eco") { e.eco = Math.min(22, Math.max(5, e.eco + Number(d.d))); redraw(); }
    else if (act === "copy") { e.copy = []; redraw(false); }
    else if (act === "cclose") { e.copy = null; redraw(false); }
    else if (act === "ctog") { e.copy = e.copy.includes(i) ? e.copy.filter((x) => x !== i) : [...e.copy, i]; redraw(false); }
    else if (act === "cset") {
      const sets = { wk: [0, 1, 2, 3, 4], we: [5, 6], all: [0, 1, 2, 3, 4, 5, 6] };
      e.copy = sets[d.v].filter((x) => x !== e.day);
      redraw(false);
    } else if (act === "capply") {
      for (const k of e.copy) e.week[k] = clone(ps);
      this._msg = { text: `Copied ${HC_LONG[e.day]} to ${e.copy.map((k) => HC_SHORT[k]).join(", ")}. Save to apply.`, tone: "", icon: "content-copy" };
      e.copy = null;
      redraw();
    } else if (act === "cancel") { this._ed = null; this._msg = null; redraw(false); }
    else if (act === "save") this._saveSchedule();
  }

  async _saveSchedule() {
    const c = this._config, e = this._ed, s = this._sched;
    const msg = { type: "schedule/update", schedule_id: s.id, name: s.name };
    if (s.icon) msg.icon = s.icon;
    HC_DAYS.forEach((d, k) => {
      msg[d] = e.week[k].map((p) => ({ from: `${hcHHMM(p.a)}:00`, to: p.b >= 1440 ? "24:00:00" : `${hcHHMM(p.b)}:00`, data: { temperature: p.t } }));
    });
    this._msg = { text: "Saving…", tone: "", icon: "progress-clock" };
    this._key = null;
    this._updSchedule();
    try {
      const res = await this._hass.callWS(msg);
      if (Math.abs((this._num("eco") ?? -1) - e.eco) > 0.01) {
        await this._call("input_number", "set_value", { value: e.eco }, { entity_id: c.eco });
      }
      const saved = { ...s, ...msg, ...(res && typeof res === "object" ? res : {}) };
      HEAT_SCHED.p = Promise.resolve(saved);
      HEAT_SCHED.t = Date.now();
      this._sched = saved;
      this._ed = null;
      const mode = this._mode();
      this._msg = { text: mode === "schedule" ? "Schedule saved. The thermostat follows it from now." : "Schedule saved. It is paused until you choose Schedule.", tone: "ok", icon: "check-circle" };
    } catch (err) {
      this._msg = { text: `Not saved: ${err && err.message ? err.message : "error"}`, tone: "err", icon: "alert-circle" };
    }
    this._key = null;
    this._updSchedule();
    clearTimeout(this._msgT);
    this._msgT = setTimeout(() => { if (!this._ed) { this._msg = null; this._key = null; this._updSchedule(); } }, 8000);
  }

  // ------------------------------------------------------------------ insights section
  _updInsights() {
    if (!this._hass) return;
    const b = this._st("boiler");
    const stamp = b ? b.last_changed : "";
    // Reload history when the boiler switches (at most every minute) or when first shown
    if (!this._hist || (stamp !== this._histStamp && Date.now() - (this._histAt || 0) > 60000)) {
      this._histStamp = stamp;
      this._loadHistory();
    }
    this._timers();
  }

  async _loadHistory() {
    if (!this._hass || this._loading) return;
    this._loading = true;
    this._histAt = Date.now();
    const c = this._config, end = new Date();
    const day0 = new Date(end); day0.setHours(0, 0, 0, 0); day0.setDate(day0.getDate() - 6);
    try {
      const h = await this._hass.callWS({ type: "history/history_during_period", start_time: day0.toISOString(), end_time: end.toISOString(),
        entity_ids: [c.current, c.target, c.boiler], minimal_response: true, no_attributes: true, significant_changes_only: false });
      const pts = (id) => (h[id] || []).map((x) => [((x.lu ?? x.lc) || 0) * 1000, x.s]);
      this._hist = { cur: pts(c.current), tgt: pts(c.target), boil: pts(c.boiler), end: end.getTime(), day0: day0.getTime() };
      this._histErr = null;
    } catch (err) {
      this._histErr = err && err.message ? err.message : "error";
    }
    this._loading = false;
    this._renderInsights();
  }

  // Minutes the boiler was on within [from, to)
  _onMinutes(boil, from, to) {
    let total = 0;
    for (let i = 0; i < boil.length; i++) {
      if (boil[i][1] !== "on") continue;
      const a = Math.max(from, boil[i][0]), b = Math.min(to, i + 1 < boil.length ? boil[i + 1][0] : this._hist.end);
      if (b > a) total += (b - a) / 60000;
    }
    return total;
  }

  _renderInsights() {
    const H = this._hist;
    const css = `<style>${HC_CSS}
      .hd > ha-icon { color: #93c5fd; background: rgba(96,140,255,0.16); }
      .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
      .stat { padding: 8px 12px; border-radius: 16px; background: rgba(255,255,255,0.05); }
      .stat b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
      .stat span { font-size: 12.5px; color: #a29db8; }
      .cols { display: grid; grid-template-columns: 1fr 200px; gap: 14px; margin-top: 10px; align-items: end; }
      svg { display: block; width: 100%; height: auto; }
      .legend { display: flex; gap: 14px; font-size: 12.5px; color: #a29db8; margin-top: 6px; }
      .legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: 3px; }
      .wk { font-size: 12.5px; color: #a29db8; margin-bottom: 4px; }
      ${NARROW_CSS_HEATING}
    </style>`;
    if (!H) {
      this.shadowRoot.innerHTML = `${css}<ha-card><div class="hd">${hcIcon("chart-line")}<div class="t"><div class="n">Heating insights</div>
        <div class="s">${this._histErr ? `History unavailable: ${esc(this._histErr)}` : "Loading history…"}</div></div></div></ha-card>`;
      return;
    }
    const end = H.end, start = end - 24 * 3600000;
    const num = (arr) => arr.map(([t, s]) => [t, hcNum(s)]).filter(([, v]) => v != null);
    const cur = num(H.cur), tgt = num(H.tgt);
    const cur24 = cur.filter(([t]) => t >= start), before = cur.filter(([t]) => t < start).pop();
    if (before) cur24.unshift([start, before[1]]);
    const tgt24 = tgt.filter(([t]) => t >= start), tb = tgt.filter(([t]) => t < start).pop();
    if (tb) tgt24.unshift([start, tb[1]]);
    const W = 560, HT = this._config.compact ? 78 : 104, P = 4;
    const vals = [...cur24.map((p) => p[1]), ...tgt24.map((p) => p[1]).filter((v) => v >= 12)];
    const lo = Math.floor((vals.length ? Math.min(...vals) : 15) - 0.5), hi = Math.ceil((vals.length ? Math.max(...vals) : 22) + 0.5);
    const X = (t) => P + ((t - start) / (end - start)) * (W - 2 * P), Y = (v) => P + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (HT - 2 * P);
    const line = (pts, step) => pts.map(([t, v], i) => {
      const x = X(t).toFixed(1), y = Y(v).toFixed(1);
      if (i === 0) return `M${x} ${y}`;
      return step ? `H${x}V${y}` : `L${x} ${y}`;
    }).join("") + (pts.length ? (step ? `H${X(end).toFixed(1)}` : `L${X(end).toFixed(1)} ${Y(pts[pts.length - 1][1]).toFixed(1)}`) : "");
    // Boiler-on bands
    const bands = [];
    const boil = H.boil;
    for (let i = 0; i < boil.length; i++) {
      if (boil[i][1] !== "on") continue;
      const a = Math.max(start, boil[i][0]), b = Math.min(end, i + 1 < boil.length ? boil[i + 1][0] : end);
      if (b > a) bands.push(`<rect x="${X(a).toFixed(1)}" y="0" width="${Math.max(1, X(b) - X(a)).toFixed(1)}" height="${HT}" fill="rgba(249,115,22,0.18)"/>`);
    }
    const grid = [];
    for (let v = Math.ceil(lo); v <= hi; v++) grid.push(`<line x1="0" x2="${W}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="rgba(255,255,255,0.06)"/>`
      + `<text x="${W - 2}" y="${(Y(v) - 2).toFixed(1)}" fill="#8e8aa0" font-size="10" text-anchor="end">${v}°</text>`);
    const hours = [];
    for (let k = 0; k <= 24; k += 6) {
      const t = start + k * 3600000, d = new Date(t);
      hours.push(`<text x="${X(t).toFixed(1)}" y="${HT + 13}" fill="#8e8aa0" font-size="10.5" text-anchor="${k === 0 ? "start" : k === 24 ? "end" : "middle"}">${k === 24 ? "now" : hcHHMM(d.getHours() * 60 + d.getMinutes())}</text>`);
    }
    const svg = `<svg viewBox="0 0 ${W} ${HT + 16}" role="img" aria-label="Indoor and target temperature over the last 24 hours">${bands.join("")}${grid.join("")}
      <path d="${line(tgt24, true)}" fill="none" stroke="#a78bfa" stroke-width="2" stroke-dasharray="5 4"/>
      <path d="${line(cur24, false)}" fill="none" stroke="#fdba74" stroke-width="2.5" stroke-linejoin="round"/>${hours.join("")}</svg>`;
    // Today and the last 7 days of boiler running time
    const midnight = new Date(end); midnight.setHours(0, 0, 0, 0);
    const days = [];
    for (let k = 6; k >= 0; k--) {
      const a = new Date(midnight); a.setDate(a.getDate() - k);
      const b = new Date(a); b.setDate(b.getDate() + 1);
      days.push({ label: k === 0 ? "Today" : HC_SHORT[(a.getDay() + 6) % 7], min: this._onMinutes(boil, a.getTime(), Math.min(b.getTime(), end)) });
    }
    const today = days[days.length - 1].min, week = days.reduce((s, d) => s + d.min, 0);
    const todayCur = cur.filter(([t]) => t >= midnight.getTime()).map((p) => p[1]);
    const maxM = Math.max(60, ...days.map((d) => d.min));
    const bw = 200, bh = this._config.compact ? 80 : 100;
    const bars = days.map((d, i) => {
      const h = (d.min / maxM) * (bh - 30), x = i * (bw / 7) + 4, w = bw / 7 - 8;
      return `<rect x="${x.toFixed(1)}" y="${(bh - 16 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1.5, h).toFixed(1)}" rx="4" fill="${i === 6 ? "#fb923c" : "rgba(251,146,60,0.45)"}"/>`
        + `<text x="${(x + w / 2).toFixed(1)}" y="${bh - 3}" fill="#8e8aa0" font-size="10" text-anchor="middle">${d.label === "Today" ? "Now" : d.label.slice(0, 2)}</text>`
        + (d.min >= 1 ? `<text x="${(x + w / 2).toFixed(1)}" y="${(bh - 19 - h).toFixed(1)}" fill="#c9c4dc" font-size="9.5" text-anchor="middle">${d.min >= 60 ? `${(d.min / 60).toFixed(1)}h` : `${Math.round(d.min)}m`}</text>` : "");
    }).join("");
    const nowCur = cur.length ? cur[cur.length - 1][1] : null;
    this.shadowRoot.innerHTML = `${css}<ha-card>
      <div class="hd">${hcIcon("chart-line")}<div class="t"><div class="n">Heating insights</div><div class="s">From Home Assistant's history · last 24 hours</div></div>
        <button class="ghost" data-act="reload" aria-label="Refresh">${hcIcon("refresh")}</button></div>
      <div class="stats">
        <div class="stat"><b>${hcT(nowCur)}</b><span>Indoor now</span></div>
        <div class="stat"><b>${todayCur.length ? `${Math.min(...todayCur).toFixed(1)}–${Math.max(...todayCur).toFixed(1)}°` : "–"}</b><span>Today's range</span></div>
        <div class="stat"><b>${hcDur(today)}</b><span>Boiler on today</span></div>
        <div class="stat"><b>${hcDur(week)}</b><span>Boiler on, 7 days</span></div>
      </div>
      <div class="cols"><div>${svg}
        <div class="legend"><span><i style="background:#fdba74"></i>Indoor</span><span><i style="background:#a78bfa"></i>Target</span>
          <span><i style="background:rgba(249,115,22,0.45);height:10px;vertical-align:-1px"></i>Boiler on</span></div></div>
        <div><div class="wk">Boiler running time per day</div><svg viewBox="0 0 ${bw} ${bh}">${bars}</svg></div></div>
    </ha-card>`;
  }
}

/*
 * Glass Home Energy card: the Energy page, built only from the Octopus Energy integration (BottlecapDave),
 * the Octopus Home Mini, and appliance plugs that genuinely measure energy.
 *
 *   type: custom:glasshome-energy-card
 *   section: overview | detail
 *   electricity: { demand, today_kwh, today_cost, rate, standing, stat_kwh, stat_cost }
 *   gas:         { today_kwh, today_cost, rate, standing, stat_kwh, stat_cost }
 *   appliances:  [{ name, icon, power?, today?, month?, energy? }]   # energy: a total kWh meter read through statistics
 *
 * Live electricity is the Home Mini's demand (watts, about once a minute). Today's kWh and cost come from
 * the integration's accumulative sensors; their cost includes the day's standing charge and VAT. Daily
 * history is the statistics the integration imports from Octopus, which publishes each day a day or two
 * late; those daily costs exclude the standing charge, so it is added per day here. Everything shown as
 * a cost is an estimate from the tariff, not the Octopus bill. Nothing is drawn while the page is hidden.
 */
const EN_TABS = [["elec", "Electricity", "lightning-bolt"], ["gas", "Gas", "fire"], ["costs", "Costs", ghCurrencyIcon()],
  ["history", "History", "chart-bar"], ["insights", "Insights", "lightbulb-on-outline"], ["apps", "Appliances", "power-plug-outline"]];
const EN_PERIODS = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["month", "This month"], ["prev", "Previous month"]];
const EN_METRICS = [["ek", "Electricity kWh"], ["gk", "Gas kWh"], ["ec", `Electricity ${ghCurrencySign()}`], ["gc", `Gas ${ghCurrencySign()}`], ["tc", `Combined ${ghCurrencySign()}`]];
const EN_OCT = GH_DEMO || !GH_CFG.energy || !GH_CFG.energy.method || GH_CFG.energy.method === "octopus";
const EN_W = EN_OCT ? {
  live: "Live from your Octopus Home Mini", trace: "Home Mini readings about once a minute", tariff: "from your Octopus tariff",
  late: "Octopus publishes each day's readings a day or two late, so ", today: "Today comes from the Home Mini; earlier days come from the readings Octopus publishes.",
  half: "Half-hour readings from the Home Mini.", notYet: "Octopus has not published yesterday's readings yet; they usually arrive within a day or two.",
  hourly: "Hourly readings published by Octopus.", missing: "not published by Octopus yet", rest: "Octopus has not published the rest yet.",
} : {
  live: "Live from your meter", trace: "readings as your meter sends them", tariff: "from your tariff",
  late: "Some readings haven't arrived yet, so ", today: "Today and earlier days come from your meter's history in Home Assistant.",
  half: "Half-hour readings from your meter.", notYet: "Yesterday's readings haven't arrived yet. Smart meter readings can take a while to come through.",
  hourly: "Hourly readings from your meter.", missing: "with no readings yet", rest: "the rest hasn't arrived yet.",
};
const enHasGas = (c) => !!(c && c.gas && (c.gas.today_kwh || c.gas.stat_kwh));
const EN_ELEC = "#a78bfa", EN_GAS = "#fb923c";
const enNum = (v) => { const n = Number(v); return v !== null && v !== "" && v !== undefined && Number.isFinite(n) ? n : null; };
const enGBP = (n) => ghMoney(n);
const enKWh = (n, dp = 1) => (n == null ? "–" : `${n.toFixed(dp)} kWh`);
const enPence = (n) => ghRate(n);
const enKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const enDay = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
const enAdd = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const enHM = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const enWeekday = (key) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][enDay(key).getDay()];
const enPct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
const enDate = (key) => enDay(key).toLocaleDateString(GH_LOCALE, { weekday: "short", day: "numeric", month: "short" });

// Daily statistics shared by every Energy card (and refreshed at most every 30 minutes)
const EN_DAILY = { at: 0, p: null };
function enDaily(hass, cfg, force = false) {
  if (!force && EN_DAILY.p && Date.now() - EN_DAILY.at < 1800000) return EN_DAILY.p;
  const now = new Date(), start = new Date(Math.min(new Date(now.getFullYear(), now.getMonth() - 1, 1), enAdd(now, -45)));
  start.setHours(0, 0, 0, 0);
  const e = cfg.electricity, g = cfg.gas, apps = (cfg.appliances || []).filter((a) => a.energy).map((a) => a.energy);
  EN_DAILY.at = Date.now();
  EN_DAILY.p = hass.callWS({ type: "recorder/statistics_during_period", start_time: start.toISOString(), period: "day", types: ["change"],
    statistic_ids: [e.stat_kwh, e.stat_cost, g.stat_kwh, g.stat_cost, ...apps].filter(Boolean) }).then((r) => {
    const days = {};
    const put = (id, field) => (r[id] || []).forEach((x) => {
      const k = enKey(new Date(x.start));
      (days[k] = days[k] || {})[field] = x.change ?? 0;
    });
    put(e.stat_kwh, "ek"); put(e.stat_cost, "eu"); put(g.stat_kwh, "gk"); put(g.stat_cost, "gu");
    const appDays = {};
    apps.forEach((id) => (r[id] || []).forEach((x) => { (appDays[id] = appDays[id] || {})[enKey(new Date(x.start))] = x.change ?? 0; }));
    return { days, appDays, at: Date.now() };
  }).catch((err) => ({ days: {}, appDays: {}, error: err && err.message ? err.message : "error" }));
  return EN_DAILY.p;
}

const EN_CSS = `
  :host { display: block; }
  ha-card { box-sizing: border-box; padding: 16px 18px; border-radius: 26px; color: #fff; background: ${GLASS_BG}; border: ${GLASS_BORDER};
    box-shadow: ${GLASS_EDGE}; -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }
  button { font: inherit; color: #c9c4dc; border: 0; cursor: pointer; border-radius: 14px; background: rgba(255,255,255,0.06);
    min-height: 44px; padding: 0 12px; font-size: 14px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center;
    gap: 6px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  button.on { color: #fff; background: linear-gradient(160deg, rgba(139,92,246,0.75), rgba(109,40,217,0.55)); box-shadow: 0 0 14px rgba(139,92,246,0.28); }
  button ha-icon { --mdc-icon-size: 19px; }
  .lab { font-size: 12.5px; color: #a29db8; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase; }
  .note { font-size: 13px; color: #a29db8; line-height: 1.4; }
  .note b { color: #e9e5f5; }
  .tiles { display: grid; grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); gap: 8px; }
  .tile { padding: 10px 12px; border-radius: 16px; background: rgba(255,255,255,0.05); min-width: 0; }
  .tile b { display: block; font-size: 21px; font-weight: 650; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile span { display: block; font-size: 12.5px; color: #a29db8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tile small { display: block; font-size: 12px; color: #8e8aa0; margin-top: 1px; }
  .h { font-size: 15px; font-weight: 650; margin: 14px 0 6px; display: flex; align-items: baseline; gap: 8px; }
  .h span { font-size: 12.5px; font-weight: 500; color: #a29db8; }
  svg { display: block; width: 100%; height: auto; }
  .empty { padding: 30px 8px; text-align: center; color: #a29db8; font-size: 14px; }
`;

// Narrow: live use and today's costs stack, the six tabs go two rows of three, summary tiles wrap
// (up to three to a row, their text wrapping rather than cut off) and the appliance and cost tables
// tighten their columns. Below 640px the six summary tiles keep their row but their text wraps.
const NARROW_CSS_ENERGY = `
  :host { container-type: inline-size; }
  @container (max-width: 640px) {
    .tile b, .tile span { white-space: normal; }
  }
  @container (max-width: 560px) {
    .ov { grid-template-columns: minmax(0, 1fr); }
    .w { font-size: 66px; }
    .tabs { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .tiles { grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); }
    .tile b, .tile span { white-space: normal; }
    .ins { grid-template-columns: minmax(0, 1fr); }
    .h { flex-direction: column; align-items: flex-start; gap: 2px; }
    .app { grid-template-columns: 26px minmax(0, 1fr) 50px 58px 64px; gap: 6px; }
    th { padding: 6px; }
    td { padding: 11px 6px; font-size: 15px; }
    /* charts are drawn 720 wide, so their labels are enlarged to stay readable once shrunk */
    svg text { font-size: 21px; }
  }`;

class GlassHomeEnergyCard extends HTMLElement {
  setConfig(config) {
    if (!config.electricity) throw new Error("electricity is required");
    this._config = { section: "overview", appliances: [], ...config, gas: config.gas || {} };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._click(e));
    }
    this._tab = this._tab || "elec";
    this._period = this._period || "today";
    this._metric = this._metric || "ek";
    this._key = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._hidden) this._update();
  }

  getCardSize() {
    return this._config.section === "overview" ? 4 : 10;
  }

  connectedCallback() {
    if (!this._io && "IntersectionObserver" in window) {
      this._io = new IntersectionObserver((es) => es.forEach((e) => {
        this._hidden = !e.isIntersecting;
        if (!this._hidden && this._hass) { this._key = null; this._update(); }
        this._timers();
      }));
      this._io.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    this._hidden = true;
    this._timers();
  }

  // Only while visible: refresh history every 30 minutes and the power trace every 5 minutes
  _timers() {
    const on = !this._hidden && this.isConnected && this._config.section === "detail";
    if (on && !this._t) this._t = setInterval(() => this._tick(), 300000);
    if (!on && this._t) { clearInterval(this._t); this._t = null; }
  }

  _tick() {
    this._trace = null;
    this._gasGap = null;
    if (Date.now() - EN_DAILY.at > 1800000) this._daily = null;
    this._key = null;
    this._update();
  }

  _st(id) {
    return id && this._hass.states[id];
  }

  _n(id) {
    const s = this._st(id);
    return s && !["unavailable", "unknown"].includes(s.state) ? enNum(s.state) : null;
  }

  // Today's live figures from the Home Mini sensors
  _live() {
    const e = this._config.electricity, g = this._config.gas;
    const dem = this._st(e.demand), ec = this._st(e.today_cost), gc = this._st(g.today_cost), gk = this._st(g.today_kwh);
    return {
      w: this._n(e.demand), wAt: dem ? new Date(dem.last_updated) : null,
      ek: this._n(e.today_kwh), ec: this._n(e.today_cost), gk: this._n(g.today_kwh), gc: this._n(g.today_cost),
      gAt: gk ? new Date(gk.last_updated) : null,
      eSlots: ((ec && ec.attributes.charges) || []), gSlots: ((gc && gc.attributes.charges) || []),
      eRate: this._n(e.rate), gRate: this._n(g.rate), eStand: this._n(e.standing), gStand: this._n(g.standing),
      eTariff: ec && ec.attributes.tariff_code, gTariff: gc && gc.attributes.tariff_code,
      eStandStart: (this._st(e.standing) || { attributes: {} }).attributes.start,
      gStandStart: (this._st(g.standing) || { attributes: {} }).attributes.start,
    };
  }

  // One day's figures: today from the live sensors, earlier days from Octopus statistics (+ standing charge)
  _dayRec(key, L) {
    if (key === enKey(new Date())) return { ek: L.ek, ec: L.ec, gk: L.gk, gc: L.gc, live: true };
    const d = this._daily && this._daily.days[key];
    if (!d) return { ek: null, ec: null, gk: null, gc: null };
    const stand = (v, s, start) => (v == null ? null : v + (s != null && (!start || key >= start.slice(0, 10)) ? s : 0));
    return { ek: d.ek ?? null, ec: stand(d.eu ?? null, L.eStand, L.eStandStart), gk: d.gk ?? null, gc: stand(d.gu ?? null, L.gStand, L.gStandStart) };
  }

  _range(fromKey, toKey, L) {
    const out = { ek: 0, ec: 0, gk: 0, gc: 0, eMiss: [], gMiss: [], days: [] };
    for (let d = enDay(fromKey); enKey(d) <= toKey; d = enAdd(d, 1)) {
      const k = enKey(d), r = this._dayRec(k, L);
      out.days.push({ k, ...r });
      if (r.ek == null) out.eMiss.push(k); else { out.ek += r.ek; out.ec += r.ec ?? 0; }
      if (r.gk == null) out.gMiss.push(k); else { out.gk += r.gk; out.gc += r.gc ?? 0; }
    }
    return out;
  }

  _update() {
    if (!this._hass) return;
    if (!this._daily && !this._dailyLoading) {
      this._dailyLoading = true;
      enDaily(this._hass, this._config).then((d) => { this._daily = d; this._dailyLoading = false; this._key = null; this._update(); });
    }
    const e = this._config.electricity, g = this._config.gas;
    const live = [e.demand, e.today_kwh, e.today_cost, g.today_kwh, g.today_cost, e.rate, g.rate].map((id) => { const s = this._st(id); return s ? s.last_updated : ""; });
    const sec = this._config.section;
    const apps = sec === "detail" && this._tab === "apps" ? (this._config.appliances || []).map((a) => [a.power, a.today].map((id) => (this._st(id) || {}).state)) : null;
    // Panels that do not show live figures only redraw when their data or choices change
    const liveTabs = sec === "overview" || ["elec", "gas", "costs", "insights"].includes(this._tab) || (this._tab === "history" && this._period === "today");
    const key = JSON.stringify([liveTabs ? live : null, apps, this._tab, this._period, this._metric, !!this._daily, this._daily && this._daily.at,
      !!this._trace, !!this._hourly, this._gasGap, !!this._yday]);
    if (key === this._key) return;
    this._key = key;
    if (sec === "overview") this._renderOverview();
    else this._renderDetail();
  }

  _click(e) {
    const b = e.composedPath().find((n) => n.dataset && n.dataset.act);
    if (!b) return;
    const { act, v } = b.dataset;
    if (act === "nav") {
      this.dispatchEvent(new CustomEvent("hass-action", { bubbles: true, composed: true,
        detail: { config: { tap_action: { action: "navigate", navigation_path: this._config.path } }, action: "tap" } }));
      return;
    }
    if (act === "tab") this._tab = v;
    else if (act === "period") this._period = v;
    else if (act === "metric") this._metric = v;
    this._key = null;
    this._update();
  }

  // ------------------------------------------------------------------ overview
  _renderOverview() {
    const L = this._live();
    const w = L.w, kw = w != null ? (w / 1000).toFixed(2) : "–";
    const total = L.ec != null || L.gc != null ? (L.ec || 0) + (L.gc || 0) : null;
    const age = (d) => (d ? enHM(d) : "–");
    // A simple level bar against today's busiest half hour (as average watts), so a spike stands out
    const peakW = Math.max(0, ...L.eSlots.map((s) => (enNum(s.consumption) || 0) * 2000));
    const lvl = w != null && peakW > 0 ? Math.min(100, (w / Math.max(peakW, w)) * 100) : 0;
    this.shadowRoot.innerHTML = `<style>${EN_CSS}
        .ov { display: grid; grid-template-columns: 1.1fr 1fr; gap: 18px; align-items: stretch; }
        .w { font-size: 82px; font-weight: 300; letter-spacing: -3px; line-height: 1; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
        .w span { font-size: 30px; letter-spacing: 0; margin-left: 6px; color: #c4b5fd; font-weight: 500; }
        .kw { font-size: 15px; color: #e9e5f5; font-weight: 600; }
        .src { font-size: 13px; color: #a29db8; margin-top: 3px; display: flex; align-items: center; gap: 6px; }
        .dot { width: 8px; height: 8px; border-radius: 4px; background: rgb(${STATUS.green}); }
        .meter { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.07); margin-top: 14px; overflow: hidden; }
        .meter i { display: block; height: 100%; border-radius: 4px; background: linear-gradient(90deg, #7c3aed, #c4b5fd); }
        .ml { display: flex; justify-content: space-between; font-size: 12px; color: #8e8aa0; margin-top: 4px; }
        .tdy { padding: 12px 14px; border-radius: 20px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; }
        .row { display: grid; grid-template-columns: 26px 1fr auto auto; gap: 8px; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 15px; }
        .row ha-icon { --mdc-icon-size: 20px; }
        .row .k { color: #c9c4dc; font-variant-numeric: tabular-nums; }
        .row .c { font-weight: 650; font-variant-numeric: tabular-nums; min-width: 62px; text-align: right; }
        .tot { display: flex; align-items: baseline; justify-content: space-between; margin-top: auto; padding-top: 10px; }
        .tot b { font-size: 34px; font-weight: 650; font-variant-numeric: tabular-nums; }
        .foot { margin-top: 12px; }
        ${NARROW_CSS_ENERGY}
      </style>
      <ha-card>
        <div class="ov">
          <div>
            <div class="lab">Electricity in use now</div>
            <div class="w">${w != null ? Math.round(w).toLocaleString("en-GB") : "–"}<span>W</span></div>
            <div class="kw">${kw} kW</div>
            <div class="src"><span class="dot"></span>${EN_W.live} · reading at ${age(L.wAt)}</div>
            <div class="meter"><i style="width:${lvl.toFixed(1)}%"></i></div>
            <div class="ml"><span>0</span><span>${peakW ? `today's busiest half hour averaged ${(peakW / 1000).toFixed(2)} kW` : ""}</span></div>
          </div>
          <div class="tdy">
            <div class="lab">Today so far</div>
            <div class="row">${hcIcon("lightning-bolt").replace("<ha-icon", `<ha-icon style="color:${EN_ELEC}"`)}<span>Electricity</span><span class="k">${enKWh(L.ek)}</span><span class="c">${enGBP(L.ec)}</span></div>
            <div class="row">${hcIcon("fire").replace("<ha-icon", `<ha-icon style="color:${EN_GAS}"`)}<span>Gas</span><span class="k">${enKWh(L.gk)}</span><span class="c">${enGBP(L.gc)}</span></div>
            <div class="tot"><span class="lab">Combined cost</span><b>${enGBP(total)}</b></div>
          </div>
        </div>
        <div class="note foot">Usage is metered. <b>Costs are estimates</b> ${EN_W.tariff} (unit rates and daily standing charges, ${ghTax()} included), not your bill. Gas reading at ${age(L.gAt)}.</div>
      </ha-card>`;
  }

  // ------------------------------------------------------------------ detail
  _renderDetail() {
    if (this._tab === "gas" && !enHasGas(this._config)) this._tab = "elec";
    const tabs = EN_TABS.filter(([k]) => k !== "gas" || enHasGas(this._config)).map(([k, l, i]) => `<button data-act="tab" data-v="${k}" class="${this._tab === k ? "on" : ""}">${hcIcon(i)}${l}</button>`).join("");
    const L = this._live();
    let body = "";
    try {
      body = this._tab === "elec" ? this._pElec(L) : this._tab === "gas" ? this._pGas(L) : this._tab === "costs" ? this._pCosts(L)
        : this._tab === "history" ? this._pHistory(L) : this._tab === "insights" ? this._pInsights(L) : this._pApps(L);
    } catch (err) {
      body = `<div class="empty">Could not draw this view (${esc(err.message)}).</div>`;
    }
    this.shadowRoot.innerHTML = `<style>${EN_CSS}
        .tabs { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: 18px;
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.07); }
        .tabs button { background: transparent; min-height: 52px; flex-direction: column; gap: 3px; font-size: 12.5px; padding: 0 4px; }
        .tabs button.on { background: linear-gradient(160deg, rgba(139,92,246,0.75), rgba(109,40,217,0.55)); }
        .body { margin-top: 12px; min-height: 560px; }
        .chips { display: flex; gap: 6px; flex-wrap: wrap; }
        .chips button { min-height: 42px; font-size: 13.5px; }
        table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
        th { text-align: right; font-size: 12.5px; color: #a29db8; font-weight: 600; padding: 8px 10px; text-transform: uppercase; letter-spacing: 0.4px; }
        th:first-child, td:first-child { text-align: left; }
        td { text-align: right; padding: 13px 10px; font-size: 17px; border-top: 1px solid rgba(255,255,255,0.06); }
        td small { display: block; font-size: 12px; color: #8e8aa0; }
        td.t { font-weight: 700; color: #fff; }
        .ins { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .in { display: flex; gap: 10px; padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.05); }
        .in ha-icon { --mdc-icon-size: 22px; color: #c4b5fd; flex: none; margin-top: 2px; }
        .in .tt { display: block; font-size: 14.5px; margin-bottom: 3px; }
        .in span { font-size: 13.5px; color: #c9c4dc; line-height: 1.4; }
        .in span b { color: #fff; }
        .in.warn ha-icon { color: #fbbf24; }
        .app { display: grid; grid-template-columns: 34px 1fr 70px 82px 92px; gap: 10px; align-items: center; padding: 10px 4px;
          border-bottom: 1px solid rgba(255,255,255,0.06); font-variant-numeric: tabular-nums; }
        .app ha-icon { --mdc-icon-size: 22px; color: #c4b5fd; }
        .app .n b { display: block; font-size: 15px; } .app .n i { display: block; height: 6px; border-radius: 3px; margin-top: 6px; background: linear-gradient(90deg, #7c3aed, #c4b5fd); }
        .app .v { text-align: right; font-size: 15px; } .app .v small { display: block; font-size: 11.5px; color: #8e8aa0; }
        .apph { font-size: 12px; color: #a29db8; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; border-bottom: 0; padding-bottom: 0; }
        .legend { display: flex; gap: 14px; font-size: 12.5px; color: #a29db8; margin-top: 6px; flex-wrap: wrap; }
        .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
        ${NARROW_CSS_ENERGY}
      </style>
      <ha-card><div class="tabs">${tabs}</div><div class="body">${body}</div></ha-card>`;
  }

  // Bar chart: bars = [{ l, v, v2?, hi?, dim? }]; v2 stacks on v in the second colour
  _bars(bars, { h = 190, c1 = EN_ELEC, c2 = EN_GAS, fmt = (x) => x.toFixed(1), every = 1, peak = true } = {}) {
    if (!bars.length) return `<div class="empty">No data for this period yet.</div>`;
    const W = 720, top = 18, bot = 20, H = h, ch = H - top - bot;
    const max = Math.max(0.0001, ...bars.map((b) => (b.v || 0) + (b.v2 || 0)));
    const bw = W / bars.length, gap = Math.min(6, bw * 0.25);
    const peakI = peak ? bars.reduce((m, b, i) => ((b.v || 0) + (b.v2 || 0) > (bars[m].v || 0) + (bars[m].v2 || 0) ? i : m), 0) : -1;
    const out = [];
    for (let k = 1; k <= 3; k++) {
      const y = top + ch - (ch * k) / 3;
      out.push(`<line x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)"/><text x="${W}" y="${(y - 3).toFixed(1)}" fill="#8e8aa0" font-size="11" text-anchor="end">${fmt((max * k) / 3)}</text>`);
    }
    bars.forEach((b, i) => {
      const x = i * bw + gap / 2, w = Math.max(1, bw - gap);
      if (b.v == null && b.v2 == null) {
        out.push(`<rect x="${x.toFixed(1)}" y="${top + ch - 3}" width="${w.toFixed(1)}" height="3" rx="1.5" fill="rgba(255,255,255,0.12)"/>`);
      } else {
        const h1 = ((b.v || 0) / max) * ch, h2 = ((b.v2 || 0) / max) * ch;
        const op = b.dim ? 0.45 : 1;
        out.push(`<rect x="${x.toFixed(1)}" y="${(top + ch - h1).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, h1).toFixed(1)}" rx="${Math.min(4, w / 3).toFixed(1)}" fill="${b.hi ? "#f472b6" : c1}" opacity="${op}"/>`);
        if (b.v2) out.push(`<rect x="${x.toFixed(1)}" y="${(top + ch - h1 - h2).toFixed(1)}" width="${w.toFixed(1)}" height="${h2.toFixed(1)}" rx="${Math.min(4, w / 3).toFixed(1)}" fill="${c2}" opacity="${op}"/>`);
        if (i === peakI) out.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(top + ch - h1 - h2 - 4).toFixed(1)}" fill="#e9e5f5" font-size="11.5" font-weight="700" text-anchor="middle">${fmt((b.v || 0) + (b.v2 || 0))}</text>`);
      }
      if (b.l && i % every === 0) out.push(`<text x="${(x + w / 2).toFixed(1)}" y="${H - 5}" fill="#8e8aa0" font-size="11" text-anchor="middle">${b.l}</text>`);
    });
    return `<svg viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
  }

  // Half-hour slots from the integration's charges attribute (today's or a day's)
  _slotBars(slots, field, { mark = false } = {}) {
    // mark: today's three busiest half hours
    const top = mark ? slots.map((s, i) => [enNum(s[field]) || 0, i]).filter((x) => x[0] > 0).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]) : [];
    const bars = [];
    for (let i = 0; i < 48; i++) {
      const s = slots[i], v = s ? enNum(s[field]) || 0 : null;
      bars.push({ l: i % 12 === 0 ? `${String(i / 2).padStart(2, "0")}:00` : "", v, hi: top.includes(i) });
    }
    return bars;
  }

  _loadTrace() {
    if (this._traceLoading) return;
    this._traceLoading = true;
    const id = this._config.electricity.demand;
    this._hass.callWS({ type: "history/history_during_period", start_time: new Date(Date.now() - 3 * 3600000).toISOString(), entity_ids: [id],
      minimal_response: true, no_attributes: true, significant_changes_only: false })
      .then((h) => { this._trace = (h[id] || []).map((x) => [(x.lu ?? x.lc) * 1000, enNum(x.s)]).filter((p) => p[1] != null); })
      .catch(() => { this._trace = []; })
      .finally(() => { this._traceLoading = false; this._key = null; this._update(); });
  }

  _pElec(L) {
    if (!this._trace) this._loadTrace();
    let trace = `<div class="empty">Loading the last 3 hours…</div>`;
    if (this._trace) {
      const pts = [...this._trace];
      if (L.w != null) pts.push([Date.now(), L.w]);
      if (pts.length < 2) trace = `<div class="empty">Not enough readings yet: the trace fills in over the next few minutes.</div>`;
      else {
        const W = 720, H = 150, t0 = Date.now() - 3 * 3600000, t1 = Date.now();
        const max = Math.max(500, ...pts.map((p) => p[1])) * 1.1;
        const X = (t) => ((Math.max(t0, t) - t0) / (t1 - t0)) * W, Y = (v) => 8 + (1 - v / max) * (H - 26);
        const sorted = pts.map((p) => p[1]).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
        const peak = pts.reduce((m, p) => (p[1] > m[1] ? p : m), pts[0]);
        let d = `M${X(pts[0][0]).toFixed(1)} ${Y(pts[0][1]).toFixed(1)}`;
        for (let i = 1; i < pts.length; i++) d += `H${X(pts[i][0]).toFixed(1)}V${Y(pts[i][1]).toFixed(1)}`;
        const area = `${d}H${X(t1).toFixed(1)}V${H - 18}H${X(pts[0][0]).toFixed(1)}Z`;
        const grid = [1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000].filter((v) => v < max).map((v) => `<line x1="0" x2="${W}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="rgba(255,255,255,0.06)"/><text x="${W}" y="${(Y(v) - 3).toFixed(1)}" fill="#8e8aa0" font-size="11" text-anchor="end">${v / 1000} kW</text>`).join("");
        const ticks = [0, 1, 2, 3].map((k) => { const t = t0 + k * 3600000; return `<text x="${X(t).toFixed(1)}" y="${H - 4}" fill="#8e8aa0" font-size="11" text-anchor="${k === 0 ? "start" : k === 3 ? "end" : "middle"}">${k === 3 ? "now" : enHM(new Date(t))}</text>`; }).join("");
        trace = `<svg viewBox="0 0 ${W} ${H}">${grid}<path d="${area}" fill="rgba(167,139,250,0.16)"/><path d="${d}" fill="none" stroke="${EN_ELEC}" stroke-width="2.2"/>
          <line x1="0" x2="${W}" y1="${Y(med).toFixed(1)}" y2="${Y(med).toFixed(1)}" stroke="rgba(255,255,255,0.35)" stroke-dasharray="4 4"/>
          <circle cx="${X(peak[0]).toFixed(1)}" cy="${Y(peak[1]).toFixed(1)}" r="4.5" fill="#f472b6"/>${ticks}</svg>
          <div class="legend"><span><i style="background:${EN_ELEC}"></i>Power</span><span><i style="background:rgba(255,255,255,0.5);height:2px;vertical-align:3px"></i>Typical (median) ${(med / 1000).toFixed(2)} kW</span>
          <span><i style="background:#f472b6;border-radius:5px"></i>Peak ${(peak[1] / 1000).toFixed(2)} kW at ${enHM(new Date(peak[0]))}</span></div>`;
      }
    }
    const spikes = this._slotBars(L.eSlots, "consumption", { mark: true });
    return `<div class="tiles" style="--n:5">
        <div class="tile"><b>${L.w != null ? Math.round(L.w).toLocaleString("en-GB") : "–"} W</b><span>Using now</span><small>reading at ${L.wAt ? enHM(L.wAt) : "–"}</small></div>
        <div class="tile"><b>${enKWh(L.ek)}</b><span>Used today</span></div>
        <div class="tile"><b>${enGBP(L.ec)}</b><span>Cost today</span><small>incl. standing charge</small></div>
        <div class="tile"><b>${enPence(L.eRate)}</b><span>Unit rate</span><small>per kWh, incl. ${ghTax()}</small></div>
        <div class="tile"><b>${enPence(L.eStand)}</b><span>Standing charge</span><small>per day, incl. ${ghTax()}</small></div>
      </div>
      <div class="h">Power, last 3 hours<span>${EN_W.trace}</span></div>${trace}
      <div class="h">Today, every half hour<span>kWh · pink bars are today's three busiest half hours</span></div>${this._bars(spikes, { h: 170, fmt: (x) => x.toFixed(2) })}
      <div class="note">Tariff ${esc(L.eTariff || "–")}.</div>`;
  }

  _gasGapText(L) {
    if (this._gasGap === null && !this._gasLoading) {
      this._gasLoading = true;
      const id = this._config.gas.today_kwh;
      this._hass.callWS({ type: "history/history_during_period", start_time: new Date(Date.now() - 12 * 3600000).toISOString(), entity_ids: [id],
        minimal_response: true, no_attributes: true, significant_changes_only: false })
        .then((h) => {
          const t = (h[id] || []).filter((x) => enNum(x.s) != null).map((x) => (x.lu ?? x.lc) * 1000);
          const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
          this._gasGap = gaps.length >= 2 ? Math.round(gaps[Math.floor(gaps.length / 2)] / 60000) : 0;
        }).catch(() => { this._gasGap = 0; })
        .finally(() => { this._gasLoading = false; this._key = null; this._update(); });
    }
    const last = L.gAt ? `last reading ${enHM(L.gAt)}` : "no reading yet";
    return this._gasGap ? `Gas is not live: readings arrive about every <b>${this._gasGap} min</b> · ${last}.` : `Gas is not live: readings arrive in batches · ${last}.`;
  }

  _pGas(L) {
    const today = new Date(), tk = enKey(today);
    const wk = this._range(enKey(enAdd(today, -((today.getDay() + 6) % 7))), tk, L);
    const mo = this._range(enKey(new Date(today.getFullYear(), today.getMonth(), 1)), tk, L);
    const miss = (r) => (r.gMiss.length ? `<small>${r.gMiss.length} day${r.gMiss.length > 1 ? "s" : ""} not published yet</small>` : "<small>&nbsp;</small>");
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const k = enKey(enAdd(today, -i)), r = this._dayRec(k, L);
      days.push({ l: i === 0 ? "Today" : enDay(k).getDate(), v: r.gk, dim: i === 0 });
    }
    return `<div class="tiles" style="--n:3">
        <div class="tile"><b>${enKWh(L.gk)}</b><span>Today · ${enGBP(L.gc)}</span><small>so far, incl. standing charge</small></div>
        <div class="tile"><b>${enKWh(wk.gk, 0)}</b><span>This week · ${enGBP(wk.gc)}</span>${miss(wk)}</div>
        <div class="tile"><b>${enKWh(mo.gk, 0)}</b><span>This month · ${enGBP(mo.gc)}</span>${miss(mo)}</div>
      </div>
      <div class="tiles" style="--n:2;margin-top:8px">
        <div class="tile"><b>${enPence(L.gRate)}</b><span>Unit rate per kWh, incl. ${ghTax()}</span></div>
        <div class="tile"><b>${enPence(L.gStand)}</b><span>Standing charge per day, incl. ${ghTax()}</span></div>
      </div>
      <div class="note" style="margin-top:10px">${this._gasGapText(L)}</div>
      <div class="h">Last 14 days<span>kWh per day · today so far is faded</span></div>${this._bars(days, { c1: EN_GAS, h: 160, fmt: (x) => x.toFixed(0) })}
      <div class="h">Today, every half hour<span>kWh</span></div>${this._bars(this._slotBars(L.gSlots, "consumption"), { c1: EN_GAS, h: 130, fmt: (x) => x.toFixed(2) })}`;
  }

  _pCosts(L) {
    if (!this._daily) return `<div class="empty">Loading history…</div>`;
    const today = new Date(), tk = enKey(today);
    const rows = [["Today", this._range(tk, tk, L)], ["Yesterday", this._range(enKey(enAdd(today, -1)), enKey(enAdd(today, -1)), L)],
      ["This week", this._range(enKey(enAdd(today, -((today.getDay() + 6) % 7))), tk, L)],
      ["This month", this._range(enKey(new Date(today.getFullYear(), today.getMonth(), 1)), tk, L)]];
    const cell = (v, missing, kwh) => (missing ? `<td>–<small>not published yet</small></td>` : `<td>${enGBP(v)}<small>${enKWh(kwh, 1)}</small></td>`);
    const body = rows.map(([n, r]) => {
      const eAll = r.eMiss.length === r.days.length, gAll = r.gMiss.length === r.days.length;
      return `<tr><td>${n}</td>${cell(r.ec, eAll, r.ek)}${cell(r.gc, gAll, r.gk)}<td class="t">${eAll && gAll ? "–" : enGBP(r.ec + r.gc)}</td></tr>`;
    }).join("");
    const gaps = rows.slice(2).flatMap(([n, r]) => [...(r.eMiss.length && r.eMiss.length < r.days.length ? [`${n.toLowerCase()} leaves out electricity for ${r.eMiss.map(enDate).join(", ")}`] : []),
      ...(r.gMiss.length && r.gMiss.length < r.days.length ? [`${n.toLowerCase()} leaves out gas for ${r.gMiss.map(enDate).join(", ")}`] : [])]);
    return `<table><tr><th></th><th>Electricity</th><th>Gas</th><th>Combined</th></tr>${body}</table>
      ${gaps.length ? `<div class="note" style="margin-top:10px">${EN_W.late}${gaps.join("; ")}.</div>` : ""}
      <div class="h">Your tariff</div>
      <div class="tiles" style="--n:2">
        <div class="tile"><b>${enPence(L.eRate)} · ${enPence(L.eStand)}</b><span>Electricity: per kWh · per day</span><small>${esc(L.eTariff || "–")}</small></div>
        <div class="tile"><b>${enPence(L.gRate)} · ${enPence(L.gStand)}</b><span>Gas: per kWh · per day</span><small>${esc(L.gTariff || "–")}</small></div>
      </div>
      <div class="note" style="margin-top:10px"><b>These are estimates, not your bill.</b> ${EN_W.today}
        Each day includes that day's standing charge, and all prices include ${ghTax()}. Your actual bill may differ slightly (rounding, credits and any meter corrections).</div>`;
  }

  _loadYesterday() {
    if (this._ydayLoading) return;
    this._ydayLoading = true;
    const e = this._config.electricity, g = this._config.gas, y = enAdd(new Date(), -1);
    y.setHours(0, 0, 0, 0);
    this._hass.callWS({ type: "recorder/statistics_during_period", start_time: y.toISOString(), end_time: enAdd(y, 1).toISOString(), period: "hour",
      types: ["change"], statistic_ids: [e.stat_kwh, e.stat_cost, g.stat_kwh, g.stat_cost].filter(Boolean) })
      .then((r) => {
        const hours = Array.from({ length: 24 }, () => ({}));
        const put = (id, f) => (r[id] || []).forEach((x) => { hours[new Date(x.start).getHours()][f] = x.change ?? 0; });
        put(e.stat_kwh, "ek"); put(e.stat_cost, "ec"); put(g.stat_kwh, "gk"); put(g.stat_cost, "gc");
        this._yday = hours;
      }).catch(() => { this._yday = []; })
      .finally(() => { this._ydayLoading = false; this._key = null; this._update(); });
  }

  _pHistory(L) {
    const P = this._period, M = this._metric;
    const chips = (list, act, cur) => `<div class="chips">${list.map(([k, l]) => `<button data-act="${act}" data-v="${k}" class="${cur === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
    const money = M === "ec" || M === "gc" || M === "tc", gas = M === "gk" || M === "gc";
    const fmt = money ? (x) => ghMoney(x) : (x) => x.toFixed(x < 10 ? 2 : 0);
    const unit = money ? "" : " kWh";
    let bars = [], note = "", sum = 0, n = 0;
    const pick = (r) => (M === "ek" ? { v: r.ek } : M === "gk" ? { v: r.gk } : M === "ec" ? { v: r.ec } : M === "gc" ? { v: r.gc }
      : { v: r.ek == null && r.gk == null ? null : r.ec ?? 0, v2: r.gc ?? 0 });
    if (P === "today") {
      const slots = gas ? L.gSlots : L.eSlots;
      if (M === "tc") {
        bars = Array.from({ length: 48 }, (_, i) => ({ l: i % 12 === 0 ? `${String(i / 2).padStart(2, "0")}:00` : "",
          v: L.eSlots[i] ? enNum(L.eSlots[i].cost) : null, v2: L.gSlots[i] ? enNum(L.gSlots[i].cost) : 0 }));
      } else bars = this._slotBars(slots, money ? "cost" : "consumption");
      bars.forEach((b) => { if (b.v != null) { sum += (b.v || 0) + (b.v2 || 0); n++; } });
      note = money ? "Half-hour costs exclude the daily standing charge." : EN_W.half;
    } else if (P === "yesterday") {
      if (!this._yday) { this._loadYesterday(); return `${chips(EN_PERIODS, "period", P)}<div style="height:8px"></div>${chips(EN_METRICS, "metric", M)}<div class="empty">Loading yesterday…</div>`; }
      bars = this._yday.map((h, i) => {
        const p = M === "tc" ? { v: h.ec, v2: h.gc } : { v: h[M === "ek" ? "ek" : M === "gk" ? "gk" : M === "ec" ? "ec" : "gc"] };
        return { l: i % 6 === 0 ? `${String(i).padStart(2, "0")}:00` : "", ...p };
      });
      bars.forEach((b) => { if (b.v != null) { sum += (b.v || 0) + (b.v2 || 0); n++; } });
      if (!n) note = EN_W.notYet;
      else note = money ? "Hourly costs exclude the daily standing charge." : EN_W.hourly;
    } else {
      if (!this._daily) return `${chips(EN_PERIODS, "period", P)}<div class="empty">Loading history…</div>`;
      const today = new Date();
      let from, to = today;
      if (P === "7d") from = enAdd(today, -6);
      else if (P === "30d") from = enAdd(today, -29);
      else if (P === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
      else { from = new Date(today.getFullYear(), today.getMonth() - 1, 1); to = new Date(today.getFullYear(), today.getMonth(), 0); }
      const r = this._range(enKey(from), enKey(to), L);
      const lbl = (k, i) => (r.days.length <= 8 ? enWeekday(k) : i % 5 === 0 || i === r.days.length - 1 ? String(enDay(k).getDate()) : "");
      bars = r.days.map((d, i) => ({ l: lbl(d.k, i), ...pick(d), dim: d.live }));
      bars.forEach((b) => { if (b.v != null) { sum += (b.v || 0) + (b.v2 || 0); n++; } });
      const missing = bars.filter((b) => b.v == null).length;
      const part = M === "tc" ? r.days.filter((d) => (d.ek == null) !== (d.gk == null)) : [];
      note = `${money ? "Daily costs include the standing charge. " : ""}${bars.some((b) => b.dim) ? "Today (faded) is so far. " : ""}${missing ? `${missing} day${missing > 1 ? "s" : ""} ${EN_W.missing} (grey). ` : ""}`
        + (part.length ? `${part.map((d) => enDate(d.k)).join(", ")} only include${part.length > 1 ? "" : "s"} ${part[0].ek == null ? "gas" : "electricity"} so far: ${EN_W.rest}` : "");
    }
    const avg = n ? sum / n : null;
    const per = P === "today" ? "half hour" : P === "yesterday" ? "hour" : "day";
    return `${chips(EN_PERIODS, "period", P)}<div style="height:8px"></div>${chips(EN_METRICS, "metric", M)}
      <div class="tiles" style="--n:2;margin-top:12px"><div class="tile"><b>${n ? (money ? enGBP(sum) : `${sum.toFixed(1)} kWh`) : "–"}</b><span>Total for the period</span></div>
        <div class="tile"><b>${avg != null ? (money ? enGBP(avg) : `${avg.toFixed(2)} kWh`) : "–"}</b><span>Average per ${per}${unit ? "" : ""}</span></div></div>
      <div style="margin-top:12px">${this._bars(bars, { h: 250, c1: gas ? EN_GAS : EN_ELEC, c2: EN_GAS, fmt })}</div>
      ${M === "tc" ? `<div class="legend"><span><i style="background:${EN_ELEC}"></i>Electricity</span><span><i style="background:${EN_GAS}"></i>Gas</span></div>` : ""}
      <div class="note" style="margin-top:8px">${note}</div>`;
  }

  _loadHourly() {
    if (this._hourlyLoading) return;
    this._hourlyLoading = true;
    const e = this._config.electricity, start = enAdd(new Date(), -15);
    start.setHours(0, 0, 0, 0);
    this._hass.callWS({ type: "recorder/statistics_during_period", start_time: start.toISOString(), period: "hour", types: ["change"], statistic_ids: [e.stat_kwh].filter(Boolean) })
      .then((r) => {
        // Usual electricity for each hour of the day, from the complete days Octopus has published
        const byHour = Array.from({ length: 24 }, () => []), days = new Set();
        (r[e.stat_kwh] || []).forEach((x) => { const d = new Date(x.start); byHour[d.getHours()].push(x.change ?? 0); days.add(enKey(d)); });
        this._hourly = { avg: byHour.map((v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)), days: days.size };
      }).catch(() => { this._hourly = { avg: [], days: 0 }; })
      .finally(() => { this._hourlyLoading = false; this._key = null; this._update(); });
  }

  _pInsights(L) {
    if (!this._daily) return `<div class="empty">Loading history…</div>`;
    if (!this._hourly) this._loadHourly();
    const today = new Date(), tk = enKey(today), items = [];
    const add = (icon, title, text, warn) => items.push(`<div class="in ${warn ? "warn" : ""}">${hcIcon(icon)}<div><b class="tt">${title}</b><span>${text}</span></div></div>`);
    // Busiest half hour today
    const slots = L.eSlots.map((s) => ({ s, v: enNum(s.consumption) || 0 }));
    if (slots.length >= 4) {
      const top = slots.reduce((m, x) => (x.v > m.v ? x : m), slots[0]);
      add("clock-alert-outline", "Busiest half hour today", `${enHM(new Date(top.s.start))}–${enHM(new Date(top.s.end))} used <b>${top.v.toFixed(2)} kWh</b> (about ${enGBP(enNum(top.s.cost))}), an average of ${(top.v * 2).toFixed(1)} kW.`);
    }
    // Compared with a usual day by this time (hourly averages from published days)
    const H = this._hourly;
    if (H && H.days >= 7 && slots.length >= 4) {
      const hr = today.getHours(), usual = H.avg.slice(0, hr).reduce((a, b) => a + (b || 0), 0) + (H.avg[hr] || 0) * (today.getMinutes() / 60);
      const so = L.ek, pct = enPct(so, usual);
      if (usual > 0.5 && so != null && pct != null) {
        add(pct > 15 ? "trending-up" : pct < -15 ? "trending-down" : "equal", "Today compared with usual",
          `By ${enHM(today)} you have used <b>${so.toFixed(1)} kWh</b>; on a usual day (last ${H.days} days) it is ${usual.toFixed(1)} kWh by now, so today is <b>${Math.abs(pct)}% ${pct >= 0 ? "higher" : "lower"}</b>.`, pct > 25);
      }
      const unusual = L.eSlots.map((s) => { const h = new Date(s.start).getHours(), u = (H.avg[h] || 0) / 2, v = enNum(s.consumption) || 0; return { s, v, u }; })
        .filter((x) => x.u > 0 && x.v > x.u * 2.5 && x.v > 0.4).sort((a, b) => b.v / b.u - a.v / a.u).slice(0, 3);
      if (unusual.length) add("alert-outline", "Unusual increases today", unusual.map((x) => `${enHM(new Date(x.s.start))} used ${x.v.toFixed(2)} kWh, ${(x.v / x.u).toFixed(1)}× the usual for that time`).join("; ") + ".", true);
    }
    // Week so far: highest day
    const wk = this._range(enKey(enAdd(today, -((today.getDay() + 6) % 7))), tk, L).days.filter((d) => d.ek != null && !d.live);
    if (wk.length >= 2) {
      const hi = wk.reduce((m, d) => (d.ek > m.ek ? d : m), wk[0]);
      add("calendar-week", "Highest day this week", `${enDate(hi.k)} used the most electricity so far this week: <b>${hi.ek.toFixed(1)} kWh</b> (${enGBP(hi.ec)}).`);
    }
    // Averages over the last 30 published days
    const last30 = this._range(enKey(enAdd(today, -30)), enKey(enAdd(today, -1)), L).days;
    const eDays = last30.filter((d) => d.ek != null), gDays = last30.filter((d) => d.gk != null);
    if (eDays.length >= 7) add("lightning-bolt", "Average electricity per day", `<b>${(eDays.reduce((a, d) => a + d.ek, 0) / eDays.length).toFixed(1)} kWh</b> a day, about ${enGBP(eDays.reduce((a, d) => a + d.ec, 0) / eDays.length)} including the standing charge (last ${eDays.length} days).`);
    if (gDays.length >= 7) add("fire", "Average gas per day", `<b>${(gDays.reduce((a, d) => a + d.gk, 0) / gDays.length).toFixed(1)} kWh</b> a day, about ${enGBP(gDays.reduce((a, d) => a + d.gc, 0) / gDays.length)} including the standing charge (last ${gDays.length} days).`);
    // Most and least expensive complete days this month
    const mo = this._range(enKey(new Date(today.getFullYear(), today.getMonth(), 1)), enKey(enAdd(today, -1)), L).days.filter((d) => d.ek != null && d.gk != null);
    if (mo.length >= 3) {
      const tot = (d) => d.ec + d.gc, hi = mo.reduce((m, d) => (tot(d) > tot(m) ? d : m), mo[0]), lo = mo.reduce((m, d) => (tot(d) < tot(m) ? d : m), mo[0]);
      add("cash-multiple", "Most and least expensive days this month", `Most: ${enDate(hi.k)} at <b>${enGBP(tot(hi))}</b>. Cheapest: ${enDate(lo.k)} at <b>${enGBP(tot(lo))}</b>.`);
    }
    // Week on week: last 7 published days against the 7 before
    const lastPub = [...Array(10).keys()].map((i) => enKey(enAdd(today, -1 - i))).find((k) => this._daily.days[k] && this._daily.days[k].ek != null);
    if (lastPub) {
      const a = this._range(enKey(enAdd(enDay(lastPub), -6)), lastPub, L), b = this._range(enKey(enAdd(enDay(lastPub), -13)), enKey(enAdd(enDay(lastPub), -7)), L);
      if (!a.eMiss.length && !b.eMiss.length) {
        const p = enPct(a.ek, b.ek);
        add(p > 0 ? "trending-up" : "trending-down", "Compared with the previous week", `The 7 days to ${enDate(lastPub)} used <b>${a.ek.toFixed(0)} kWh</b> of electricity, <b>${Math.abs(p)}% ${p >= 0 ? "more" : "less"}</b> than the week before (${b.ek.toFixed(0)} kWh).`);
      }
      // Month to date against the same days last month
      const d0 = new Date(today.getFullYear(), today.getMonth(), 1), pd0 = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const span = Math.round((enDay(lastPub) - d0) / 86400000);
      if (span >= 0 && enDay(lastPub) >= d0) {
        const a2 = this._range(enKey(d0), lastPub, L), b2 = this._range(enKey(pd0), enKey(enAdd(pd0, span)), L);
        if (!a2.eMiss.length && !b2.eMiss.length && b2.ek > 0) {
          const p = enPct(a2.ek, b2.ek);
          add("calendar-month", "Compared with last month", `${a2.days.length} day${a2.days.length > 1 ? "s" : ""} into the month you have used <b>${a2.ek.toFixed(0)} kWh</b>, <b>${Math.abs(p)}% ${p >= 0 ? "more" : "less"}</b> than the same days last month (${b2.ek.toFixed(0)} kWh).`);
        }
      }
    }
    if (!items.length) return `<div class="empty">Not enough published readings yet for useful insights.</div>`;
    return `<div class="ins">${items.join("")}</div><div class="note" style="margin-top:10px">Insights only use real readings and appear once there is enough data. ${H && H.days < 7 ? "" : ""}</div>`;
  }

  _pApps(L) {
    const apps = this._config.appliances || [], today = new Date(), tk = enKey(today), m0 = enKey(new Date(today.getFullYear(), today.getMonth(), 1));
    const rows = apps.map((a) => {
      let t = this._n(a.today), m = this._n(a.month);
      if (a.energy && this._daily) {
        const days = this._daily.appDays[a.energy] || {};
        t = days[tk] ?? (t ?? 0);
        m = Object.entries(days).filter(([k]) => k >= m0).reduce((s, [, v]) => s + v, 0);
      }
      return { ...a, w: this._n(a.power), t, m };
    }).filter((a) => a.w != null || a.t != null || a.m != null).sort((x, y) => (y.m || 0) - (x.m || 0));
    const house = this._range(m0, tk, L), max = Math.max(0.001, ...rows.map((r) => r.m || 0));
    const list = rows.map((r) => `<div class="app">${hcIcon(r.icon || "power-plug-outline")}<div class="n"><b>${esc(r.name)}</b><i style="width:${(((r.m || 0) / max) * 100).toFixed(1)}%"></i></div>
        <div class="v">${r.w != null ? `${r.w.toFixed(r.w < 10 ? 1 : 0)} W` : "–"}<small>${r.power ? "now" : "no live power"}</small></div>
        <div class="v">${r.t != null ? `${r.t.toFixed(2)}` : "–"}<small>kWh today</small></div>
        <div class="v">${r.m != null ? `${r.m.toFixed(2)}` : "–"}<small>kWh month${house.ek > 0 && r.m ? ` · ${((r.m / house.ek) * 100).toFixed(1)}%` : ""}</small></div></div>`).join("");
    return `<div class="app apph"><span></span><span>Appliance</span><span style="text-align:right">Now</span><span style="text-align:right">Today</span><span style="text-align:right">This month</span></div>
      ${list || `<div class="empty">No appliances report energy.</div>`}
      <div class="note" style="margin-top:12px">Only devices that really measure their own energy are listed; the percentage is the share of the house's electricity this month
        (${house.ek.toFixed(0)} kWh${house.eMiss.length ? `, excluding ${house.eMiss.length} unpublished day${house.eMiss.length > 1 ? "s" : ""}` : ""}).
        The washing machine reports energy per cycle rather than live power.</div>`;
  }
}

/*
 * Glass Home Spotify card: Spotify player and library for the Media page, through the official Spotify
 * integration. Music goes to the living room soundbar by playing on the TV's Spotify Connect device
 * ("Living Room TV"); the TV passes its sound to the soundbar over HDMI ARC.
 *
 *   type: custom:glasshome-spotify-card
 *   entity: media_player.spotify_x        # official Spotify integration
 *   device: Living Room TV                   # Spotify Connect device that plays through the soundbar
 *   device_label: Living room soundbar
 *   device_note: Living Room TV · HDMI ARC
 *   tv: media_player.x                    # Android TV Remote: wakes the TV, opens Spotify, steps the volume
 *   volume_level_entity: media_player.y   # the TV's Google Cast player, which reports its volume
 *   app: com.spotify.tv.android
 *   rows: 2                               # rows of six library covers per page (default 1)
 *
 * Spotify only lists the TV while it is on, and Home Assistant can only browse or start music on a
 * device Spotify knows about, so Play wakes the TV and opens Spotify on it when needed, waits for the
 * TV to appear, moves playback there and then plays. Browsing works only while Spotify has an active
 * device, so the last library that loaded is kept on the tablet and shown with its time.
 * Spotify's search is not offered by the integration, so there is no search box.
 */
const SP_F = { pause: 1, seek: 2, volume: 4, prev: 16, next: 32, source: 2048, browse: 131072, play: 16384, shuffle: 32768, repeat: 262144 };
const SP_CATS = [["current_user_playlists", "Playlists"], ["current_user_saved_tracks", "Liked songs"], ["current_user_recently_played", "Recent"],
  ["current_user_saved_albums", "Albums"], ["current_user_followed_artists", "Artists"], ["current_user_top_tracks", "Top tracks"]];
const SP_STORE = "glasshome_spotify_library_v1";
const SP_PER_PAGE = 6;
const spTime = (s) => (s == null || !isFinite(s) ? "–:––" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const spWait = (ms) => new Promise((r) => setTimeout(r, ms));
// Spotify errors arrive as raw JSON; keep just its message
function spError(e) {
  const m = (e && e.message) || "";
  try { const j = JSON.parse(m); if (j && j.error && j.error.message) return `Spotify: ${j.error.message}`; } catch (x) { /* plain text */ }
  return m;
}
function spLoadStore() {
  try { return JSON.parse(localStorage.getItem(SP_STORE)) || {}; } catch (e) { return {}; }
}
function spSaveStore(v) {
  try { localStorage.setItem(SP_STORE, JSON.stringify(v)); } catch (e) { /* storage unavailable: library reloads next time */ }
}

// Narrow: small cover art beside the title and speaker, then the seek bar, transport and volume on
// their own full-width rows; library chips wrap and the library shows three tiles per row
// (a fairly narrow card, below 640px, already gives the seek bar and controls their own full-width rows,
// with the speaker under the title, so the controls and volume stay on one line and nothing is cut off)
const NARROW_CSS_SPOTIFY = `
  :host { container-type: inline-size; }
  @container (max-width: 640px) {
    .top { grid-template-columns: 120px minmax(0, 1fr); gap: 10px 14px; }
    .top > div:last-child { display: contents; }
    .art { width: 120px; height: 120px; border-radius: 18px; --mdc-icon-size: 52px; }
    .hd { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .pr, .cr { grid-column: 1 / -1; }
    .pr { margin-top: 0; }
    .tn { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-height: 1.25; }
  }
  @container (max-width: 560px) {
    .top { grid-template-columns: 96px minmax(0, 1fr); gap: 10px 14px; }
    .top > div:last-child { display: contents; }
    .art { width: 96px; height: 96px; border-radius: 16px; --mdc-icon-size: 44px; }
    .hd { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .pr, .cr { grid-column: 1 / -1; }
    .pr { margin-top: 0; }
    .cr { flex-direction: column; gap: 6px; }
    .lh { align-items: flex-start; }
    .chips { flex-wrap: wrap; }
    .tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }`;

class GlassHomeSpotifyCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity || !config.device) throw new Error("entity and device are required");
    this._config = { device_label: config.device, ...config };
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._click(e));
      this.shadowRoot.addEventListener("change", (e) => this._change(e));
      this.shadowRoot.addEventListener("input", (e) => this._input(e));
    }
    this._cat = this._cat || "current_user_playlists";
    this._page = this._page || 0;
    this._lib = spLoadStore();
    this._key = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._hidden) this._update();
  }

  getCardSize() {
    return 9;
  }

  connectedCallback() {
    if (!this._io && "IntersectionObserver" in window) {
      this._io = new IntersectionObserver((es) => es.forEach((e) => {
        this._hidden = !e.isIntersecting;
        if (!this._hidden && this._hass) { this._key = null; this._update(); }
        this._timer();
      }));
      this._io.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    this._hidden = true;
    this._timer();
  }

  // Moves the progress bar on every second while playing and visible
  _timer() {
    const on = !this._hidden && this.isConnected && this._st() && this._st().state === "playing";
    if (on && !this._t) this._t = setInterval(() => this._tickProgress(), 1000);
    if (!on && this._t) { clearInterval(this._t); this._t = null; }
  }

  _st() {
    return this._hass && this._hass.states[this._config.entity];
  }

  _has(f) {
    const s = this._st();
    return !!s && ((s.attributes.supported_features || 0) & f) === f;
  }

  _pos() {
    const a = this._st().attributes;
    if (a.media_position == null) return null;
    let p = a.media_position;
    if (this._st().state === "playing" && a.media_position_updated_at) p += (Date.now() - new Date(a.media_position_updated_at)) / 1000;
    return Math.min(p, a.media_duration || p);
  }

  _update() {
    const s = this._st();
    if (!s) {
      this.shadowRoot.innerHTML = `<ha-card style="padding:20px;color:#fff">Spotify is not available (${esc(this._config.entity)}).</ha-card>`;
      return;
    }
    const a = s.attributes, tv = this._config.tv && this._hass.states[this._config.tv];
    const key = JSON.stringify([s.state, a.media_title, a.media_artist, a.media_album_name, a.entity_picture, a.source, a.source_list, a.volume_level,
      a.shuffle, a.repeat, this._config.volume_level_entity && JSON.stringify((this._hass.states[this._config.volume_level_entity] || {}).attributes.volume_level), a.supported_features, a.media_duration, a.media_position, a.media_position_updated_at, tv && tv.state,
      this._busy, this._err, this._sheet, this._cat, this._page, this._libAt, this._tvMuted]);
    if (key !== this._key) {
      this._key = key;
      // A drawing fault stays inside this card instead of stopping the rest of the page
      try { this._render(); } catch (e) {
        this.shadowRoot.innerHTML = `<ha-card style="padding:20px;color:#fff">The Spotify player could not be drawn (${esc(e.message)}).</ha-card>`;
      }
    }
    this._loadLibrary();
    this._timer();
    this._syncVol();
  }

  // After the TV powers on its Cast player reports volume 0, and remote keys do not change that. A Cast volume
  // request makes the TV move the soundbar one step over HDMI ARC and read back its real level, which it then
  // keeps reporting; the remote's volume-down key undoes the step. Once per power-on.
  _syncVol() {
    const c = this._config, s = this._st(), tv = c.tv && this._hass.states[c.tv];
    if (!tv || tv.state === "off" || tv.state === "unavailable") { this._volSynced = false; return; }
    const lv = c.volume_level_entity && this._hass.states[c.volume_level_entity];
    if (this._volSynced || this._busy || this._tvMuted || !lv || lv.attributes.volume_level !== 0) return;
    if (s.attributes.source !== c.device || !["playing", "paused"].includes(s.state)) return;
    this._volSynced = true;
    this._call("media_player", "volume_set", { entity_id: c.volume_level_entity, volume_level: 0.01 })
      .then(() => spWait(1500))
      .then(() => this._call("media_player", "volume_down", { entity_id: c.tv }))
      .catch(() => {});
  }

  _call(domain, service, data) {
    return this._hass.callService(domain, service, data);
  }

  _refresh() {
    return this._call("homeassistant", "update_entity", { entity_id: this._config.entity }).catch(() => {});
  }

  _tvOn() {
    const tv = this._config.tv && this._hass.states[this._config.tv];
    return !tv || tv.state === "on" || tv.state === "playing" || tv.state === "paused" || tv.state === "idle";
  }

  _status(t) {
    this._busy = t;
    this._key = null;
    this._update();
  }

  // Play on the living room soundbar: wake the TV, open Spotify on it, move playback there, play
  async _start(uri, type) {
    if (this._busyRun) return;
    this._busyRun = true;
    this._err = null;
    const c = this._config, st = () => this._st().attributes;
    const listed = () => (st().source_list || []).includes(c.device);
    try {
      // Spotify keeps listing the TV for a while after it is switched off, so wake it whenever it is off
      const wasOff = c.tv && !this._tvOn();
      if (wasOff) {
        this._status("Turning on the TV…");
        await this._call("media_player", "turn_on", { entity_id: c.tv });
        await spWait(6000);
      }
      if (c.tv && c.app && (wasOff || !listed())) {
        this._status("Opening Spotify on the TV…");
        await this._call("media_player", "play_media", { entity_id: c.tv, media_content_type: "app", media_content_id: c.app });
        await spWait(4000);
      }
      for (let i = 0; i < 16 && !listed(); i++) { await spWait(3000); await this._refresh(); }
      if (!listed()) throw new Error("The TV did not show up in Spotify. Check the TV is on and try again.");
      if (st().source !== c.device || wasOff) {
        this._status(`Connecting to the ${c.device_label.toLowerCase()}…`);
        // The TV can take a few seconds to accept Spotify after waking: retry the move
        for (let i = 0; i < 8; i++) {
          await this._call("media_player", "select_source", { entity_id: c.entity, source: c.device }).catch(() => {});
          await spWait(2500);
          await this._refresh();
          if (st().source === c.device) break;
        }
        if (st().source !== c.device) throw new Error("Spotify did not move to the TV. Try again.");
      }
      this._status("Starting…");
      if (uri) await this._call("media_player", "play_media", { entity_id: c.entity, media_content_id: uri, media_content_type: type || "music" });
      // Moving playback to the TV can carry on playing; Spotify refuses Play on a track that already plays
      else { await this._refresh(); if (this._st().state !== "playing") await this._call("media_player", "media_play", { entity_id: c.entity }); }
      await spWait(1200);
      await this._refresh();
    } catch (e) {
      this._err = spError(e) || "Could not start Spotify";
    } finally {
      this._busyRun = false;
      this._status(null);
    }
  }

  _click(e) {
    const b = e.composedPath().find((n) => n.dataset && n.dataset.act);
    if (!b || b.disabled) return;
    const { act, v } = b.dataset, c = this._config, s = this._st(), a = s.attributes, id = { entity_id: c.entity };
    const run = (p) => p.catch((err) => { this._err = spError(err); this._key = null; this._update(); });
    switch (act) {
      case "play":
        if (s.state === "playing") run(this._call("media_player", "media_pause", id));
        else if (s.state === "paused" && a.source && this._has(SP_F.play)) run(this._call("media_player", "media_play", id));
        else this._start();
        break;
      case "prev": run(this._call("media_player", "media_previous_track", id)); break;
      case "next": run(this._call("media_player", "media_next_track", id)); break;
      case "shuffle": run(this._call("media_player", "shuffle_set", { ...id, shuffle: !a.shuffle })); break;
      case "repeat": run(this._call("media_player", "repeat_set", { ...id, repeat: { off: "all", all: "one", one: "off" }[a.repeat] || "off" })); break;
      case "mute":
        if (a.source === c.device && c.tv) {
          // The soundbar never reports mute, so the card remembers each press (mute key toggles it)
          this._tvMuted = !this._tvMuted;
          run(this._call("media_player", "volume_mute", { entity_id: c.tv, is_volume_muted: this._tvMuted }));
          this._key = null; this._update();
        } else if ((a.volume_level || 0) > 0) { this._unmute = a.volume_level; run(this._call("media_player", "volume_set", { ...id, volume_level: 0 })); }
        else run(this._call("media_player", "volume_set", { ...id, volume_level: this._unmute || 0.3 }));
        break;
      case "vol":
        // Changing the volume unmutes the soundbar
        if (a.source === c.device && c.tv) { this._tvMuted = false; run(this._call("media_player", Number(v) > 0 ? "volume_up" : "volume_down", { entity_id: c.tv })); }
        else run(this._call("media_player", "volume_set", { ...id, volume_level: Math.min(1, Math.max(0, (a.volume_level || 0) + Number(v) * 0.05)) }));
        break;
      case "sheet": this._sheet = !this._sheet; this._key = null; this._update(); break;
      case "device":
        this._sheet = false;
        if (v === c.device) this._start();
        else run(this._call("media_player", "select_source", { ...id, source: v }));
        this._key = null; this._update();
        break;
      case "cat": this._cat = v; this._page = 0; this._key = null; this._update(); break;
      case "page": this._page = Math.max(0, this._page + Number(v)); this._key = null; this._update(); break;
      case "item": this._start(v, b.dataset.type); break;
      case "dismiss": this._err = null; this._key = null; this._update(); break;
    }
  }

  // Sliders: show the value while dragging, send it on release
  _input(e) {
    const t = e.target;
    if (t.id === "seek") { this._seeking = true; this.shadowRoot.getElementById("cur").textContent = spTime(Number(t.value)); }
  }

  _change(e) {
    const t = e.target, id = { entity_id: this._config.entity };
    if (t.id === "seek") { this._seeking = false; this._call("media_player", "media_seek", { ...id, seek_position: Number(t.value) }); }
  }

  _tickProgress() {
    if (this._seeking || !this._st()) return;
    const p = this._pos(), r = this.shadowRoot.getElementById("seek"), cur = this.shadowRoot.getElementById("cur");
    if (p == null || !r) return;
    r.value = p;
    cur.textContent = spTime(p);
    r.style.setProperty("--p", `${((p / (Number(r.max) || 1)) * 100).toFixed(2)}%`);
  }

  // Library: browse through the integration while Spotify allows it; keep the last result on the tablet
  _loadLibrary() {
    const cat = this._cat, have = this._lib[cat];
    if (this._libLoading || !this._has(SP_F.browse) || (have && Date.now() - have.at < (have.failed ? 300000 : 1800000))) return;
    this._libLoading = true;
    this._hass.callWS({ type: "media_player/browse_media", entity_id: this._config.entity, media_content_type: `spotify://${cat}`, media_content_id: cat })
      .then((r) => {
        this._lib[cat] = { at: Date.now(), items: (r.children || []).filter((x) => x.can_play && x.title).map((x) => ({
          t: x.title, id: x.media_content_id, type: x.media_content_type, img: x.thumbnail || "" })) };
        spSaveStore(this._lib);
        this._libAt = Date.now();
      })
      .catch(() => { this._lib[cat] = { at: Date.now(), items: [], failed: true }; })
      .finally(() => { this._libLoading = false; this._key = null; this._update(); });
  }

  _render() {
    const c = this._config, s = this._st(), a = s.attributes, on = s.state === "playing", active = ["playing", "paused"].includes(s.state);
    const here = a.source === c.device, pic = a.entity_picture ? (a.entity_picture.startsWith("/") ? this._hass.hassUrl(a.entity_picture) : a.entity_picture) : "";
    const dur = a.media_duration || 0, pos = this._pos() || 0;
    // On the soundbar the TV passes volume to it over HDMI ARC one step at a time, so volume is stepped
    // with the TV's own volume keys (Android TV Remote); the level shown is the TV's reported volume
    const lv = here && c.tv && c.volume_level_entity ? this._hass.states[c.volume_level_entity] : s;
    const vol = lv && lv.attributes.volume_level != null ? Math.round(lv.attributes.volume_level * 100) : null;
    // The soundbar does not report mute back through the TV, so the icon follows the card's own presses
    const muted = here && c.tv ? !!this._tvMuted : active && vol === 0;
    // Through the TV a 0 that the card did not mute is the TV not knowing the soundbar's level yet (see _syncVol)
    const volUnknown = here && c.tv && vol === 0 && !this._tvMuted;
    const volOk = active && (here && c.tv ? true : this._has(SP_F.volume));
    // Status line: where the music is going
    let tone = STATUS.grey, status = `Ready · Play starts music on the ${c.device_label.toLowerCase()}`;
    if (this._busy) { tone = STATUS.purple; status = this._busy; }
    else if (active && here) { tone = STATUS.green; status = `${on ? "Playing" : "Paused"} on the ${c.device_label.toLowerCase()}`; }
    else if (active && a.source) { tone = STATUS.amber; status = `${on ? "Playing" : "Paused"} on ${a.source}: not the ${c.device_label.toLowerCase()}`; }
    const dis = (f) => (this._has(f) && active ? "" : "disabled");
    const devName = here || !a.source ? c.device_label : a.source;
    const devSub = here || !a.source ? (c.device_note || c.device) : `Not the ${c.device_label.toLowerCase()}`;
    const sources = (a.source_list || []);
    const sheet = this._sheet ? `<div class="sheet"><div class="sh"><b>Play on</b><button class="x" data-act="sheet">${hcIcon("close")}</button></div>
        ${[c.device, ...sources.filter((n) => n !== c.device)].map((n) => {
          const main = n === c.device, cur = a.source === n && active;
          return `<button class="dev ${cur ? "on" : ""}" data-act="device" data-v="${esc(n)}">${hcIcon(main ? (c.tv ? "soundbar" : "speaker") : /echo|everywhere/i.test(n) ? "speaker" : /fold|phone/i.test(n) ? "cellphone" : "television")}
            <span><b>${esc(main ? c.device_label : n)}</b><small>${main ? `${esc(c.device_note || n)}${sources.includes(n) || !c.tv ? "" : " · wakes the TV first"}` : `Plays there instead of the ${esc(c.device_label.toLowerCase())}`}</small></span>
            ${cur ? hcIcon("check") : ""}</button>`;
        }).join("")}</div>` : "";
    // Library page
    const rows = c.rows || 1, per = SP_PER_PAGE * rows;
    const lib = this._lib[this._cat], items = (lib && lib.items) || [], pages = Math.max(1, Math.ceil(items.length / per));
    if (this._page >= pages) this._page = pages - 1;
    const shown = items.slice(this._page * per, this._page * per + per);
    const tiles = shown.length ? shown.map((x) => `<button class="tile" data-act="item" data-v="${esc(x.id)}" data-type="${esc(x.type)}">
        <span class="ti" style="${x.img ? `background-image:url('${esc(x.img)}')` : ""}">${x.img ? "" : hcIcon("music")}<i>${hcIcon("play")}</i></span><span class="tn">${esc(x.t)}</span></button>`).join("")
      : `<div class="empty">${!this._has(SP_F.browse) ? "Press Play once and your Spotify library appears here." : !lib ? "Loading your library…" : lib.failed ? "Your library couldn't be loaded. It tries again in a few minutes." : "Nothing here yet. Save some music in Spotify and it appears here."}</div>`;
    const libNote = lib && !this._has(SP_F.browse) ? `Saved from your library at ${new Date(lib.at).toLocaleTimeString(GH_LOCALE, GH_HM)}` : `Tap to play on the ${esc(c.device_label.toLowerCase())}`;
    this.shadowRoot.innerHTML = `<style>
        :host { display: block; }
        ha-card { position: relative; box-sizing: border-box; padding: 16px; border-radius: 26px; color: #fff; overflow: hidden;
          background: radial-gradient(80% 120% at 0% 0%, rgba(139,92,246,0.22) 0%, transparent 60%), ${GLASS_BG}; border: ${GLASS_BORDER};
          box-shadow: ${GLASS_EDGE}; -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }
        button { font: inherit; color: #e9e5f5; border: 0; cursor: pointer; background: rgba(255,255,255,0.07); border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center; touch-action: manipulation; -webkit-tap-highlight-color: transparent; padding: 0; }
        button:disabled { opacity: 0.35; cursor: default; }
        button:active:not(:disabled) { transform: scale(0.95); }
        .top { display: grid; grid-template-columns: 158px minmax(0, 1fr); gap: 18px; align-items: start; }
        .art { width: 158px; height: 158px; border-radius: 20px; background: #1d1636 center / cover no-repeat; box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 0 26px rgba(139,92,246,0.18);
          display: flex; align-items: center; justify-content: center; color: #6b5f99; --mdc-icon-size: 64px; }
        .st { display: flex; align-items: center; gap: 7px; font-size: 13px; color: rgb(${tone}); font-weight: 600; }
        .st i { width: 8px; height: 8px; border-radius: 4px; background: rgb(${tone}); flex: none; }
        .t { font-size: 21px; font-weight: 700; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s { font-size: 15px; color: #c9c4dc; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pr { margin-top: 8px; display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px; gap: 8px; align-items: center; }
        .tm { font-size: 12px; color: #a29db8; font-variant-numeric: tabular-nums; } .tm.r { text-align: right; }
        input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 26px; margin: 0; background: transparent; touch-action: none; }
        input[type=range]::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #a78bfa var(--p, 0%), rgba(255,255,255,0.14) var(--p, 0%)); }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; margin-top: -6px; background: #fff; box-shadow: 0 0 10px rgba(139,92,246,0.6); }
        input[type=range]:disabled { opacity: 0.4; }
        .ctl { display: flex; align-items: center; justify-content: center; gap: 16px; margin-top: 2px; }
        .ctl button { width: 50px; height: 50px; --mdc-icon-size: 26px; background: transparent; }
        .ctl button.sm { width: 46px; height: 46px; --mdc-icon-size: 22px; color: #a29db8; }
        .ctl button.sm.on { color: #c4b5fd; background: rgba(139,92,246,0.18); }
        .ctl .pp { width: 58px; height: 58px; --mdc-icon-size: 36px; background: linear-gradient(160deg, #8b5cf6, #6d28d9); box-shadow: 0 6px 20px rgba(109,40,217,0.45); }
        .hd { display: grid; grid-template-columns: minmax(0, 1fr) 236px; gap: 12px; align-items: center; }
        .cr { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 2px; }
        .cr .ctl { gap: 10px; margin: 0; }
        .vol { display: flex; align-items: center; gap: 6px; flex: none; }
        .vol button { width: 46px; height: 46px; --mdc-icon-size: 22px; flex: none; } .vol button.on { color: #fbbf24; background: rgba(251,191,36,0.15); }
        .vv { width: 44px; text-align: center; font-variant-numeric: tabular-nums; } .vv b { display: block; font-size: 17px; } .vv small { display: block; font-size: 10.5px; color: #a29db8; margin-top: -2px; }
        .dv { width: 100%; border-radius: 16px; height: 56px; padding: 0 10px 0 12px; justify-content: flex-start; gap: 10px; text-align: left; min-width: 0;
          background: ${here || !a.source ? "rgba(52,211,153,0.10)" : "rgba(255,179,64,0.14)"}; border: 1px solid ${here || !a.source ? "rgba(52,211,153,0.28)" : "rgba(255,179,64,0.4)"}; }
        .dv ha-icon { --mdc-icon-size: 24px; color: ${here || !a.source ? "rgb(52,211,153)" : "rgb(255,179,64)"}; flex: none; }
        .dv span { min-width: 0; flex: 1; } .dv ha-icon:last-child { --mdc-icon-size: 20px; color: #a29db8; } .dv b { display: block; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dv small { display: block; font-size: 12px; color: #a29db8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .err { margin-top: 10px; padding: 10px 12px; border-radius: 14px; background: rgba(255,107,107,0.14); color: #ffb4b4; font-size: 13.5px; display: flex; gap: 10px; align-items: center; }
        .err span { flex: 1; } .err button { border-radius: 10px; padding: 6px 10px; font-size: 13px; }
        .lib { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.07); }
        .lh { display: flex; align-items: center; gap: 6px; }
        .chips { display: flex; gap: 6px; flex: 1; min-width: 0; overflow: hidden; }
        .chips button { border-radius: 14px; height: 40px; padding: 0 12px; font-size: 13.5px; font-weight: 600; color: #c9c4dc; white-space: nowrap; }
        .chips button.on { color: #fff; background: linear-gradient(160deg, rgba(139,92,246,0.75), rgba(109,40,217,0.55)); }
        .pg { width: 40px; height: 40px; --mdc-icon-size: 22px; flex: none; }
        .tiles { display: grid; grid-template-columns: repeat(${SP_PER_PAGE}, minmax(0, 1fr)); gap: 10px; margin-top: 8px; min-height: ${128 * rows + 10 * (rows - 1)}px; }
        .tile { border-radius: 16px; background: transparent; display: block; text-align: left; padding: 0; }
        .ti { position: relative; display: flex; align-items: center; justify-content: center; aspect-ratio: 1; border-radius: 14px; background: #1d1636 center / cover no-repeat;
          box-shadow: 0 6px 16px rgba(0,0,0,0.35); color: #6b5f99; --mdc-icon-size: 34px; }
        .ti i { position: absolute; right: 6px; bottom: 6px; width: 34px; height: 34px; border-radius: 50%; background: rgba(109,40,217,0.9); color: #fff;
          display: flex; align-items: center; justify-content: center; --mdc-icon-size: 20px; }
        .tn { display: block; font-size: 12.5px; font-weight: 600; margin-top: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e9e5f5; }
        .ln { display: flex; justify-content: space-between; font-size: 12px; color: #8e8aa0; margin-top: 4px; }
        .empty { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; color: #a29db8; font-size: 14px; }
        .sheet { position: absolute; inset: 0; z-index: 2; padding: 16px; background: rgba(18,13,34,0.97); border-radius: 26px; overflow: auto; }
        .sh { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 17px; }
        .x { width: 44px; height: 44px; }
        .dev { width: 100%; border-radius: 16px; height: 62px; padding: 0 14px; margin-top: 8px; justify-content: flex-start; gap: 12px; text-align: left; --mdc-icon-size: 24px; }
        .dev span { flex: 1; min-width: 0; } .dev b { display: block; font-size: 15px; } .dev small { display: block; font-size: 12.5px; color: #a29db8; }
        .dev.on { background: rgba(139,92,246,0.25); border: 1px solid rgba(167,139,250,0.5); }
        ${NARROW_CSS_SPOTIFY}
      </style>
      <ha-card>
        <div class="top">
          <div class="art" style="${pic && active ? `background-image:url('${esc(pic)}')` : ""}">${pic && active ? "" : hcIcon("spotify")}</div>
          <div style="min-width:0">
            <div class="hd"><div style="min-width:0"><div class="st"><i></i>${esc(status)}</div>
              <div class="t">${esc(active && a.media_title ? a.media_title : "Spotify")}</div>
              <div class="s">${active ? esc([a.media_artist, a.media_album_name].filter(Boolean).join(" · ")) : "Choose music below or press Play"}</div></div>
              <button class="dv" data-act="sheet" ${this._busy ? "disabled" : ""}>${hcIcon(here || !a.source ? (c.tv ? "soundbar" : "speaker") : "alert")}<span><b>${esc(devName)}</b><small>${esc(devSub)}</small></span>${hcIcon("chevron-down")}</button></div>
            <div class="pr"><span class="tm" id="cur">${active ? spTime(pos) : "–:––"}</span><input id="seek" class="noswipe" type="range" min="0" max="${dur || 1}" step="1" value="${pos}" style="--p:${dur ? ((pos / dur) * 100).toFixed(2) : 0}%" ${dis(SP_F.seek)}>
              <span class="tm r">${active && dur ? spTime(dur) : "–:––"}</span></div>
            <div class="cr"><div class="ctl">
              <button class="sm ${a.shuffle ? "on" : ""}" data-act="shuffle" ${dis(SP_F.shuffle)} aria-label="Shuffle">${hcIcon(a.shuffle ? "shuffle" : "shuffle-disabled")}</button>
              <button data-act="prev" ${dis(SP_F.prev)} aria-label="Previous track">${hcIcon("skip-previous")}</button>
              <button class="pp" data-act="play" ${this._busy ? "disabled" : ""} aria-label="${on ? "Pause" : "Play"}">${hcIcon(on ? "pause" : "play")}</button>
              <button data-act="next" ${dis(SP_F.next)} aria-label="Next track">${hcIcon("skip-next")}</button>
              <button class="sm ${a.repeat && a.repeat !== "off" ? "on" : ""}" data-act="repeat" ${dis(SP_F.repeat)} aria-label="Repeat">${hcIcon(a.repeat === "one" ? "repeat-once" : a.repeat === "all" ? "repeat" : "repeat-off")}</button>
            </div>
            <div class="vol"><button class="${muted ? "on" : ""}" data-act="mute" ${volOk ? "" : "disabled"} aria-label="Mute or unmute">${hcIcon(muted ? "volume-off" : "volume-high")}</button>
              <button data-act="vol" data-v="-1" ${volOk ? "" : "disabled"} aria-label="Volume down">${hcIcon("minus")}</button>
              <span class="vv"><b>${volOk && vol != null && !volUnknown ? vol : "–"}</b><small>volume</small></span>
              <button data-act="vol" data-v="1" ${volOk ? "" : "disabled"} aria-label="Volume up">${hcIcon("plus")}</button></div></div>
          </div>
        </div>
        ${this._err ? `<div class="err">${hcIcon("alert-circle-outline")}<span>${esc(this._err)}</span><button data-act="dismiss">OK</button></div>` : ""}
        <div class="lib">
          <div class="lh"><div class="chips">${SP_CATS.map(([k, l]) => `<button class="${this._cat === k ? "on" : ""}" data-act="cat" data-v="${k}">${l}</button>`).join("")}</div>
            <button class="pg" data-act="page" data-v="-1" ${this._page > 0 ? "" : "disabled"} aria-label="Previous page">${hcIcon("chevron-left")}</button>
            <button class="pg" data-act="page" data-v="1" ${this._page < pages - 1 ? "" : "disabled"} aria-label="Next page">${hcIcon("chevron-right")}</button></div>
          <div class="tiles">${tiles}</div>
          <div class="ln"><span>${libNote}</span><span>${items.length ? `${this._page + 1} of ${pages}` : ""}</span></div>
        </div>
        ${sheet}
      </ha-card>`;
  }
}

/* ------------------------------------------------------------------ cameras
 * Many NVRs serve one live stream at a time (a second one stays blank and snapshots come back grey),
 * so this shows one live view and a 2x2 switcher. The stream only runs while the card is on screen,
 * which frees the NVR as soon as the page is swiped away. Handing the NVR's single hardware session to
 * another camera can take from a few seconds to over a minute (the bridge retries for up to ~95 s), so a
 * player that has not started is rebuilt every 30 s for up to two minutes before giving up.
 */
const CAM_RETRY_MS = 30000;
const CAM_TRIES = 4;

class GlassHomeCameraCard extends HTMLElement {
  setConfig(config) {
    if (!Array.isArray(config.cameras) || !config.cameras.length) throw new Error("cameras are required");
    this._config = config;
    this._sel = this._sel && config.cameras.some((c) => c.entity === this._sel) ? this._sel : config.cameras[0].entity;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._click(e));
    }
    this._key = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._player) this._player.hass = hass;
    if (!this._hidden) this._update();
  }

  getCardSize() {
    return 10;
  }

  connectedCallback() {
    if (!this._io && "IntersectionObserver" in window) {
      this._io = new IntersectionObserver((es) => es.forEach((e) => {
        this._hidden = !e.isIntersecting;
        if (this._hidden) this._stop();
        else if (this._hass) { this._key = null; this._update(); }
      }));
      this._io.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    this._hidden = true;
    this._stop();
  }

  _ok(e) {
    const s = this._hass && this._hass.states[e];
    return !!s && s.state !== "unavailable" && s.state !== "unknown";
  }

  _update() {
    const key = JSON.stringify([this._sel, this._config.cameras.map((c) => this._ok(c.entity))]);
    if (key !== this._key) {
      this._key = key;
      this._render();
    }
    if (!this._player) this._start();
  }

  _click(e) {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.act === "cam" && b.dataset.v !== this._sel) {
      this._sel = b.dataset.v;
      this._tries = 0;
      this._stop();
      this._key = null;
      this._update();
    } else if (b.dataset.act === "full") {
      this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: this._sel } }));
    } else if (b.dataset.act === "retry") {
      this._tries = 0;
      this._stop();
      this._start();
    }
  }

  // Tears the player down so its WebRTC session closes and the NVR is free for the next camera
  _stop() {
    clearInterval(this._watch);
    this._watch = null;
    if (this._player) { this._player.remove(); this._player = null; }
  }

  async _start() {
    const box = this.shadowRoot.getElementById("live");
    if (!box || this._hidden || !this._hass) return;
    this._stop();
    if (!this._ok(this._sel)) { this._status("offline"); return; }
    if (GH_DEMO && ghIsDemo(this._sel)) { this._status("demo"); return; }
    this._helpers = this._helpers || await window.loadCardHelpers();
    if (this._player || this._hidden || !box.isConnected) return;
    const p = this._helpers.createCardElement({ type: "picture-entity", entity: this._sel, camera_view: "live",
      show_name: false, show_state: false, tap_action: { action: "none" }, hold_action: { action: "none" } });
    this._player = p;
    box.appendChild(p);
    p.hass = this._hass;
    this._tries = (this._tries || 0) + 1;
    if (this._tries === 1) this._since = Date.now();
    this._status("connecting");
    const t0 = Date.now(), cam = this._sel;
    this._watch = setInterval(() => {
      if (this._player !== p) return;
      if (this._playing(p)) { this._tries = 0; this._status("live"); clearInterval(this._watch); this._watch = null; return; }
      this._status("connecting");
      if (Date.now() - t0 < CAM_RETRY_MS) return;
      if (this._tries < CAM_TRIES && cam === this._sel) this._start();
      else { this._tries = 0; this._stop(); this._status("failed"); }
    }, 1000);
  }

  _playing(root) {
    const walk = (n) => {
      for (const el of n.querySelectorAll("*")) {
        if (el.tagName === "VIDEO" && el.readyState >= 2 && el.videoWidth) return true;
        if (el.shadowRoot && walk(el.shadowRoot)) return true;
      }
      return false;
    };
    return walk(root.shadowRoot || root);
  }

  _status(s) {
    const el = this.shadowRoot.getElementById("ov");
    if (!el) return;
    const name = (this._config.cameras.find((c) => c.entity === this._sel) || {}).name || "";
    const secs = Math.round((Date.now() - (this._since || Date.now())) / 1000);
    const msg = { connecting: `Connecting to ${esc(name)}…${secs >= 8 ? `<small>Cameras on a recorder (NVR) can take up to a minute to switch · ${secs}s</small>` : ""}`,
      offline: `${esc(name)} is offline`,
      demo: `${esc(name)} · demo camera<small>Demo mode shows no video. Your own cameras stream here.</small>`,
      failed: `${esc(name)} did not start<small>The camera or its recorder may still be busy</small><button data-act="retry">Try again</button>` }[s];
    el.innerHTML = msg ? `<span>${msg}</span>` : "";
    el.className = s;
    const badge = this.shadowRoot.getElementById("live-badge");
    if (badge) badge.hidden = s !== "live";
  }

  _render() {
    const cams = this._config.cameras, sel = cams.find((c) => c.entity === this._sel);
    this._stop();
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 12px; border-radius: 26px; background: ${GLASS_BG}; border: ${GLASS_BORDER}; box-shadow: ${GLASS_EDGE}; color: #fff; overflow: hidden; }
        .v { position: relative; aspect-ratio: 16 / 9; border-radius: 18px; overflow: hidden; background: #000; }
        #live, #live > * { position: absolute; inset: 0; }
        #live > * { --ha-card-border-radius: 0; --ha-card-border-width: 0; }
        #ov { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
        #ov span { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 20px; border-radius: 16px;
          background: rgba(0,0,0,0.55); font-size: 16px; color: #e9e5f5; text-align: center; max-width: 80%; }
        #ov small { font-size: 13px; color: #a29db8; }
        #ov.failed, #ov.failed span { pointer-events: auto; }
        .tag { position: absolute; left: 12px; top: 12px; display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 99px;
          background: rgba(0,0,0,0.55); font-size: 15px; font-weight: 600; }
        #live-badge { display: inline-flex; align-items: center; gap: 5px; color: #ff453a; font-size: 12.5px; letter-spacing: 0.06em; }
        #live-badge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #ff453a; }
        #live-badge[hidden] { display: none; }
        button { font: inherit; color: inherit; border: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
        .full { position: absolute; right: 12px; top: 12px; width: 44px; height: 44px; border-radius: 50%; background: rgba(0,0,0,0.55);
          display: flex; align-items: center; justify-content: center; }
        #ov button { padding: 10px 18px; border-radius: 99px; background: rgba(255,255,255,0.16); font-weight: 600; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
        .cam { display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 16px; border-radius: 18px; background: rgba(255,255,255,0.06);
          text-align: left; --mdc-icon-size: 24px; }
        .cam ha-icon { color: #ff453a; }
        .cam span { flex: 1; min-width: 0; } .cam b { display: block; font-size: 16px; } .cam small { display: block; font-size: 13px; color: #a29db8; }
        .cam { min-width: 0; } .cam b, .cam small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cam.on { background: rgba(255,69,58,0.22); border: 1px solid rgba(255,69,58,0.55); }
        .cam.off ha-icon { color: #8e8aa0; }
      </style>
      <ha-card>
        <div class="v">
          <div id="live"></div>
          <div id="ov"></div>
          <div class="tag">${esc(sel.name)}<span id="live-badge" hidden>LIVE</span></div>
          <button class="full" data-act="full" aria-label="Full screen">${hcIcon("fullscreen")}</button>
        </div>
        <div class="grid">${cams.map((c) => {
          const ok = this._ok(c.entity), on = c.entity === this._sel;
          return `<button class="cam ${on ? "on" : ""} ${ok ? "" : "off"}" data-act="cam" data-v="${esc(c.entity)}">${hcIcon(ok ? "cctv" : "cctv-off")}
            <span><b>${esc(c.name)}</b><small>${!ok ? "Offline" : on ? "Watching" : "Tap to watch"}</small></span></button>`;
        }).join("")}</div>
      </ha-card>`;
  }
}


// ------------------------------------------------------------------ shared navigation (glasshome-nav-card)
// One navigation look for every page that is not the swipeable homepage: the same floating glass bar
// as the homepage pager (variant "bar"), or a row of matching glass pills for back / sub-page links
// (variant "links"). Pages in the same order as the homepage pager; the parent page glows.
const WNAV_ALL = [
  { id: "media", title: "Media", icon: "mdi:television-play", feature: "media|spotify|music" },
  { id: "security", title: "Security", icon: "mdi:shield-home-outline", feature: "cctv" },
  { id: "lights", title: "Lights", icon: "mdi:lightbulb-outline", feature: "lighting" },
  { id: "home", title: "Home", icon: "mdi:home-outline" },
  { id: "climate", title: "Climate", icon: "mdi:thermometer", feature: "climate" },
  { id: "devices", title: "Plan", icon: "mdi:floor-plan", feature: "floorplan" },
  { id: "energy", title: "Energy", icon: "mdi:lightning-bolt", feature: "energy" },
];
// navigation.pages in the settings can reorder or rename these; switched-off features drop out.
// The bar ends with a Settings button (navigation.settings: false hides it).
const WNAV_PAGES = ((GH_CFG.navigation && GH_CFG.navigation.pages) || WNAV_ALL).filter((p) => ghFeature(p.feature));
const WNAV_SETTINGS = !(GH_CFG.navigation && GH_CFG.navigation.settings === false);
const wnavGo = (path) => {
  if (!path) return;
  if (/^https?:/.test(path)) { window.open(path, "_blank", "noopener"); return; }
  if (path.startsWith(`${ghBase()}/home#`)) window.__glasshomeNavAsked = true;
  history.pushState(null, "", path);
  window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
};
const WNAV_CSS = `
  :host { display: block; }
  .nav { display: grid; grid-template-columns: repeat(var(--n, 7), minmax(0, 1fr)); gap: 4px; max-width: 900px; margin: 0 auto; box-sizing: border-box;
    padding: 6px; border-radius: 28px; ${lgFloat()} }
  ${LG_NOBLUR(".nav")}
  .nb { height: 60px; border: 0; border-radius: 22px; background: transparent; color: #8e8aa0; font: inherit; font-size: 12.5px; font-weight: 600;
    letter-spacing: 0.1px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: pointer; padding: 0 2px;
    --mdc-icon-size: 25px; transition: background 0.2s ease, color 0.2s ease; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nb.on { color: #fff; background: ${LG_ON_BG}; box-shadow: ${LG_ON_SHADOW}; }
  .nb.on ha-icon { color: #fff; }
  .nb { container-type: inline-size; }
  .nb ha-icon { flex: none; }
  .nt { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @container (max-width: 35.9px) { .nt { display: none; } }
  /* short landscape screens (a phone on its side): icon beside the label, so the bar takes less height */
  @media (max-height: 500px) and (min-width: 600px) {
    .nb { height: 44px; flex-direction: row; gap: 6px; --mdc-icon-size: 21px; }
    .nav { padding: 4px; }
    .spacer { height: 64px; }
  }
  .nb:active, .lk:active { transform: scale(0.96); }
  .wrap { position: fixed; left: 0; right: 0; bottom: 0; z-index: 4; pointer-events: none;
    padding: 2px max(14px, env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) max(14px, env(safe-area-inset-left, 0px)); }
  .wrap .nav { pointer-events: auto; }
  .spacer { height: 84px; }
  .links { display: flex; flex-wrap: wrap; gap: 10px; }
  .lk { flex: 1 1 150px; min-width: 0; height: 52px; border-radius: 22px; border: ${GLASS_BORDER}; cursor: pointer; font: inherit;
    font-size: 15px; font-weight: 600; color: #e9e5f5; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px;
    background: ${GLASS_BG};
    box-shadow: ${GLASS_EDGE}; --mdc-icon-size: 22px;
    -webkit-tap-highlight-color: transparent; touch-action: manipulation; transition: background 0.2s ease; }
  .lk ha-icon { color: #a78bfa; flex: none; }
  .lk span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lk.on { color: #fff; background: ${LG_ON_BG}; box-shadow: ${LG_ON_SHADOW}; border-color: rgba(190,160,255,0.45); }
  .lk.on ha-icon { color: #fff; }
  /* Narrow screens (a phone, a foldable's cover screen): the same compact bar as the homepage */
  @media (max-width: 599px) {
    .wrap { padding-left: max(8px, env(safe-area-inset-left, 0px)); padding-right: max(8px, env(safe-area-inset-right, 0px)); }
    .nav { gap: 2px; padding: 4px; border-radius: 24px; }
    .nb { height: 54px; padding: 0 1px; border-radius: 19px; font-size: 10.5px; letter-spacing: 0; gap: 3px; --mdc-icon-size: 22px; }
    .spacer { height: ${GH_DEMO ? 128 : 74}px; }
    .lk { height: 46px; font-size: 14px; border-radius: 19px; flex-basis: 120px; --mdc-icon-size: 20px; }
  }`;

// Swipe between pages on the pages that are not the homepage pager: one passive listener on the
// document, installed once. The nav card on the page in view says where a left or right swipe goes.
const WNAV_SWIPE = { ctx: null };
const wnavBlocked = (path) => path.some((n) => {
  if (!n || !n.tagName) return false;
  if (NO_SWIPE.test(n.tagName) || /^(HA-DIALOG|HA-MORE-INFO-DIALOG|HA-MD-DIALOG|DIALOG|VIDEO|HA-HLS-PLAYER|HA-WEB-RTC-PLAYER)$/.test(n.tagName)) return true;
  if (n.classList && (n.classList.contains("noswipe") || n.classList.contains("editing"))) return true;
  if (n.nodeType === 1 && n.scrollWidth > n.clientWidth + 4) {
    const ox = getComputedStyle(n).overflowX;
    if (ox === "auto" || ox === "scroll") return true;
  }
  return false;
});
function wnavInstallSwipe() {
  if (window.__glasshomeNavSwipe) return;
  window.__glasshomeNavSwipe = true;
  let g = null;
  document.addEventListener("touchstart", (e) => {
    g = null;
    const ctx = WNAV_SWIPE.ctx;
    if (!ctx || !ctx.el.isConnected || e.touches.length !== 1) return;
    if (wnavBlocked(e.composedPath())) return;
    const t = e.touches[0];
    g = { x: t.clientX, y: t.clientY, t: performance.now(), ctx };
  }, { passive: true, capture: true });
  document.addEventListener("touchcancel", () => { g = null; }, { passive: true, capture: true });
  document.addEventListener("touchend", (e) => {
    const s = g;
    g = null;
    if (!s || !s.ctx.el.isConnected || WNAV_SWIPE.ctx !== s.ctx) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y, dt = performance.now() - s.t;
    const w = window.innerWidth || 400;
    if (dt > 800 || Math.abs(dx) < Math.max(60, w * 0.16) || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    wnavGo(dx < 0 ? s.ctx.next : s.ctx.prev);
  }, { passive: true, capture: true });
}

class GlassHomeNavCard extends HTMLElement {
  setConfig(c) {
    this._config = { variant: "bar", active: "home", ...c };
    if (this.shadowRoot) this._render();
  }
  set hass(h) { this._hass = h; if (!this._done) this._render(); }
  getCardSize() { return 1; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
  connectedCallback() {
    wnavInstallSwipe();
    this._claimSwipe();
  }
  disconnectedCallback() {
    if (WNAV_SWIPE.ctx && WNAV_SWIPE.ctx.el === this) WNAV_SWIPE.ctx = null;
  }
  _claimSwipe() {
    const c = this._config;
    if (!c || c.swipe === false) return;
    // the bar decides swipes; a links row only when it says so (swipe: true or prev/next given)
    if (c.variant !== "bar" && !c.swipe && !c.prev && !c.next) return;
    const i = WNAV_PAGES.findIndex((p) => p.id === c.active);
    const page = (k) => (k >= 0 && k < WNAV_PAGES.length ? `${ghBase()}/home#${WNAV_PAGES[k].id}` : null);
    WNAV_SWIPE.ctx = { el: this, prev: c.prev || page(i - 1), next: c.next || page(i + 1) };
  }
  _render() {
    if (!this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._done = true;
    const c = this._config;
    let body;
    if (c.variant === "links") {
      body = `<div class="links">${(c.links || []).filter((l) => ghFeature(l.feature)).map((l, k) => `<button class="lk${l.active ? " on" : ""}" data-k="${k}">${l.icon ? `<ha-icon icon="${esc(l.icon)}"></ha-icon>` : ""}<span>${esc(l.name || "")}</span></button>`).join("")}</div>`;
    } else {
      body = `<div class="spacer"></div><div class="wrap"><div class="nav" style="--n:${WNAV_PAGES.length + (WNAV_SETTINGS ? 1 : 0)}">${WNAV_PAGES.map((p) => `<button class="nb${p.id === c.active ? " on" : ""}" data-id="${p.id}" aria-label="${esc(ghPageTitle(p.id, p.title))}"><ha-icon icon="${p.icon}"></ha-icon><span class="nt">${esc(ghPageTitle(p.id, p.title))}</span></button>`).join("")}${WNAV_SETTINGS ? `<button class="nb" data-id="settings" aria-label="Settings"><ha-icon icon="mdi:cog-outline"></ha-icon><span class="nt">Settings</span></button>` : ""}</div></div>`;
    }
    this.shadowRoot.innerHTML = `<style>${WNAV_CSS}</style>${body}`;
    this.shadowRoot.querySelectorAll(".nb").forEach((b) => b.addEventListener("click", () => wnavGo(b.dataset.id === "settings" ? `${ghBase()}/settings` : `${ghBase()}/home#${b.dataset.id}`)));
    this.shadowRoot.querySelectorAll(".lk").forEach((b) => b.addEventListener("click", () => {
      const l = (c.links || []).filter((x) => ghFeature(x.feature))[+b.dataset.k] || {};
      wnavGo(l.path);
    }));
    if (this.isConnected) this._claimSwipe();
  }
}

// ------------------------------------------------------------------ TV power (glasshome-tv-power-card)
// Shows the TV's real power state (from the Android TV Remote entity) and runs the glasshome_tv_power
// script, which wakes the TV (Wake-on-LAN, then the remote's power on) or puts it in standby.
// While a press is being carried out further taps are ignored; it only says "On" or "Standby"
// once Home Assistant reports it, and says so plainly if the TV did not respond.
class GlassHomeTvPowerCard extends HTMLElement {
  setConfig(c) {
    this._config = { remote: "remote.living_room_tv", script: "script.glasshome_tv_power", name: "TV Power", ...c };
  }
  getCardSize() { return 2; }
  set hass(h) {
    this._hass = h;
    const r = h.states[this._config.remote], s = h.states[this._config.script];
    const key = `${r ? r.state : "x"}|${s ? s.state : "x"}`;
    if (key === this._key && this.shadowRoot) return;
    this._key = key;
    const running = s && s.state === "on";
    if (this._busy && !running && Date.now() - this._busy.t > 1500) {
      // the script has finished: did the TV get where it was asked to go?
      const want = this._busy.want, now = r ? r.state : "unavailable";
      const ok = want === "on" ? now === "on" : now !== "on";
      this._busy = null;
      if (!ok) this._flash(want === "on" ? "TV did not wake" : "TV did not turn off");
    }
    this._render();
  }
  _flash(text) {
    this._msg = text;
    clearTimeout(this._mT);
    this._mT = setTimeout(() => { this._msg = null; this._render(); }, 7000);
  }
  _press() {
    const h = this._hass;
    if (!h || this._busy) return;
    const r = h.states[this._config.remote], s = h.states[this._config.script];
    if (s && s.state === "on") return;
    const want = r && r.state === "on" ? "off" : "on";
    this._busy = { want, t: Date.now() };
    this._msg = null;
    this._render();
    h.callService("script", "turn_on", { entity_id: this._config.script, variables: { action: want } })
      .catch(() => { this._busy = null; this._flash("Could not reach Home Assistant"); this._render(); });
    // safety net: never stay "busy" forever
    clearTimeout(this._bT);
    this._bT = setTimeout(() => { if (this._busy) { this._busy = null; this._key = null; if (this._hass) this.hass = this._hass; } }, 70000);
  }
  _render() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>
        :host { display: block; height: 100%; }
        ha-card { box-sizing: border-box; height: 100%; min-height: 92px; border-radius: 24px; display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 6px; cursor: pointer; color: #fff; padding: 8px; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
          user-select: none; -webkit-user-select: none; transition: transform 0.12s ease; }
        ha-card:active { transform: scale(0.97); }
        .ic { position: relative; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          --mdc-icon-size: 24px; color: rgb(var(--c)); background: rgba(var(--c),0.15); box-shadow: 0 0 14px rgba(var(--c),0.2); transition: all 0.3s ease; }
        .ic.busy::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid transparent; border-top-color: rgb(var(--c));
          animation: tvrot 1s linear infinite; }
        @keyframes tvrot { to { transform: rotate(360deg); } }
        .n { font-size: 15px; font-weight: 600; }
        .s { font-size: 12.5px; color: #a29db8; text-align: center; line-height: 1.2; }
        .s.err { color: #ffb4b4; }
        /* icon_only: no text, the whole button is green when the TV is on and red when it is off */
        ha-card.only { background: linear-gradient(160deg, rgba(var(--c),0.42), rgba(var(--c),0.18)); border: 1px solid rgba(var(--c),0.55);
          box-shadow: 0 0 18px rgba(var(--c),0.25), inset 0 1px 0 rgba(255,255,255,0.12); transition: background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease; }
        ha-card.only .n, ha-card.only .s { display: none; }
        ha-card.only .ic { width: 56px; height: 56px; --mdc-icon-size: 32px; color: #fff; background: rgba(var(--c),0.35); }
      </style><ha-card role="button" tabindex="0"><div class="ic"><ha-icon icon="mdi:power"></ha-icon></div><div class="n"></div><div class="s"></div></ha-card>`;
      const card = this.shadowRoot.querySelector("ha-card");
      card.addEventListener("click", () => this._press());
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this._press(); } });
    }
    const h = this._hass;
    if (!h) return;
    const r = h.states[this._config.remote], s = h.states[this._config.script];
    const st = r ? r.state : "unavailable";
    const running = !!this._busy || (s && s.state === "on");
    const want = this._busy ? this._busy.want : null;
    const only = !!this._config.icon_only;
    let sub, c;
    if (running) { sub = want === "off" ? "Turning off…" : "Waking the TV…"; c = "196,181,253"; }
    else if (st === "on") { sub = "On"; c = "52,211,153"; }
    else if (st === "off") { sub = "Standby"; c = only ? "239,68,68" : "255,122,182"; }
    else { sub = "Standby · asleep"; c = only ? "239,68,68" : "255,122,182"; }
    const ic = this.shadowRoot.querySelector(".ic"), sEl = this.shadowRoot.querySelector(".s");
    const hc = this.shadowRoot.querySelector("ha-card");
    hc.style.setProperty("--c", c);
    hc.classList.toggle("only", only);
    ic.classList.toggle("busy", running);
    this.shadowRoot.querySelector(".n").textContent = this._config.name;
    sEl.textContent = this._msg || sub;
    sEl.classList.toggle("err", !!this._msg);
    this.shadowRoot.querySelector("ha-card").setAttribute("aria-label", `${this._config.name}: ${this._msg || sub}`);
  }
}

// Readable SVG text at any card size: minimum on-screen size in px (data-min on a text overrides it)
const GH_SVG_MIN = 10;
function ghSvgFix(root) {
  for (const svg of root.querySelectorAll("svg[viewBox]")) {
    const vb = svg.viewBox && svg.viewBox.baseVal, w = svg.getBoundingClientRect().width;
    if (!vb || !vb.width || vb.width <= 48 || !w) continue; // icons are left alone
    const k = w / vb.width;
    for (const t of svg.querySelectorAll("text")) {
      if (t.dataset.fs == null) t.dataset.fs = t.getAttribute("font-size") || "";
      const base = Number(t.dataset.fs);
      if (!base) continue;
      if (t.classList.contains("gh-dims")) { t.style.display = base * k < 8.5 ? "none" : ""; continue; }
      const min = Number(t.dataset.min) || GH_SVG_MIN;
      const fs = base * k < min ? `${(min / k).toFixed(2)}px` : "";
      if (t.style.fontSize !== fs) t.style.fontSize = fs;
    }
  }
}
function ghSvgWatch(host, root) {
  let q = 0;
  const run = () => { if (!q) q = requestAnimationFrame(() => { q = 0; ghSvgFix(root); }); };
  try {
    new ResizeObserver(run).observe(host);
    new MutationObserver(run).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["viewBox"] });
  } catch (e) { /* older browser: charts keep their drawn sizes */ }
}

// Liquid Glass: every GlassHome card adopts the shared micro-interaction sheet when it creates its shadow root
const LG_SHEET = (() => { try { const sh = new CSSStyleSheet(); sh.replaceSync(LG_SHARED_CSS); return sh; } catch (e) { return null; } })();
if (LG_SHEET) {
  [GlassHomeCameraCard, GlassHomeHeatingCard, GlassHomeSpotifyCard, GlassHomeEnergyCard, GlassHomeLaundryCard, GlassHomeWasherCard, GlassHomeBinBannerCard, GlassHomeBinCard,
    GlassHomeHeroCard, GlassHomeChipCard, GlassHomeAllCard, GlassHomeHouseCard, GlassHomeScheduleCard, GlassHomeLightCard, GlassHomeRoomCard, GlassHomePagerCard, GlassHomeNavCard,
    GlassHomeTvPowerCard, GlassHomeWeatherSheet].forEach((C) => {
    C.prototype.attachShadow = function (init) {
      const root = HTMLElement.prototype.attachShadow.call(this, init);
      try { root.adoptedStyleSheets = [...root.adoptedStyleSheets, LG_SHEET]; } catch (e) { /* older browser: the card simply keeps its own styles */ }
      if (C === GlassHomeEnergyCard || C === GlassHomeWasherCard || C === GlassHomeLaundryCard || C === GlassHomeHeatingCard
        || C === GlassHomeHouseCard || C === GlassHomeWeatherSheet) ghSvgWatch(this, root);
      return root;
    };
  });
}
customElements.define("glasshome-camera-card", GlassHomeCameraCard);
customElements.define("glasshome-heating-card", GlassHomeHeatingCard);
customElements.define("glasshome-spotify-card", GlassHomeSpotifyCard);
customElements.define("glasshome-energy-card", GlassHomeEnergyCard);
customElements.define("glasshome-laundry-card", GlassHomeLaundryCard);
customElements.define("glasshome-washer-card", GlassHomeWasherCard);
customElements.define("glasshome-bin-banner-card", GlassHomeBinBannerCard);
customElements.define("glasshome-bin-card", GlassHomeBinCard);
customElements.define("glasshome-hero-card", GlassHomeHeroCard);
customElements.define("glasshome-chip-card", GlassHomeChipCard);
customElements.define("glasshome-all-card", GlassHomeAllCard);
customElements.define("glasshome-house-card", GlassHomeHouseCard);
customElements.define("glasshome-schedule-card", GlassHomeScheduleCard);
customElements.define("glasshome-light-card", GlassHomeLightCard);
customElements.define("glasshome-room-card", GlassHomeRoomCard);
customElements.define("glasshome-pager-card", GlassHomePagerCard);
customElements.define("glasshome-nav-card", GlassHomeNavCard);
customElements.define("glasshome-tv-power-card", GlassHomeTvPowerCard);
window.customCards = window.customCards || [];
[
  ["glasshome-hero-card", "Glass Home Hero", "Welcome panel: greeting, clock, live sky, weather forecast and status pills."],
  ["glasshome-pager-card", "Glass Home Pager", "Swipeable pages of cards with dots, an icon bar and an on-device layout editor."],
  ["glasshome-nav-card", "Glass Home Navigation", "Floating glass page bar, or glass link pills."],
  ["glasshome-chip-card", "Glass Home Chip", "Small glass status tile with a tinted icon and live status."],
  ["glasshome-light-card", "Glass Home Light", "Tap to toggle, button for full light controls."],
  ["glasshome-room-card", "Glass Home Room", "Room on/off with a count of what is on."],
  ["glasshome-all-card", "Glass Home All Lights", "One button for a group of lights and plugs."],
  ["glasshome-heating-card", "Glass Home Heating", "Hive thermostat control, weekly heating schedule and heating insights."],
  ["glasshome-energy-card", "Glass Home Energy", "Octopus Energy electricity, gas, costs, history and appliances."],
  ["glasshome-spotify-card", "Glass Home Spotify", "Spotify player and library for a chosen Spotify Connect device."],
  ["glasshome-tv-power-card", "Glass Home TV Power", "TV power with Wake-on-LAN, through a script."],
  ["glasshome-camera-card", "Glass Home Cameras", "One live camera view with a camera switcher."],
  ["glasshome-laundry-card", "Glass Home Laundry", "Live washing machine panel (SmartThings washers)."],
  ["glasshome-washer-card", "Glass Home Washer", "Laundry page sections: wash settings, energy and water, insights, history."],
  ["glasshome-bin-card", "Glass Home Bins", "Next bin collection, from the calendar in the glasshome: settings."],
  ["glasshome-bin-banner-card", "Glass Home Bin Reminder", "Bin reminder banner, shown the evening before a collection."],
  ["glasshome-schedule-card", "Glass Home Schedule", "Week timeline of a schedule helper."],
  ["glasshome-house-card", "Glass Home Floor Plan", "Interactive 2D floor plan with furniture and live devices."],
].forEach(([type, name, description]) => window.customCards.push({ type, name, description }));
console.info(`%c GLASS-HOME %c ${WHC_VERSION} `, "background:#7c3aed;color:#fff", "background:#1e1533;color:#c4b5fd");

// ================================================================== setup placeholder
// Drawn in place of a card whose settings are not in the glasshome: settings yet, or whose entities do not
// exist in this Home Assistant. It says exactly what to add and links to the Setup page.
const GH_SETUP_CSS = `
  :host { display: block; height: 100%; container-type: inline-size; }
  ha-card { box-sizing: border-box; height: 100%; min-height: 92px; padding: 14px 16px; border-radius: 24px; color: #fff;
    background: repeating-linear-gradient(135deg, rgba(167,139,250,0.05) 0 10px, transparent 10px 20px), ${GLASS_BG};
    border: 1px dashed rgba(167,139,250,0.45); box-shadow: ${GLASS_EDGE}; display: flex; gap: 12px; align-items: flex-start; }
  .ic { flex: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: rgba(167,139,250,0.16); color: #c4b5fd; --mdc-icon-size: 22px; }
  .tx { min-width: 0; flex: 1; }
  .t { font-size: 15px; font-weight: 650; }
  .s { font-size: 12.5px; color: #a29db8; margin-top: 3px; line-height: 1.35; overflow-wrap: anywhere; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; color: #ddd6fe;
    background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 6px; }
  button { margin-top: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(139,92,246,0.25); color: #fff; font: inherit;
    font-size: 12.5px; font-weight: 600; border-radius: 14px; padding: 5px 12px; cursor: pointer; }
  @container (max-width: 220px) { ha-card { flex-direction: column; } .s { display: none; } }`;
class GlassHomeSetupCard extends HTMLElement {
  setConfig(c) { this._config = c || {}; this._render(); }
  set hass(h) { this._hass = h; }
  getCardSize() { return 2; }
  getGridOptions() { return { columns: 6, rows: 2 }; }
  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const c = this._config, miss = c.missing || [], abs = c.absent || [];
    const list = (a) => a.slice(0, 3).map((x) => `<code>${esc(x)}</code>`).join(" ") + (a.length > 3 ? ` +${a.length - 3}` : "");
    const why = miss.length
      ? `Add ${list(miss)} to the dashboard's <code>glasshome:</code> settings.`
      : `Not found in Home Assistant: ${list(abs)}. Check the entity ids in the dashboard's <code>glasshome:</code> settings.`;
    this.shadowRoot.innerHTML = `<style>${GH_SETUP_CSS}</style><ha-card>
      <div class="ic"><ha-icon icon="mdi:puzzle-outline"></ha-icon></div>
      <div class="tx"><div class="t">${esc(c.label ? `Set up ${c.label}` : "Needs setting up")}</div><div class="s">${why}</div>
      <button type="button">Open setup</button></div></ha-card>`;
    this.shadowRoot.querySelector("button").addEventListener("click", (e) => { e.stopPropagation(); wnavGo(`${ghBase()}/setup`); });
  }
}

// ================================================================== slot: any card, filled in from the config
//   type: custom:glasshome-slot-card
//   feature: energy                 # optional: left out completely while the feature is switched off
//   setup_label: Energy             # optional: the name used on the setup placeholder
//   card: { type: tile, entity: "[[lighting.hall]]" }
class GlassHomeSlotCard extends HTMLElement {
  setConfig(c) {
    if (!c || !c.card) throw new Error("card is required");
    ghCheckDashboard();
    this._config = c;
    this._el = null;
    this._built = false;
    if (this._hass) this._build();
  }
  set hass(h) {
    this._hass = h;
    if (!this._built) this._build();
    else if (this._el) this._el.hass = h;
  }
  getCardSize() { return this._el && this._el.getCardSize ? this._el.getCardSize() : 2; }
  getGridOptions() {
    if (this._config && this._config.grid_options) return this._config.grid_options;
    return this._el && this._el.getGridOptions ? this._el.getGridOptions() : { columns: 6, rows: 2 };
  }
  getLayoutOptions() { return this._el && this._el.getLayoutOptions ? this._el.getLayoutOptions() : {}; }
  async _build() {
    this._built = true;
    const c = this._config;
    const raw = { ...c.card, feature: c.feature, setup_label: c.setup_label || c.card.setup_label };
    const prep = ghPrepare(raw, this._hass);
    if (prep.off) {
      this.hidden = true;
      this.style.display = "none";
      this.dispatchEvent(new CustomEvent("card-visibility-changed", { bubbles: true, composed: true, detail: { value: false } }));
      return;
    }
    const helpers = await window.loadCardHelpers();
    const el = helpers.createCardElement(prep.ready ? prep.cfg : ghPlaceholderConfig(raw, prep));
    el.hass = this._hass;
    this._el = el;
    this.replaceChildren(el);
    this.style.display = "block";
    this.style.height = "100%";
  }
}

// ================================================================== rooms: every room in the config
//   type: custom:glasshome-rooms-card
//   rooms: "[[rooms]]"      # [{ name, icon, entities: [entity id or { entity, name }] }]
const GH_ROOMS_CSS = `
  :host { display: block; container-type: inline-size; }
  .room { margin: 0 0 18px; }
  .hd { display: flex; align-items: center; gap: 10px; margin: 4px 4px 10px; color: #fff; font-size: clamp(18px, 4.5cqi, 22px); font-weight: 700; }
  .hd ha-icon { color: #a78bfa; --mdc-icon-size: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 170px), 1fr)); gap: 10px; }
  @container (max-width: 380px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } }`;
class GlassHomeRoomsCard extends HTMLElement {
  setConfig(c) {
    if (!Array.isArray(c.rooms)) throw new Error("rooms must be a list (rooms: \"[[rooms]]\")");
    this._config = c;
    this._els = null;
    if (this._hass) this._build();
  }
  set hass(h) {
    this._hass = h;
    if (!this._els) this._build();
    else this._els.forEach((e) => { e.hass = h; });
  }
  getCardSize() { return 6; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
  async _build() {
    this._els = [];
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const helpers = await window.loadCardHelpers();
    const root = document.createElement("div");
    for (const room of this._config.rooms) {
      const sec = document.createElement("div");
      sec.className = "room";
      sec.innerHTML = `<div class="hd">${room.icon ? `<ha-icon icon="${esc(room.icon)}"></ha-icon>` : ""}${esc(room.name || "")}</div><div class="grid"></div>`;
      const grid = sec.querySelector(".grid");
      const list = this._config.use === "lights" ? room.lights || [] : room.entities || room.lights || [];
      if (!list.length) continue;
      for (const it of list) {
        const e = typeof it === "string" ? { entity: it } : it;
        const cfg = this._hass.states[e.entity]
          ? { type: this._config.use === "lights" ? "custom:glasshome-light-card" : "tile", entity: e.entity, ...(e.name ? { name: e.name } : {}), ...(e.icon ? { icon: e.icon } : {}) }
          : { type: "custom:glasshome-setup-card", label: e.name || e.entity, absent: [e.entity], missing: [] };
        const el = helpers.createCardElement(cfg);
        el.hass = this._hass;
        this._els.push(el);
        grid.append(el);
      }
      root.append(sec);
    }
    this.shadowRoot.replaceChildren(Object.assign(document.createElement("style"), { textContent: GH_ROOMS_CSS }), root);
  }
}

// ================================================================== setup (onboarding) page
// Lists every part of the dashboard, says what each needs, and marks it complete only when the
// setting exists in the glasshome: settings AND every entity it names exists in this Home Assistant.
const GH_STEPS = [
  { id: "config", label: "Settings", icon: "mdi:file-cog-outline", help: "Add a glasshome: section to this dashboard (see config/glasshome-config.example.yaml)." },
  { id: "household", label: "Household", icon: "mdi:home-heart", paths: ["household.name"], help: "Name used in the greeting, plus your time zone and locale." },
  { id: "weather", label: "Weather", icon: "mdi:weather-partly-cloudy", feature: "weather", paths: ["weather.entity"], help: "Any weather entity (Met.no is set up by default in Home Assistant)." },
  { id: "lighting", label: "Lights and rooms", icon: "mdi:lightbulb-group-outline", feature: "lighting", paths: ["lighting.all", "rooms"], help: "Your lights and plugs, grouped into rooms." },
  { id: "climate", label: "Climate", icon: "mdi:thermostat", feature: "climate", paths: ["climate.thermostat"], help: "Any climate entity. Used by the hero pill and the Climate page." },
  { id: "presence", label: "Presence", icon: "mdi:account-heart-outline", feature: "presence", paths: ["presence.person"], help: "A person entity for the Home / Away pill." },
  { id: "news", label: "News", icon: "mdi:newspaper-variant-outline", feature: "news", paths: ["news.todo"], services: ["glasshome_news.fetch"], help: "Install the Glass Home News integration (custom_components/glasshome_news) and create a Local To-do list for saved stories." },
  { id: "heating_hive", label: "Hive heating control", icon: "mdi:fire", feature: "heating_hive", paths: ["heating.climate", "heating.current", "heating.target", "heating.boiler", "heating.boost", "heating.schedule", "heating.control", "heating.comfort", "heating.eco"], help: "Hive thermostat, plus the helpers and automation in packages/glasshome_heating.yaml." },
  { id: "energy", label: "Energy", icon: "mdi:lightning-bolt", feature: "energy", paths: ["energy.electricity"], alsoPaths: ["energy.gas"], help: "Choose your supplier and meters in Settings, Energy. The Connection guides explain each supplier." },
  { id: "media", label: "Media", icon: "mdi:television-play", feature: "media", paths: ["media.tv"], help: "A media player for your TV." },
  { id: "spotify", label: "Spotify", icon: "mdi:spotify", feature: "spotify", paths: ["media.spotify", "media.spotify_device"], help: "Spotify integration, and the Spotify Connect device name to play on." },
  { id: "tv_power", label: "TV power", icon: "mdi:power", feature: "tv_power", paths: ["media.tv_remote", "media.tv_power_script"], help: "Android TV Remote integration and the script in packages/glasshome_tv_power.yaml." },
  { id: "cctv", label: "Cameras", icon: "mdi:cctv", feature: "cctv", paths: ["cctv.cameras"], help: "Any camera entities." },
  { id: "laundry", label: "Laundry", icon: "mdi:washing-machine", feature: "laundry", paths: ["laundry.machine_state", "laundry.job_state", "laundry.completion_time"], help: "A SmartThings washing machine and packages/glasshome_laundry.yaml." },
  { id: "bins", label: "Bin collections", icon: "mdi:delete-outline", feature: "bins", paths: ["bins"], help: "Your council's collection dates, or a repeating rotation." },
  { id: "floorplan", label: "Floor plan", icon: "mdi:floor-plan", feature: "floorplan", paths: ["floorplan.arch"], optionalPaths: ["floorplan.images"], help: "Uses a sample plan until you add your own (docs/floorplan.md)." },
];
const GH_DEPS = [
  { label: "card-mod", el: "card-mod", need: "Required", help: "HACS → Frontend → card-mod" },
  { label: "kiosk-mode", test: () => !!window.kioskMode || !!customElements.get("kiosk-mode"), need: "Optional", help: "Hides the sidebar on wall tablets" },
];
const GH_ONB_CSS = `
  :host { display: block; container-type: inline-size; color: #fff; }
  ha-card { padding: clamp(14px, 4cqi, 24px); border-radius: 26px; }
  ${GH_DEMO ? "@media (max-width: 599px) { :host { margin-bottom: 124px; } }" : ""}
  h1 { margin: 0; font-size: clamp(24px, 6cqi, 34px); font-weight: 750; letter-spacing: -0.5px; }
  .sub { color: #a29db8; margin: 6px 0 16px; font-size: 14.5px; line-height: 1.4; }
  .bar { height: 12px; border-radius: 6px; background: rgba(255,255,255,0.08); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 6px; background: linear-gradient(90deg, #8b5cf6, #34d399); transition: width 0.5s ease; }
  .pct { display: flex; justify-content: space-between; font-size: 13px; color: #c4b5fd; margin: 8px 2px 18px; }
  .list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 10px; }
  .it { display: flex; gap: 12px; padding: 12px 14px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); }
  .it .ic { flex: none; width: 38px; height: 38px; border-radius: 50%; display: flex; align-items: center; justify-content: center; --mdc-icon-size: 21px;
    color: rgb(var(--c)); background: rgba(var(--c),0.16); }
  .it .n { font-weight: 650; font-size: 15px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .tag { font-size: 11px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; padding: 2px 8px; border-radius: 10px;
    color: rgb(var(--c)); background: rgba(var(--c),0.14); }
  .it .h { font-size: 12.5px; color: #a29db8; margin-top: 3px; line-height: 1.35; overflow-wrap: anywhere; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; color: #ddd6fe; background: rgba(255,255,255,0.06);
    padding: 1px 5px; border-radius: 6px; }
  h2 { font-size: 17px; margin: 22px 2px 10px; }
  @container (max-width: 420px) { .it { padding: 10px 12px; } .it .ic { width: 32px; height: 32px; } }`;
class GlassHomeOnboardingCard extends HTMLElement {
  setConfig(c) { this._config = c || {}; ghCheckDashboard(); }
  set hass(h) {
    const first = !this._hass;
    this._hass = h;
    if (first) this._check();
    else if (Date.now() - (this._at || 0) > 10000) this._check();
  }
  getCardSize() { return 12; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
  async _fileOk(name) {
    this._files = this._files || {};
    if (!(name in this._files)) {
      this._files[name] = await fetch(new URL(name, GH_ASSETS).href, { method: "HEAD", cache: "no-store" }).then((r) => r.ok).catch(() => false);
    }
    return this._files[name];
  }
  async _check() {
    this._at = Date.now();
    const h = this._hass, rows = [];
    for (const st of GH_STEPS) {
      const on = !st.feature || ghFeature(st.feature);
      if (st.id === "config") { rows.push({ st, status: !GH_CFG_FOUND ? "todo" : GH_DEMO ? "warn" : "done", note: !GH_CFG_FOUND ? esc(st.help) : GH_DEMO ? "Demo mode: a fictional home is shown and nothing is sent to your devices. Remove <code>demo: true</code> when your own settings are in." : "Found in this dashboard and loaded." }); continue; }
      if (!on) { rows.push({ st, status: "off", note: `Switched off. Turn it on in Settings, Dashboard features (or set <code>features.${st.feature}: true</code>).` }); continue; }
      const missing = (st.paths || []).filter((p) => ghEmpty(ghGet(p)));
      const ents = ghEntitiesIn([...(st.paths || []), ...(st.alsoPaths || [])].map((p) => ghGet(p)), []);
      // sensor.glasshome_*_today and weather.glasshome_* are made in the browser, not by Home Assistant
      const absent = [...new Set(ents)].filter((id) => !h.states[id] && !/^(weather\.glasshome_|sensor\.glasshome_[a-z]+_today$)/.test(id));
      const svcMissing = (st.services || []).filter((s) => { const [d, n] = s.split("."); return !(h.services[d] && h.services[d][n]); });
      const fileMissing = st.file && !(await this._fileOk(st.file)) ? [st.file] : [];
      let status = "done", note = "Configured and every entity was found.";
      if (st.optionalPaths && missing.length && !absent.length) {
        const own = st.optionalPaths.some((p) => !ghEmpty(ghGet(p)));
        status = own ? "done" : "warn";
        note = own ? "Your own plan picture is set." : "Showing the sample plan, not your home. Upload a picture of your plan or draw it in Settings, Floor plan.";
      }
      else if (missing.length) { status = "todo"; note = `Add ${missing.map((m) => `<code>${esc(m)}</code>`).join(" ")}. ${esc(st.help)}`; }
      else if (absent.length) { status = "warn"; note = `Not found in Home Assistant: ${absent.slice(0, 4).map((m) => `<code>${esc(m)}</code>`).join(" ")}${absent.length > 4 ? ` +${absent.length - 4}` : ""}`; }
      else if (svcMissing.length) { status = "warn"; note = `Missing service ${svcMissing.map((m) => `<code>${esc(m)}</code>`).join(" ")}. ${esc(st.help)}`; }
      else if (fileMissing.length) { status = "warn"; note = `Missing file <code>${esc(fileMissing[0])}</code>. ${esc(st.help)}`; }
      rows.push({ st, status, note });
    }
    this._render(rows);
  }
  _render(rows) {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const used = rows.filter((r) => r.status !== "off"), done = used.filter((r) => r.status === "done").length;
    const pct = used.length ? Math.round((done / used.length) * 100) : 0;
    const look = { done: ["52,211,153", "Complete", "mdi:check-circle"], todo: ["255,179,64", "To do", "mdi:progress-wrench"],
      warn: ["255,107,107", "Check", "mdi:alert-circle-outline"], off: ["142,138,160", "Off", "mdi:toggle-switch-off-outline"] };
    const item = (r) => {
      const [c, tag] = look[r.status];
      return `<div class="it" style="--c:${c}"><div class="ic"><ha-icon icon="${r.st.icon}"></ha-icon></div><div>
        <div class="n">${esc(r.st.label)}<span class="tag">${tag}</span></div><div class="h">${r.note}</div></div></div>`;
    };
    const deps = GH_DEPS.map((d) => {
      const ok = d.el ? !!customElements.get(d.el) : d.test();
      const c = ok ? "52,211,153" : d.need === "Required" ? "255,107,107" : "142,138,160";
      return `<div class="it" style="--c:${c}"><div class="ic"><ha-icon icon="${ok ? "mdi:check-circle" : "mdi:package-variant"}"></ha-icon></div><div>
        <div class="n">${esc(d.label)}<span class="tag">${ok ? "Installed" : d.need}</span></div><div class="h">${esc(d.help)}</div></div></div>`;
    }).join("");
    this.shadowRoot.innerHTML = `<style>${GH_ONB_CSS}</style><ha-card>
      <h1>Set up ${esc((GH_CFG.household && GH_CFG.household.name) || "Glass Home")}</h1>
      <div class="sub">Each part is marked complete only when its settings are in this dashboard's <code>glasshome:</code> section and every entity it names exists in Home Assistant. Reload the page after changing the settings.</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="pct"><span>${done} of ${used.length} parts ready</span><span>${pct}%</span></div>
      <div class="list">${rows.map(item).join("")}</div>
      <h2>Dependencies</h2><div class="list">${deps}</div></ha-card>`;
  }
}

customElements.define("glasshome-setup-card", GlassHomeSetupCard);
customElements.define("glasshome-slot-card", GlassHomeSlotCard);
customElements.define("glasshome-rooms-card", GlassHomeRoomsCard);
customElements.define("glasshome-onboarding-card", GlassHomeOnboardingCard);
window.customCards.push(
  { type: "glasshome-slot-card", name: "Glass Home Slot", description: "Any card, filled in from the glasshome: settings, with a setup placeholder when settings are missing." },
  { type: "glasshome-rooms-card", name: "Glass Home Rooms", description: "Every room in the glasshome: settings with its devices." },
  { type: "glasshome-onboarding-card", name: "Glass Home Setup", description: "Setup checklist with progress, checked against your Home Assistant." },
);

// Every Glass Home card sees demo entities in demo mode (no effect otherwise)
ghWrapCards();


// ================================================================== setup wizard and Settings page
//   type: custom:glasshome-wizard-card      (the dashboard's "welcome" view, opened on the first visit)
//   type: custom:glasshome-settings-card    (the dashboard's "settings" view, from the nav bar)
// Both edit the same draft (see the setup model above) and save it into this dashboard's glasshome:
// settings with Home Assistant's own lovelace/config/save call, over the signed-in connection: Glass
// Home never asks for, stores or sends a token or password. Saving needs an administrator account (Home
// Assistant's rule for editing dashboards). Until then the draft is kept per user in Home Assistant
// (frontend user data), so a refresh, another device or a trip to Settings > Devices & services to add an
// integration loses nothing.
const GHS_LOCALES = [["", "Same as this browser"], ["en-GB", "English (UK)"], ["en-US", "English (US)"], ["en-IE", "English (Ireland)"], ["en-AU", "English (Australia)"],
  ["en-CA", "English (Canada)"], ["en-NZ", "English (New Zealand)"], ["de-DE", "Deutsch"], ["fr-FR", "Français"], ["es-ES", "Español"], ["it-IT", "Italiano"], ["nl-NL", "Nederlands"]];
const GHS_STEP_INFO = {
  welcome: ["Welcome", "mdi:hand-wave-outline"], profile: ["You", "mdi:account-heart-outline"], weather: ["Weather", "mdi:weather-partly-cloudy"],
  connect: ["Devices", "mdi:connection"], rooms: ["Rooms", "mdi:floor-plan"], devices: ["Dashboard", "mdi:view-dashboard-edit-outline"],
  personalise: ["Look", "mdi:palette-outline"], features: ["Extras", "mdi:puzzle-outline"], done: ["Finish", "mdi:check-decagram-outline"],
};
// the welcome screen's list of steps
const GHS_STEP_TITLE = { profile: "You and your home", weather: "Weather", connect: "Your devices", rooms: "Rooms", devices: "What's on the dashboard",
  personalise: "Look", features: "Extras", done: "Check and save" };
const GHS_STEP_HINT = { profile: "Your name, clock, units and currency", weather: "Your town, for the live sky and forecast", connect: "See what Home Assistant already controls",
  rooms: "Bring in your rooms from Home Assistant", devices: "Star, rename or hide devices", personalise: "Background and page names",
  features: "Heating, TV, music, cameras, energy and bins", done: "A summary, then save" };
const GHS_TABS = [["profile", "Profile and home", "mdi:account-heart-outline"], ["weather", "Location and weather", "mdi:weather-partly-cloudy"],
  ["connect", "Devices and integrations", "mdi:connection"], ["rooms", "Rooms", "mdi:floor-plan"], ["devices", "Devices on the dashboard", "mdi:view-dashboard-edit-outline"],
  ["personalise", "Appearance", "mdi:palette-outline"], ["features", "Dashboard features", "mdi:puzzle-outline"],
  ["bins", "Bin collections", "mdi:delete-variant"], ["energy", "Energy", "mdi:lightning-bolt"], ["media", "Media and music", "mdi:music-circle-outline"],
  ["plan", "Floor plan", "mdi:floor-plan"], ["guides", "Connection guides", "mdi:book-open-variant"], ["advanced", "Advanced", "mdi:cog-outline"]];
// Ways to connect devices. Every one is a Home Assistant integration: Glass Home shows and controls what
// Home Assistant can reach, and sends people to Home Assistant's own setup flow to add more.
const GHS_CONNECT = [
  { domain: "matter", name: "Matter", icon: "mdi:matter", note: "Matter lights, plugs and sensors over Wi-Fi or Thread. Needs the Matter Server (built into Home Assistant OS as an app) and the Home Assistant phone app to pair each device. Thread devices also need a Thread border router." },
  { domain: "hue", name: "Philips Hue", icon: "mdi:lightbulb-group-outline", note: "Hue lights and sensors through the Hue Bridge. Press the bridge's button when asked." },
  { domain: "tplink", name: "TP-Link Kasa and Tapo", icon: "mdi:power-socket-uk", note: "Plugs, bulbs and switches on your Wi-Fi, controlled locally. Some newer Tapo firmware needs \"Third-party compatibility\" switched on in the Tapo app." },
  { domain: "shelly", name: "Shelly", icon: "mdi:toggle-switch-outline", note: "Shelly relays, plugs and sensors on your Wi-Fi, controlled locally. Usually found automatically." },
  { domain: "tuya", name: "Tuya and Smart Life", icon: "mdi:cloud-outline", note: "Devices from the Tuya / Smart Life app, through Tuya's cloud. You sign in by scanning a code with the Smart Life app." },
  { domain: "esphome", name: "ESPHome", icon: "mdi:chip", note: "Devices running ESPHome firmware, controlled locally." },
  { domain: "homekit_controller", name: "HomeKit accessories", icon: "mdi:apple", note: "Accessories with a HomeKit code, paired directly and controlled locally (they must not be paired to an Apple home at the same time)." },
  { domain: "zha", name: "Zigbee (ZHA)", icon: "mdi:zigbee", note: "Zigbee devices. Needs a Zigbee coordinator (a USB stick or network adapter) connected to Home Assistant." },
  { domain: "zwave_js", name: "Z-Wave", icon: "mdi:z-wave", note: "Z-Wave devices. Needs a Z-Wave controller stick and the Z-Wave JS server." },
  { domain: "mqtt", name: "MQTT", icon: "mdi:server-network", note: "Devices that report over MQTT (for example Zigbee2MQTT or Tasmota). Needs an MQTT broker such as Mosquitto." },
  { domain: "cast", name: "Google Cast", icon: "mdi:cast", note: "Chromecasts, Google TVs and Nest speakers on your network." },
  { domain: "androidtv_remote", name: "Android TV Remote", icon: "mdi:remote-tv", note: "Power, volume and apps on Android and Google TVs. You confirm a code shown on the TV." },
  { domain: "sonos", name: "Sonos", icon: "mdi:speaker", note: "Sonos speakers on your network." },
  { domain: "smartthings", name: "SmartThings", icon: "mdi:washing-machine", note: "Samsung appliances and SmartThings devices, through your Samsung account." },
  { domain: "hive", name: "Hive", icon: "mdi:thermostat", note: "Hive heating, hot water and plugs, through your Hive account." },
  { domain: "ring", name: "Ring", icon: "mdi:doorbell-video", note: "Ring doorbells and cameras, through your Ring account." },
  { domain: "generic", name: "Camera (RTSP or still image)", icon: "mdi:cctv", note: "Any camera with a stream or picture address you can enter." },
];
const GHS_KIND_LABEL = { lights: "Lights", plugs: "Plugs and switches", climate: "Climate", media: "Media", security: "Security", covers: "Blinds and covers",
  sensors: "Sensors", appliances: "Appliances", weather: "Weather", people: "People", scenes: "Scenes" };

const GHS_CSS = `
  :host { display: block; color: #fff; --acc: 139,92,246; --line: var(--lg-border, rgba(255,255,255,0.14));
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Roboto, "Segoe UI", sans-serif; }
  * { box-sizing: border-box; }
  .shell { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center;
    padding: max(18px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) calc(28px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    background: #120d22 url("${GH_ASSETS}bg.svg") center / cover no-repeat fixed; }
  ${GH_DEMO ? `/* phones: the demo label floats near the bottom, so the last buttons can scroll clear of it */
  @media (max-width: 599px) { .shell { padding-bottom: calc(132px + env(safe-area-inset-bottom)); } }` : ""}
  .frame { width: 100%; max-width: 980px; display: flex; flex-direction: column; gap: 16px; }
  .glass { background: ${GLASS_BG}; border: 1px solid var(--line); box-shadow: ${GLASS_EDGE}; border-radius: 28px; }
  .panel { padding: clamp(18px, 3.4vw, 32px); }
  .float { background: ${LG_FLOAT_BG}; border: 1px solid ${LG_FLOAT_LINE}; box-shadow: ${LG_FLOAT_SHADOW}; -webkit-backdrop-filter: ${LG_FLOAT_BLUR}; backdrop-filter: ${LG_FLOAT_BLUR}; }
  h1 { font-size: clamp(26px, 4.4vw, 38px); line-height: 1.12; margin: 0; font-weight: 700; letter-spacing: -0.4px; }
  h2 { font-size: 20px; margin: 0; font-weight: 700; }
  h3 { font-size: 15px; margin: 0; font-weight: 650; }
  p { margin: 0; }
  .lead { font-size: 15.5px; line-height: 1.5; color: #cfc9e6; margin-top: 8px; max-width: 62ch; }
  .muted { color: #a29db8; font-size: 13px; line-height: 1.45; }
  .small { font-size: 12.5px; }
  .stack { display: flex; flex-direction: column; gap: 14px; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .between { justify-content: space-between; }
  .grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 14px; }
  .grid3 { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: 10px; }
  label.f { display: flex; flex-direction: column; gap: 6px; font-size: 13px; font-weight: 600; color: #ddd8ef; }
  input[type=text], input[type=search], input[type=date], input[type=number], select, textarea {
    font: inherit; font-size: 15px; color: #fff; background: rgba(10,7,24,0.55); border: 1px solid var(--line); border-radius: 14px; padding: 11px 13px; min-height: 46px; width: 100%; }
  select option { background: #1d1733; color: #fff; }
  textarea { min-height: 160px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.45; }
  input::placeholder { color: #8e89a6; }
  :is(input, select, textarea, button, a, [tabindex]):focus-visible { outline: 3px solid rgba(196,181,253,0.95); outline-offset: 2px; }
  button { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 18px; border-radius: 16px; border: 1px solid var(--line);
    background: rgba(255,255,255,0.07); color: #fff; font-size: 14.5px; font-weight: 600; text-decoration: none; transition: transform 0.12s ease, background 0.2s ease; }
  .btn:hover { background: rgba(255,255,255,0.12); }
  .btn:active { transform: scale(0.97); }
  .btn.primary { background: linear-gradient(160deg, rgba(167,139,250,0.95), rgba(124,58,237,0.95)); border-color: rgba(196,181,253,0.7); box-shadow: 0 8px 22px rgba(124,58,237,0.35); }
  .btn.primary:hover { background: linear-gradient(160deg, rgba(180,155,252,1), rgba(132,70,240,1)); }
  .btn.big { min-height: 54px; padding: 0 26px; font-size: 16px; border-radius: 18px; }
  .btn.ghost { background: none; border-color: transparent; color: #cfc9e6; }
  .btn.danger { background: rgba(239,68,68,0.18); border-color: rgba(248,113,113,0.5); }
  .btn.sm { min-height: 36px; padding: 0 12px; font-size: 13px; border-radius: 12px; }
  .btn[disabled] { opacity: 0.45; cursor: not-allowed; transform: none; }
  .ib { width: 40px; height: 40px; min-height: 40px; padding: 0; border-radius: 12px; }
  ha-icon { --mdc-icon-size: 20px; flex: none; }
  .seg { display: inline-flex; padding: 4px; gap: 4px; border-radius: 16px; background: rgba(10,7,24,0.5); border: 1px solid var(--line); flex-wrap: wrap; }
  .seg button { min-height: 40px; padding: 0 14px; border: 0; border-radius: 12px; background: none; color: #cfc9e6; font-size: 14px; font-weight: 600; }
  .seg button[aria-pressed=true] { background: rgba(var(--acc),0.45); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,0.18); }
  .chip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 18px; border: 1px solid var(--line); background: rgba(255,255,255,0.06);
    color: #e9e5f5; font-size: 13px; font-weight: 600; }
  button.chip:hover { background: rgba(255,255,255,0.12); }
  .tag { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700; letter-spacing: 0.2px; padding: 3px 8px; border-radius: 9px;
    background: rgba(255,255,255,0.08); color: #cfc9e6; white-space: nowrap; }
  .tag.ok { background: rgba(52,211,153,0.16); color: #6ee7b7; }
  .tag.warn { background: rgba(255,179,64,0.16); color: #ffcf85; }
  .tag.bad { background: rgba(248,113,113,0.16); color: #fca5a5; }
  .tag.acc { background: rgba(var(--acc),0.22); color: #ddd6fe; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #6e6a82; flex: none; }
  .dot.on { background: #34d399; box-shadow: 0 0 8px rgba(52,211,153,0.6); }
  .dot.off { background: #f87171; }
  .item { display: flex; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 18px; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.07); min-width: 0; }
  .item .ic { width: 40px; height: 40px; border-radius: 13px; display: flex; align-items: center; justify-content: center; background: rgba(var(--acc),0.18); color: #ddd6fe; flex: none; }
  .item .tx { flex: 1; min-width: 0; }
  .item .n { font-size: 14.5px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .item .s { font-size: 12.5px; color: #a29db8; margin-top: 2px; line-height: 1.35; }
  .note { padding: 12px 14px; border-radius: 16px; background: rgba(var(--acc),0.12); border: 1px solid rgba(var(--acc),0.3); font-size: 13.5px; line-height: 1.45; color: #e4defa; }
  .note.warn { background: rgba(255,179,64,0.1); border-color: rgba(255,179,64,0.35); color: #ffe2b0; }
  .note.bad { background: rgba(248,113,113,0.1); border-color: rgba(248,113,113,0.4); color: #fecaca; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; background: rgba(255,255,255,0.08); padding: 1px 6px; border-radius: 6px; color: #ddd6fe; }
  /* progress */
  .steps { display: flex; gap: 6px; padding: 10px; border-radius: 22px; overflow-x: auto; scrollbar-width: none; }
  .steps::-webkit-scrollbar { display: none; }
  .st { flex: 1 0 auto; display: flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 12px; border-radius: 14px; border: 0; background: none; color: #8e89a6;
    font-size: 13px; font-weight: 650; white-space: nowrap; }
  .st .num { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11.5px; background: rgba(255,255,255,0.08); }
  .st.done { color: #cfc9e6; } .st.done .num { background: rgba(52,211,153,0.25); color: #6ee7b7; }
  .st[aria-current=step] { color: #fff; background: rgba(var(--acc),0.32); } .st[aria-current=step] .num { background: rgba(255,255,255,0.22); }
  .st[disabled] { cursor: default; }
  .foot { display: flex; gap: 10px; justify-content: space-between; align-items: center; flex-wrap: wrap; padding: 12px; border-radius: 22px; position: sticky; bottom: 12px; z-index: 2; }
  .foot .row { margin-left: auto; }
  /* welcome */
  .hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: clamp(18px, 4vw, 40px); align-items: center; }
  .logo { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 18px; letter-spacing: 0.2px; margin-bottom: 18px; }
  .logo svg { width: 44px; height: 44px; flex: none; }
  .tagline { font-size: clamp(17px, 2.4vw, 21px); color: #ddd6fe; margin-top: 10px; font-weight: 600; }
  .cta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 24px; }
  .restore { margin-top: 14px; }
  .pname { width: 100%; min-height: 40px; padding: 6px 10px; font-size: 14px; font-weight: 600; }
  .msvc { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 10px; }
  .msvc .opt { flex-direction: row; align-items: center; gap: 10px; min-height: 58px; }
  .msvc .opt ha-icon { --mdc-icon-size: 26px; flex: none; }
  .msvc .opt small { display: block; font-weight: 500; color: #a29db8; font-size: 12px; margin-top: 2px; }
  .restore summary { cursor: pointer; color: #a29db8; font-size: 14px; }
  .restore[open] { display: grid; gap: 8px; }
  .mock { position: relative; aspect-ratio: 4 / 3.1; border-radius: 26px; overflow: hidden; padding: 14px; display: grid; gap: 10px; grid-template-rows: auto 1fr auto;
    background: linear-gradient(170deg, #3b2a7a 0%, #24184f 48%, #160f30 100%); border: 1px solid rgba(255,255,255,0.18); box-shadow: 0 24px 60px rgba(4,2,16,0.55), inset 0 1px 0 rgba(255,255,255,0.25); }
  .mock .sky { border-radius: 18px; padding: 14px 16px; background: linear-gradient(160deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04)); border: 1px solid rgba(255,255,255,0.14); position: relative; overflow: hidden; }
  .mock .sky::after { content: ""; position: absolute; width: 120px; height: 120px; right: -20px; top: -40px; border-radius: 50%; background: radial-gradient(circle, rgba(255,214,140,0.85), rgba(255,170,80,0) 70%); }
  .mock .t { font-family: "Space Grotesk", -apple-system, sans-serif; font-weight: 300; font-size: clamp(30px, 5vw, 46px); line-height: 1; letter-spacing: -1px; }
  .mock .g { font-size: 12px; color: rgba(255,255,255,0.8); margin-bottom: 4px; }
  .mock .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .mock .tl { border-radius: 14px; padding: 9px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); font-size: 10.5px; color: #e4defa; display: flex; flex-direction: column; gap: 6px; }
  .mock .tl.on { background: linear-gradient(155deg, rgba(139,92,246,0.6), rgba(109,40,217,0.3)); border-color: rgba(167,139,250,0.55); }
  .mock .tl i { width: 22px; height: 22px; border-radius: 50%; background: rgba(255,255,255,0.2); display: block; }
  .mock .nv { display: flex; justify-content: space-around; padding: 8px; border-radius: 16px; background: rgba(26,20,50,0.7); border: 1px solid rgba(255,255,255,0.14); }
  .mock .nv i { width: 16px; height: 16px; border-radius: 5px; background: rgba(255,255,255,0.3); display: block; }
  .mock .nv i.a { background: #a78bfa; }
  .feat3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 22px; }
  .feat3 > div { padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); font-size: 12.5px; color: #cfc9e6; line-height: 1.4; }
  .feat3 b { display: flex; align-items: center; gap: 6px; color: #fff; font-size: 13.5px; margin-bottom: 4px; }
  .greet { font-size: 22px; font-weight: 650; }
  .bigt { font-family: "Space Grotesk", -apple-system, sans-serif; font-weight: 300; font-size: 54px; line-height: 1; letter-spacing: -1px; }
  .wx { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
  .wx .tmp { font-size: 46px; font-weight: 300; font-family: "Space Grotesk", -apple-system, sans-serif; }
  .wxd { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; width: 100%; }
  .wxd > div { padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.05); font-size: 12.5px; color: #a29db8; }
  .wxd b { display: block; color: #fff; font-size: 15px; margin-top: 2px; }
  .res { display: flex; flex-direction: column; gap: 6px; }
  .res button { text-align: left; }
  /* rooms and devices */
  .room { padding: 14px; border-radius: 20px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
  .room.hidden { opacity: 0.55; }
  .rhead { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .rhead input[type=text] { flex: 1 1 180px; width: auto; }
  .iconbtn { width: 46px; height: 46px; border-radius: 14px; border: 1px solid var(--line); background: rgba(var(--acc),0.2); color: #ddd6fe; display: flex; align-items: center; justify-content: center; }
  .icons { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 6px; padding: 10px; border-radius: 16px; background: rgba(10,7,24,0.6); margin-top: 10px; }
  .icons button { height: 44px; border-radius: 12px; border: 1px solid transparent; background: rgba(255,255,255,0.06); color: #fff; display: flex; align-items: center; justify-content: center; }
  .icons button[aria-pressed=true] { border-color: rgba(196,181,253,0.8); background: rgba(var(--acc),0.35); }
  .dev { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 12px; border-radius: 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); }
  .dev.off { opacity: 0.5; }
  .dev .tx { min-width: 0; }
  .dev input[type=text] { min-height: 40px; padding: 8px 11px; font-size: 14px; }
  .dev .acts { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  .dev select { min-height: 40px; padding: 6px 10px; font-size: 13px; width: auto; max-width: 170px; }
  .star[aria-pressed=true] { color: #fde68a; background: rgba(250,204,21,0.18); border-color: rgba(250,204,21,0.45); }
  .tgl { position: relative; width: 52px; height: 32px; border-radius: 16px; border: 1px solid var(--line); background: rgba(255,255,255,0.1); flex: none; padding: 0; }
  .tgl::after { content: ""; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: transform 0.18s ease; }
  .tgl[aria-checked=true] { background: rgba(var(--acc),0.85); border-color: rgba(196,181,253,0.7); }
  .tgl[aria-checked=true]::after { transform: translateX(20px); }
  .tgl[disabled] { opacity: 0.4; }
  .feat { padding: 16px; border-radius: 20px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); display: flex; flex-direction: column; gap: 12px; }
  .feat .top { display: flex; gap: 12px; align-items: flex-start; }
  .feat .top .tx { flex: 1; min-width: 0; }
  .swatch { width: 100%; height: 74px; border-radius: 16px; border: 2px solid transparent; }
  .opt { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 18px; border: 1px solid var(--line); background: rgba(255,255,255,0.04); color: #fff; text-align: left; font-weight: 600; font-size: 13.5px; }
  .opt[aria-pressed=true] { border-color: rgba(196,181,253,0.85); background: rgba(var(--acc),0.2); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid rgba(255,255,255,0.07); vertical-align: middle; }
  th { color: #a29db8; font-weight: 600; font-size: 12px; }
  td .nm { font-weight: 600; }
  .scroll { overflow-x: auto; }
  .tabs { display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: 22px; position: sticky; top: 12px; }
  .tabs button { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px; border: 0; border-radius: 14px; background: none; color: #cfc9e6; font-size: 14px; font-weight: 600; text-align: left; }
  .tabs button[aria-current=page] { background: rgba(var(--acc),0.32); color: #fff; }
  .settings { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 16px; align-items: start; }
  .tabsel { display: none; }
  .wsteps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: 10px; }
  .wsteps li { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); min-width: 0; }
  .wsteps .n { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700; background: rgba(var(--acc),0.4); }
  .wsteps ha-icon { flex: none; --mdc-icon-size: 20px; color: #c4b5fd; }
  .wsteps b { display: block; font-size: 14px; }
  .wsteps small { display: block; font-size: 12.5px; color: #b8b2d0; line-height: 1.3; margin-top: 2px; }
  @media (max-width: 600px) {
    .settings > nav.tabs { display: none; }
    .tabsel { display: block; width: 100%; min-height: 48px; font-size: 15px; font-weight: 600; }
  }
  .spin { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; animation: ghsr 0.8s linear infinite; }
  @keyframes ghsr { to { transform: rotate(360deg); } }
  .fade { animation: ghsf 0.35s ease both; }
  @keyframes ghsf { from { opacity: 0; transform: translateY(8px); } }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .ready { text-align: center; align-items: center; }
  .ready .badge { width: 84px; height: 84px; border-radius: 28px; display: flex; align-items: center; justify-content: center; background: linear-gradient(160deg, rgba(52,211,153,0.45), rgba(16,185,129,0.2));
    border: 1px solid rgba(110,231,183,0.6); --mdc-icon-size: 44px; color: #d1fae5; margin: 0 auto 6px; }
  .sum { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 10px; text-align: left; width: 100%; }
  .sum > div { padding: 12px 14px; border-radius: 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); font-size: 12.5px; color: #a29db8; }
  .sum b { display: block; color: #fff; font-size: 15px; margin-top: 3px; overflow-wrap: anywhere; }
  @media (max-width: 760px) {
    .hero { grid-template-columns: 1fr; }
    .hero .mock { order: -1; max-width: 460px; width: 100%; margin: 0 auto; }
    .feat3 { grid-template-columns: 1fr; }
    .settings { grid-template-columns: minmax(0, 1fr); }
    .settings > * { min-width: 0; }
    select { max-width: 100%; }
    .tag { white-space: normal; max-width: 100%; }
    .tabs { position: static; flex-direction: row; overflow-x: auto; scrollbar-width: none; min-width: 0; max-width: 100%; }
    .tabs::-webkit-scrollbar { display: none; }
    .tabs button { flex: none; }
    .dev { grid-template-columns: auto minmax(0, 1fr); }
    .dev .acts { grid-column: 1 / -1; justify-content: flex-start; }
    .st .lb { display: none; }
    .st[aria-current=step] .lb { display: inline; }
  }
  @media (prefers-reduced-motion: reduce) { .fade, .spin { animation: none; } .btn, .tgl::after { transition: none; } }`;

const GHS_LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><defs><linearGradient id="ghl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c4b5fd"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect x="2" y="2" width="44" height="44" rx="14" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.3)"/>
  <path d="M12 23.5 24 13l12 10.5V35a2 2 0 0 1-2 2h-6v-8h-8v8h-6a2 2 0 0 1-2-2z" fill="url(#ghl)"/><path d="M14 15.5a14 14 0 0 1 20 0" stroke="rgba(255,255,255,0.55)" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;

class GlassHomeSetupBase extends HTMLElement {
  constructor() {
    super();
    this._mode = "wizard";
    this._ui = { search: "", kind: "", picker: null, results: null, searching: false, wxPreview: null, wxErr: "", saving: false, saveErr: "", saved: false, importText: "", confirmClear: false };
    this._reg = null;
    this._ints = null;
  }
  setConfig(c) { this._config = c || {}; }
  set hass(h) {
    this._hass = h;
    if (!this._started) { this._started = true; this._start(); }
  }
  getCardSize() { return 20; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }

  // ---------------------------------------------------------------- data
  get _key() { return `glasshome_setup_${GH_LOADED.path}`; }
  _ws(m) { return this._hass.connection.sendMessagePromise(m); }
  async _start() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `<style>${GHS_CSS}${GHS_CSS_MORE}</style><div class="shell"><div class="frame"><div class="glass panel row"><div class="spin"></div><span>Loading your home…</span></div></div></div>`;
    this._wire();
    const tz = GH_TZ;
    let draft = null;
    if (this._mode === "wizard") {
      try { const r = await this._ws({ type: "frontend/get_user_data", key: this._key }); draft = r && r.value && r.value.v === GHS_VERSION ? r.value : null; } catch (e) { /* user data not available */ }
      if (!draft) try { const s = sessionStorage.getItem(this._key); if (s) draft = JSON.parse(s); } catch (e) { /* private window */ }
    }
    const real = GH_LOADED.cfg && !GH_LOADED.cfg.demo ? GH_LOADED.cfg : {};
    if (!draft) draft = Object.keys(real).length ? ghsDraftFromConfig(real, tz) : ghsNewDraft(tz);
    if (this._mode === "wizard" && GHS_STEPS.indexOf(draft.step) < 0) draft.step = "welcome";
    this._d = draft;
    this._base = JSON.stringify(draft);
    this._anim = true;
    await this._loadRegistries();
    this._render();
    if (draft.step === "connect" || this._mode === "settings") this._loadIntegrations();
  }
  _persist() {
    if (this._mode !== "wizard") return;
    clearTimeout(this._pT);
    this._pT = setTimeout(() => {
      const v = this._d;
      this._ws({ type: "frontend/set_user_data", key: this._key, value: v }).catch(() => { try { sessionStorage.setItem(this._key, JSON.stringify(v)); } catch (e) { /* nowhere to keep it */ } });
    }, 400);
  }
  get _dirty() { return JSON.stringify(this._d) !== this._base; }
  async _loadRegistries() {
    const h = this._hass;
    let reg = { entities: h.entities, devices: h.devices, areas: h.areas };
    if (!reg.entities || !reg.devices || !reg.areas) {
      try {
        const [e, d, a] = await Promise.all([this._ws({ type: "config/entity_registry/list_for_display" }), this._ws({ type: "config/device_registry/list" }), this._ws({ type: "config/area_registry/list" })]);
        reg = {
          entities: Object.fromEntries(((e && e.entities) || []).map((x) => [x.ei, { entity_id: x.ei, device_id: x.di, area_id: x.ai, platform: x.pl, hidden: !!x.hb, entity_category: x.ec != null ? x.ec : null }])),
          devices: Object.fromEntries((d || []).map((x) => [x.id, x])), areas: Object.fromEntries((a || []).map((x) => [x.area_id, x])),
        };
      } catch (err) { reg = { entities: {}, devices: {}, areas: {} }; }
    }
    this._reg = reg;
    this._disc = ghsDiscover({ states: h.states, ...reg });
  }
  async _loadIntegrations() {
    this._ints = { loading: true, entries: [], flows: [], err: "" };
    this._render();
    try {
      const [entries, flows] = await Promise.all([this._ws({ type: "config_entries/get" }), this._ws({ type: "config_entries/flow/progress" }).catch(() => [])]);
      this._ints = { loading: false, entries: entries || [], flows: (flows || []).filter((f) => f.context && ["zeroconf", "ssdp", "dhcp", "bluetooth", "homekit", "mqtt", "usb", "discovery", "hassio", "integration_discovery"].includes(f.context.source)), err: "" };
    } catch (e) {
      // only administrators can list integrations; devices still come from the registries
      this._ints = { loading: false, entries: [], flows: [], err: (e && e.code) === "unauthorized" ? "admin" : String((e && e.message) || e) };
    }
    this._render();
  }
  _stateName(id) { const s = this._hass.states[id]; return (this._d.devices[id] && this._d.devices[id].name) || (s && s.attributes.friendly_name) || id; }
  _ofDomain(...ds) { return Object.keys(this._hass.states).filter((id) => ds.includes(id.split(".")[0])).sort((a, b) => this._stateName(a).localeCompare(this._stateName(b))); }
  _sensors(cls) { return Object.keys(this._hass.states).filter((id) => id.startsWith("sensor.") && this._hass.states[id].attributes.device_class === cls).sort(); }
  _assigned() { return new Set(this._d.rooms.flatMap((r) => r.entities)); }

  // ---------------------------------------------------------------- events (one set of listeners; the content is re-drawn)
  _wire() {
    const r = this.shadowRoot;
    r.addEventListener("click", (e) => this._onClick(e));
    r.addEventListener("input", (e) => this._onInput(e));
    r.addEventListener("change", (e) => this._onChange(e));
    r.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.dataset && e.target.dataset.enter) { e.preventDefault(); this._act(e.target.dataset.enter, e.target); }
      if (e.key === "Escape" && this._ui.picker) { this._ui.picker = null; this._render(); }
    });
  }
  _set(path, value) {
    const keys = path.split(".");
    let o = this._d;
    for (const k of keys.slice(0, -1)) { if (o[k] == null || typeof o[k] !== "object") o[k] = {}; o = o[k]; }
    o[keys[keys.length - 1]] = value;
    this._persist();
  }
  _get(path) { return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), this._d); }
  _onInput(e) {
    const t = e.target, d = t.dataset || {};
    if (d.bind) { this._set(d.bind, t.type === "number" ? Number(t.value) : t.value); this._live(); }
    if (d.room != null && d.f === "name") { this._d.rooms[+d.room].name = t.value; this._persist(); }
    if (d.dev && d.f === "name") { this._dev(d.dev).name = t.value; this._persist(); }
    if (d.ui) this._ui[d.ui] = t.value;
    if (d.ui === "search") this._filterDevices();
    if (d.binlabel) { const L = this._d.choices.bins.labels; L[d.binlabel] = { ...(L[d.binlabel] || {}), [d.f]: t.value }; this._persist(); }
    this._footer();
  }
  _onChange(e) {
    const t = e.target, d = t.dataset || {};
    if (t.tagName === "SELECT" || t.type === "date") {
      if (d.bind) { this._set(d.bind, t.value); this._render(); }
      else if (d.dev && d.f === "room") this._act("moveDevice", t);
      else if (d.act) this._act(d.act, t);
    }
    if (t.type === "file") this._act(d.act || "importFile", t);
  }
  _onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled || !this.shadowRoot.contains(b)) return;
    if (b.tagName === "SELECT" || b.tagName === "INPUT" || b.tagName === "TEXTAREA") return;
    e.preventDefault();
    this._act(b.dataset.act, b);
  }
  _dev(id) { return (this._d.devices[id] = this._d.devices[id] || {}); }
  // small live updates while typing (no re-draw, so the field keeps focus)
  _live() {
    const r = this.shadowRoot, g = r.querySelector("[data-live=greet]");
    if (g) g.textContent = this._greetPreview();
  }
  _footer() {
    const b = this.shadowRoot.querySelector("[data-act=saveSettings]");
    if (b) b.disabled = !this._dirty || this._ui.saving;
  }

  async _act(a, el) {
    const d = this._d, ds = (el && el.dataset) || {};
    switch (a) {
      case "go": return this._goStep(ds.step);
      case "next": return this._goStep(GHS_STEPS[Math.min(GHS_STEPS.length - 1, GHS_STEPS.indexOf(d.step) + 1)]);
      case "back": return this._goStep(GHS_STEPS[Math.max(0, GHS_STEPS.indexOf(d.step) - 1)]);
      case "tabSel": el.dataset.tab = el.value; // falls through: the phone menu works like the tab buttons
      case "tab":
        this._anim = true; this._tab = ds.tab; this._ui.saveErr = "";
        try { sessionStorage.setItem("glasshome.settings.tab", ds.tab); } catch (e) { /* only remembered for this visit */ }
        this._render();
        if (["connect", "media", "guides"].includes(ds.tab) && !this._ints) this._loadIntegrations();
        return;
      case "explore":
        try { sessionStorage.setItem(GH_EXPLORE_KEY, "1"); } catch (e) { ghToast("This browser blocks session storage, so the demo can't open", "warn"); return; }
        location.assign(`${ghBase()}/home`);
        return;
      case "seg": this._set(ds.path, ds.value); this._render(); return;
      case "toggle": this._set(ds.path, !this._get(ds.path)); this._render(); return;
      case "wxSource": d.weather.source = ds.value; this._persist(); this._render(); if (ds.value === "open_meteo" && d.weather.place) this._wxPreview(); return;
      case "wxSearch": return this._wxSearch();
      case "wxPick": {
        const r = this._ui.results[+ds.i];
        d.weather.place = { name: r.name, label: ghsPlaceLabel(r), latitude: r.latitude, longitude: r.longitude, timezone: r.timezone || "" };
        if (!d.household.timezone && r.timezone) d.household.timezone = r.timezone;
        this._ui.results = null;
        this._persist();
        this._render();
        return this._wxPreview();
      }
      case "wxLocate": return this._wxLocate();
      case "wxEntity": d.weather.entity = el.value; this._persist(); this._render(); return;
      case "refresh": await this._loadRegistries(); this._loadIntegrations(); ghToast(`Found ${this._disc.length} devices`); return;
      case "kind": this._ui.kind = this._ui.kind === ds.kind ? "" : ds.kind; this._render(); return;
      case "nav": this._leaveTo(ds.path); return;
      case "retry": {
        try { await this._hass.callApi("POST", `config/config_entries/entry/${encodeURIComponent(ds.entry)}/reload`); ghToast("Asked Home Assistant to try again"); }
        catch (e) { ghToast(`Home Assistant couldn't reload it: ${(e && (e.message || (e.body && e.body.message))) || "error"}`, "warn"); }
        setTimeout(() => this._loadIntegrations(), 2500);
        return;
      }
      // rooms
      case "importAreas": {
        const rooms = ghsRoomsFromAreas({ areas: this._reg.areas }, this._disc);
        let added = 0;
        for (const r of rooms) {
          const have = d.rooms.find((x) => x.area_id === r.area_id || x.name.toLowerCase() === r.name.toLowerCase());
          if (have) { have.area_id = have.area_id || r.area_id; have.entities = ghsUniq([...have.entities, ...r.entities.filter((id) => !this._assigned().has(id))]); }
          else { d.rooms.push({ ...r, key: ghsUniqueKey(d.rooms, r.name) }); added++; }
        }
        this._persist();
        this._render();
        ghToast(added ? `Added ${added} room${added === 1 ? "" : "s"} from Home Assistant` : "Your rooms already match Home Assistant's areas");
        return;
      }
      case "addRoom": {
        const name = String(ds.name || this._ui.newRoom || "").trim();
        if (!name) { ghToast("Type a name for the room first", "warn"); return; }
        if (d.rooms.some((r) => r.name.toLowerCase() === name.toLowerCase())) { ghToast(`There is already a room called ${name}`, "warn"); return; }
        const sug = GHS_ROOM_SUGGESTIONS.find(([n]) => n.toLowerCase() === name.toLowerCase());
        d.rooms.push({ key: ghsUniqueKey(d.rooms, name), name, icon: ds.icon || (sug && sug[1]) || "mdi:home-outline", visible: true, entities: [] });
        this._ui.newRoom = "";
        this._persist();
        this._render();
        this._focus(`[data-room="${d.rooms.length - 1}"][data-f=name]`, true);
        return;
      }
      case "roomUp": case "roomDown": {
        const i = +ds.room, j = a === "roomUp" ? i - 1 : i + 1;
        if (j < 0 || j >= d.rooms.length) return;
        [d.rooms[i], d.rooms[j]] = [d.rooms[j], d.rooms[i]];
        this._persist();
        this._render();
        this._focus(`[data-act=${a}][data-room="${j}"]`);
        return;
      }
      case "roomVisible": { const r = d.rooms[+ds.room]; r.visible = r.visible === false; this._persist(); this._render(); return; }
      case "roomRemove": {
        const r = d.rooms[+ds.room];
        if (r.entities.length && !confirm(`Remove ${r.name || "this room"}? Its ${r.entities.length} device${r.entities.length === 1 ? "" : "s"} will move to "Not in a room".`)) return;
        d.rooms.splice(+ds.room, 1);
        this._persist();
        this._render();
        return;
      }
      case "picker": this._ui.picker = this._ui.picker === ds.target ? null : ds.target; this._render(); return;
      case "pickIcon": {
        const [kind, ref] = this._ui.picker.split(":");
        if (kind === "room") d.rooms[+ref].icon = ds.icon; else this._dev(ref).icon = ds.icon;
        this._ui.picker = null;
        this._persist();
        this._render();
        return;
      }
      case "iconText": {
        const v = String(el.value || "").trim();
        if (!/^mdi:[a-z0-9-]+$/.test(v)) { ghToast("Icons look like mdi:lightbulb-on", "warn"); return; }
        el.dataset.icon = v;
        return this._act("pickIcon", el);
      }
      // devices
      case "assignArea": {
        let n = 0;
        const taken = this._assigned();
        for (const dv of this._disc) {
          if (taken.has(dv.id) || !dv.area || ["weather", "people", "scenes"].includes(dv.kind.group)) continue;
          const room = d.rooms.find((r) => r.area_id === dv.area);
          if (room) { room.entities.push(dv.id); n++; }
        }
        this._persist();
        this._render();
        ghToast(n ? `Placed ${n} device${n === 1 ? "" : "s"} in their rooms` : "Nothing new to place: add rooms from Home Assistant first");
        return;
      }
      case "moveDevice": {
        const id = ds.dev, to = el.value;
        for (const r of d.rooms) r.entities = r.entities.filter((x) => x !== id);
        if (to !== "") d.rooms[+to].entities.push(id);
        this._persist();
        this._render();
        return;
      }
      case "addToRoom": {
        const room = d.rooms[+ds.room], sel = this.shadowRoot.querySelector(`select[data-addfor="${ds.room}"]`);
        const id = sel && sel.value;
        if (!id) return;
        for (const r of d.rooms) r.entities = r.entities.filter((x) => x !== id);
        room.entities.push(id);
        this._persist();
        this._render();
        return;
      }
      case "fav": { const o = this._dev(ds.dev); o.favourite = !o.favourite; this._persist(); this._render(); return; }
      case "hide": { const o = this._dev(ds.dev); o.hidden = !o.hidden; this._persist(); this._render(); return; }
      case "asLight": { const o = this._dev(ds.dev); o.as_light = !o.as_light; this._persist(); this._render(); return; }
      case "camera": {
        const c = d.choices.cameras, id = ds.dev;
        d.choices.cameras = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
        this._persist();
        this._render();
        return;
      }
      case "feature": {
        const k = ds.feature;
        d.features[k] = !d.features[k];
        // turning cameras on starts with every camera found, rather than none
        if (k === "cctv" && d.features.cctv && !(d.choices.cameras || []).length) d.choices.cameras = this._ofDomain("camera");
        this._persist();
        this._render();
        return;
      }
      case "page": { const p = d.appearance.pages; p[ds.page] = p[ds.page] === false; this._persist(); this._render(); return; }
      case "finish": return this._finish();
      case "openDashboard": location.assign(`${ghBase()}/home`); return;
      // settings
      case "saveSettings": return this._saveSettings();
      case "discard": this._d = JSON.parse(this._base); this._render(); ghToast("Changes discarded"); return;
      case "rerun": location.assign(`${ghBase()}/welcome`); return;
      case "export": return this._export(ds.format);
      case "copyYaml": return this._copy(this._yaml(), "Settings copied");
      case "importFile": return this._importFile(el);
      case "importApply": return this._importApply();
      case "sceneMatch": {
        const before = JSON.stringify(d.choices.scenes || {});
        d.choices.scenes = ghsSceneMatch(this._hass.states, d.choices.scenes || {});
        const n = Object.values(d.choices.scenes).filter(Boolean).length;
        this._persist(); this._render();
        ghToast(before === JSON.stringify(d.choices.scenes) ? "No more scenes match a button by name. Choose them from the lists." : `${n} scene button${n === 1 ? "" : "s"} set. Check them, then save.`);
        return;
      }
      case "sceneClear": d.choices.scenes = {}; this._persist(); this._render(); return;
      case "clearAsk": this._ui.confirmClear = true; this._render(); this._focus("[data-act=clearCancel]"); return;
      case "clearCancel": this._ui.confirmClear = false; this._render(); this._focus("[data-act=clearAsk]"); return;
      case "clearDo": return this._clear();
      case "resetDemo":
        try { sessionStorage.removeItem(GH_EXPLORE_KEY); } catch (e) { /* nothing kept */ }
        ghToast("Demo reset: its devices start fresh next time you explore it");
        return;
      case "copyDiag": return this._copy(this._diagText(), "Diagnostics copied");
      default: if (this._moreAct) return this._moreAct(a, el, ds);
    }
  }
  _focus(sel, end) { requestAnimationFrame(() => { const n = this.shadowRoot.querySelector(sel); if (!n) return; n.focus(); if (end && typeof n.setSelectionRange === "function") { const l = String(n.value || "").length; n.setSelectionRange(l, l); } }); }
  _goStep(step) {
    if (!GHS_STEPS.includes(step)) return;
    const d = this._d;
    if (!d.visited.includes(d.step)) d.visited.push(d.step);
    d.step = step;
    this._anim = true;
    this._ui.picker = null;
    this._ui.results = null;
    this._persist();
    this._render();
    const top = this.shadowRoot.querySelector(".frame");
    if (top) top.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    this._focus("h1");
    if (step === "connect" && !this._ints) this._loadIntegrations();
    // the first time on Rooms, bring in Home Assistant's areas so the page doesn't start empty
    if (step === "rooms" && this._mode === "wizard" && !d.rooms.length && !d.visited.includes("rooms") && this._reg && Object.keys(this._reg.areas || {}).length) this._act("importAreas");
    if (step === "weather" && d.weather.source === "open_meteo" && d.weather.place && !this._ui.wxPreview) this._wxPreview();
  }
  // leaving for a Home Assistant page (adding an integration): the draft is kept, so the wizard resumes here
  _leaveTo(path) {
    clearTimeout(this._pT);
    const v = this._d;
    const go = () => wnavGo(path);
    if (this._mode === "wizard") this._ws({ type: "frontend/set_user_data", key: this._key, value: v }).then(go, go);
    else if (this._dirty && !confirm("You have changes that are not saved yet. Leave anyway?")) return;
    else go();
  }

  // ---------------------------------------------------------------- weather
  async _wxSearch() {
    const q = String(this._ui.wxq || "").trim();
    if (q.length < 2) { ghToast("Type at least two letters of a town, city or postcode", "warn"); return; }
    this._ui.searching = true;
    this._ui.results = null;
    this._ui.wxErr = "";
    this._render();
    try {
      const r = await fetch(ghsGeocodeUrl(q, (GH_LOCALE || "en").slice(0, 2)), { referrerPolicy: "no-referrer", credentials: "omit" });
      if (!r.ok) throw new Error(`the place search answered ${r.status}`);
      const j = await r.json();
      this._ui.results = (j.results || []).slice(0, 8);
      if (!this._ui.results.length) this._ui.wxErr = `No places found for "${q}". Try a nearby town or check the spelling.`;
    } catch (e) {
      this._ui.wxErr = `The place search couldn't be reached (${(e && e.message) || "network error"}). Check the internet connection and try again.`;
    }
    this._ui.searching = false;
    this._render();
    this._focus(this._ui.results && this._ui.results.length ? "[data-act=wxPick]" : "[data-ui=wxq]");
  }
  _wxLocate() {
    if (!window.isSecureContext || !navigator.geolocation) {
      this._ui.wxErr = "This browser only shares your location on a secure (https) connection. Search for your town instead.";
      this._render();
      return;
    }
    this._ui.wxErr = "";
    this._ui.searching = true;
    this._render();
    navigator.geolocation.getCurrentPosition((p) => {
      this._d.weather.place = { name: "My location", label: "My location (from this device)", latitude: Math.round(p.coords.latitude * 100) / 100, longitude: Math.round(p.coords.longitude * 100) / 100 };
      this._ui.searching = false;
      this._persist();
      this._render();
      this._wxPreview();
    }, (err) => {
      this._ui.searching = false;
      this._ui.wxErr = err && err.code === 1 ? "Location permission was not given. Search for your town instead." : "Your location couldn't be found. Search for your town instead.";
      this._render();
    }, { maximumAge: 600000, timeout: 15000 });
  }
  async _wxPreview() {
    const p = this._d.weather.place;
    if (!p) return;
    const H = this._d.household, units = { temperature: H.temperature_unit === "F" ? "°F" : "°C", distance: H.distance_unit === "mi" ? "mi" : "km" };
    this._ui.wxPreview = { loading: true };
    this._render();
    try {
      const r = await fetch(ghsOpenMeteoUrl(p, units), { referrerPolicy: "no-referrer", credentials: "omit" });
      if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`);
      this._ui.wxPreview = ghsOpenMeteoParse(await r.json(), p, units);
    } catch (e) {
      this._ui.wxPreview = { error: `The forecast couldn't be loaded right now (${(e && e.message) || "network error"}). Your choice is still saved; the dashboard will keep trying.` };
    }
    this._render();
  }

  // ---------------------------------------------------------------- saving
  _ctx() { return { states: this._hass.states, entities: (this._reg && this._reg.entities) || {}, services: this._hass.services || {}, now: new Date().toISOString() }; }
  _buildCfg() { return ghsBuildConfig(this._d, GH_LOADED.cfg && !GH_LOADED.cfg.demo ? GH_LOADED.cfg : {}, this._ctx()); }
  async _writeConfig(cfg) {
    const url_path = GH_LOADED.path === "lovelace" ? null : GH_LOADED.path;
    let dash;
    try { dash = await this._ws({ type: "lovelace/config", url_path, force: true }); }
    catch (e) { throw new Error(`the dashboard couldn't be read (${(e && e.message) || e})`); }
    if (!dash || !Array.isArray(dash.views) || !dash.views.length) throw new Error("the dashboard came back without its views, so nothing was changed");
    try { await this._ws({ type: "lovelace/config/save", url_path, config: { ...dash, glasshome: cfg } }); }
    catch (e) {
      const m = String((e && (e.message || e.code)) || e);
      if (/storage|yaml|not supported|config_not_in_storage/i.test(m)) { const err = new Error("This dashboard is in YAML mode, so Glass Home can't save it from here."); err.yaml = true; throw err; }
      if (/unauthorized|admin/i.test(m)) { const err = new Error("Saving dashboards needs a Home Assistant administrator account."); err.admin = true; throw err; }
      throw new Error(m);
    }
    // read it back: the setup only counts as saved once Home Assistant has it
    const back = await this._ws({ type: "lovelace/config", url_path, force: true });
    if (!back || JSON.stringify(back.glasshome) !== JSON.stringify(JSON.parse(JSON.stringify(cfg)))) throw new Error("Home Assistant did not keep the new settings");
  }
  async _finish() {
    const probs = ghsProblems(this._d);
    if (probs.length) { this._ui.saveErr = probs.map((p) => p.text).join(" "); this._render(); return; }
    this._ui.saving = true;
    this._ui.saveErr = "";
    this._render();
    const cfg = this._buildCfg();
    try {
      await this._writeConfig(cfg);
      this._ui.saved = cfg;
      this._anim = true;
      this._ws({ type: "frontend/set_user_data", key: this._key, value: null }).catch(() => {});
      try { sessionStorage.removeItem(this._key); sessionStorage.removeItem(GH_EXPLORE_KEY); } catch (e) { /* nothing kept */ }
    } catch (e) {
      this._ui.saveErr = e.message;
      this._ui.saveYaml = true; // whatever went wrong, the settings can still be copied by hand
    }
    this._ui.saving = false;
    this._render();
    this._focus("h1");
  }
  async _saveSettings() {
    const probs = ghsProblems(this._d);
    if (probs.length) { this._ui.saveErr = probs.map((p) => p.text).join(" "); this._render(); return; }
    this._ui.saving = true;
    this._ui.saveErr = "";
    this._render();
    try {
      await this._writeConfig(this._buildCfg());
      ghToast("Settings saved. Reloading…");
      setTimeout(() => location.reload(), 700);
    } catch (e) {
      this._ui.saveErr = e.message;
      this._ui.saveYaml = true; // whatever went wrong, the settings can still be copied by hand
      this._ui.saving = false;
      this._render();
    }
  }
  _yaml() { return `glasshome:${ghsToYaml(this._buildCfg(), "  ")}\n`; }
  async _copy(text, done) {
    try { await navigator.clipboard.writeText(text); ghToast(done); }
    catch (e) { ghToast("This browser blocked copying: select the text and copy it yourself", "warn"); }
  }
  _export(format) {
    const cfg = this._buildCfg();
    const text = format === "yaml" ? this._yaml() : JSON.stringify({ glasshome_export: 1, exported: new Date().toISOString(), glasshome: cfg }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: format === "yaml" ? "text/yaml" : "application/json" }));
    a.download = `glasshome-settings.${format === "yaml" ? "yaml" : "json"}`;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    ghToast("Settings downloaded. Keep the file private: it lists your devices and your weather location.");
  }
  async _importFile(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    if (f.size > 1024 * 1024) { this._ui.importErr = "That file is too big to be a Glass Home settings file."; this._render(); return; }
    try {
      let j;
      try { j = JSON.parse(await f.text()); } catch (e) { throw new Error(/\.ya?ml$/i.test(f.name) ? "it's a YAML file, and only the JSON export can be loaded back" : "it isn't a JSON file"); }
      const cfg = j && typeof j === "object" ? (j.glasshome && typeof j.glasshome === "object" ? j.glasshome : j) : null;
      if (!cfg || Array.isArray(cfg) || !Object.keys(cfg).length) throw new Error("no settings in it");
      if (cfg.views) throw new Error("this is a whole dashboard, not Glass Home settings");
      const known = ["setup", "household", "weather", "rooms", "devices", "features", "lighting", "climate", "media", "energy", "bins", "floorplan", "appearance", "news", "security", "presence"];
      if (!Object.keys(cfg).some((k) => known.includes(k))) throw new Error("it doesn't contain Glass Home settings");
      this._ui.importCfg = cfg;
      this._ui.importErr = "";
    } catch (e) {
      this._ui.importCfg = null;
      this._ui.importErr = `That file couldn't be used: ${e.message}. Choose a file made by Export (JSON).`;
    }
    this._render();
  }
  _importApply() {
    const cfg = this._ui.importCfg;
    if (!cfg) return;
    this._d = ghsDraftFromConfig(cfg, GH_TZ);
    this._ui.importCfg = null;
    if (this._mode === "wizard") {
      this._d.visited = GHS_STEPS.slice(0, -1);
      this._d.step = "welcome";
      ghToast("Imported. Check the summary, then Finish to save.");
      return this._goStep("done");
    }
    this._render();
    ghToast("Imported. Check the sections, then Save changes.");
  }
  async _clear() {
    this._ui.saving = true;
    this._render();
    try {
      await this._writeConfig({ setup: { complete: false, version: GHS_VERSION } });
      try { sessionStorage.removeItem(this._key); } catch (e) { /* nothing kept */ }
      this._ws({ type: "frontend/set_user_data", key: `glasshome_setup_${GH_LOADED.path}`, value: null }).catch(() => {});
      location.assign(`${ghBase()}/welcome`);
    } catch (e) {
      this._ui.saving = false;
      this._ui.confirmClear = false;
      this._ui.saveErr = e.message;
      this._render();
    }
  }
  _diag() {
    const h = this._hass, cfg = GH_LOADED.cfg || {};
    const ids = ghEntitiesIn(cfg, []).filter((id) => !/^(weather\.glasshome_|sensor\.glasshome_[a-z]+_today$)/.test(id)); // made in the browser
    const missing = [...new Set(ids)].filter((id) => !h.states[id]);
    const bad = ((this._ints && this._ints.entries) || []).filter((e) => ["setup_error", "setup_retry", "migration_error", "failed_unload"].includes(e.state));
    return {
      glasshome: WHC_VERSION, home_assistant: (h.config && h.config.version) || "?", dashboard: GH_LOADED.path, settings_found: GH_CFG_FOUND,
      setup_complete: !!(cfg.setup && cfg.setup.complete), demo: GH_DEMO, administrator: !!(h.user && h.user.is_admin),
      features_on: Object.entries({ ...GHS_FEATURE_DEFAULTS, ...(cfg.features || {}) }).filter(([, v]) => v).map(([k]) => k),
      weather: cfg.weather ? (cfg.weather.provider === "open_meteo" ? "built-in (Open-Meteo)" : "Home Assistant entity") : "none",
      rooms: (cfg.rooms || []).length, devices_found: (this._disc || []).length, missing_entities: missing, integrations_with_problems: bad.map((e) => `${e.domain}: ${e.state}`),
      card_mod: !!customElements.get("card-mod"), screen: `${window.innerWidth}x${window.innerHeight}`, browser: navigator.userAgent.replace(/\([^)]*\)/g, "()"),
    };
  }
  _diagText() { return `Glass Home diagnostics (no location, names or addresses included)\n${ghsToYaml(this._diag())}\n`; }

  // ---------------------------------------------------------------- drawing
  _render() {
    if (!this.shadowRoot || !this._d) return;
    const act = this.shadowRoot.activeElement, key = act && (act.dataset.k || act.dataset.act + (act.dataset.room || "") + (act.dataset.dev || ""));
    this._autoPick();
    let body = this._mode === "wizard" ? this._wizardHtml() : this._settingsHtml();
    if (!this._anim) body = body.replace(/ fade"/g, "\"");
    this._anim = false;
    this.shadowRoot.innerHTML = `<style>${GHS_CSS}${GHS_CSS_MORE}</style><div class="shell"><div class="frame">${body}</div></div><div class="sr" role="status" aria-live="polite">${esc(this._ui.saveErr || "")}</div>`;
    if (key) {
      const n = [...this.shadowRoot.querySelectorAll("[data-k],[data-act]")].find((x) => (x.dataset.k || x.dataset.act + (x.dataset.room || "") + (x.dataset.dev || "")) === key);
      if (n) n.focus({ preventScroll: true });
    }
    this._footer();
    // keep the chosen settings tab in view in the sideways tab row
    const cur = this.shadowRoot.querySelector(".tabs [aria-current=page]");
    if (cur && cur.parentElement.scrollWidth > cur.parentElement.clientWidth) cur.parentElement.scrollLeft = cur.offsetLeft - 16;
  }
  _seg(path, opts) {
    const v = String(this._get(path));
    return `<div class="seg" role="group">${opts.map(([val, label]) => `<button type="button" data-act="seg" data-path="${path}" data-value="${esc(val)}" aria-pressed="${v === String(val)}">${esc(label)}</button>`).join("")}</div>`;
  }
  _toggle(act, on, attrs = "", label = "", disabled = false) {
    return `<button type="button" class="tgl" role="switch" aria-checked="${!!on}" data-act="${act}" ${attrs} aria-label="${esc(label)}"${disabled ? " disabled" : ""}></button>`;
  }
  _select(bind, ids, value, none = "None", extra = "") {
    const opts = ids.map((id) => `<option value="${esc(id)}"${id === value ? " selected" : ""}>${esc(this._stateName(id))}</option>`).join("");
    const known = !value || ids.includes(value) ? "" : `<option value="${esc(value)}" selected>${esc(value)} (not found)</option>`;
    return `<select data-bind="${bind}" data-k="${bind}" ${extra}><option value="">${esc(none)}</option>${known}${opts}</select>`;
  }
  _currencyHtml() {
    const H = this._d.household, ha = String((this._hass.config && this._hass.config.currency) || "").toUpperCase();
    const cur = H.currency || (/^[A-Z]{3}$/.test(ha) ? ha : "GBP");
    const list = GHS_CURRENCIES.includes(cur) ? GHS_CURRENCIES : [cur, ...GHS_CURRENCIES];
    let name = (c) => c;
    try { const dn = new Intl.DisplayNames([H.locale || navigator.language || "en-GB"], { type: "currency" }); name = (c) => dn.of(c) || c; } catch (e) { /* older browsers: codes only */ }
    return `<label class="f">Currency<select data-bind="household.currency" data-k="currency">${list.map((c) => `<option value="${c}"${c === cur ? " selected" : ""}>${esc(`${name(c)} (${ghsCurrencySymbol(c, H.locale || undefined)})`)}</option>`).join("")}</select>
          <span class="muted small">For energy costs. ${H.currency ? "" : ha ? "Taken from Home Assistant until you choose." : ""}</span></label>`;
  }
  _greetPreview() {
    const H = this._d.household, h = new Date().getHours();
    const part = h >= 22 || h < 5 ? "evening" : h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
    return H.greeting ? `Good ${part}, ${H.greeting}` : H.name ? `Good ${part}, ${H.name}` : `Good ${part}`;
  }

  // ---------------------------------------------------------------- wizard
  _wizardHtml() {
    const d = this._d;
    if (this._ui.saved) return this._readyHtml();
    const i = GHS_STEPS.indexOf(d.step);
    const steps = d.step === "welcome" ? "" : `<nav class="glass steps" aria-label="Setup progress">${GHS_STEPS.slice(1).map((s, k) => {
      const n = k + 1, cur = s === d.step, done = n < i || d.visited.includes(s);
      return `<button type="button" class="st${done && !cur ? " done" : ""}" data-act="go" data-step="${s}" ${cur ? 'aria-current="step"' : ""} aria-label="Step ${n} of ${GHS_STEPS.length - 1}: ${GHS_STEP_INFO[s][0]}">
        <span class="num">${done && !cur ? "✓" : n}</span><span class="lb">${GHS_STEP_INFO[s][0]}</span></button>`;
    }).join("")}</nav>`;
    const html = this[`_step_${d.step}`]();
    const last = d.step === "done";
    const foot = d.step === "welcome" ? "" : `<div class="glass float foot">
      <button type="button" class="btn ghost" data-act="back"><ha-icon icon="mdi:arrow-left"></ha-icon>Back</button>
      <span class="muted small">Step ${i} of ${GHS_STEPS.length - 1} · saved as you go</span>
      <div class="row">${["connect", "rooms", "devices", "features", "personalise", "weather"].includes(d.step) ? `<button type="button" class="btn" data-act="next">Skip for now</button>` : ""}
      ${last ? `<button type="button" class="btn primary big" data-act="finish"${this._ui.saving ? " disabled" : ""}>${this._ui.saving ? '<span class="spin"></span>Saving…' : '<ha-icon icon="mdi:check"></ha-icon>Save and finish'}</button>`
        : `<button type="button" class="btn primary" data-act="next">Continue<ha-icon icon="mdi:arrow-right"></ha-icon></button>`}</div></div>`;
    return `${steps}<main class="glass panel stack fade" aria-labelledby="ghs-h">${html}</main>${foot}`;
  }
  _step_welcome() {
    const real = GH_LOADED.cfg && GH_LOADED.cfg.setup && GH_LOADED.cfg.setup.complete;
    return `<div class="hero">
      <div>
        <div class="logo">${GHS_LOGO}<span>Glass Home</span></div>
        <h1 id="ghs-h">Welcome to Glass Home</h1>
        <p class="tagline">Your home. Your devices. Your dashboard.</p>
        <p class="lead">Glass Home is a touch-friendly dashboard for Home Assistant: a live sky that follows your weather, your lights, heating, media and cameras, room by room. A few short steps set it up for your home. Nothing is switched or changed until you choose to.</p>
        <div class="cta">
          <button type="button" class="btn primary big" data-act="go" data-step="profile"><ha-icon icon="mdi:home-plus-outline"></ha-icon>${real ? "Change my setup" : "Get started"}</button>
          <button type="button" class="btn big" data-act="explore"><ha-icon icon="mdi:play-circle-outline"></ha-icon>Explore the demo</button>
        </div>
        <p class="muted small" style="margin-top:12px">The demo is a made-up home with simulated devices. It needs no devices or accounts and never touches your own.</p>
        <details class="restore"${this._ui.importCfg || this._ui.importErr ? " open" : ""}><summary>Restore from a settings file</summary>
          <p class="muted small">Load a JSON file made by Export in Settings, Advanced. You'll check it on the last step before anything is saved.</p>
          ${this._importHtml()}</details>
      </div>
      <div class="mock" aria-hidden="true">
        <div class="sky"><div class="g">Good evening</div><div class="t">18:42</div><div class="g" style="margin-top:6px">12° · Partly cloudy</div></div>
        <div class="tiles"><div class="tl on"><i></i>Living room</div><div class="tl"><i></i>Kitchen</div><div class="tl on"><i></i>Heating 20°</div>
          <div class="tl"><i></i>Front door</div><div class="tl on"><i></i>TV</div><div class="tl"><i></i>Energy</div></div>
        <div class="nv"><i></i><i></i><i class="a"></i><i></i><i></i></div>
      </div>
    </div>
    ${real ? "" : `<section class="stack welcome-steps" style="margin-top:18px" aria-labelledby="ghs-steps-h">
      <div><h2 id="ghs-steps-h">Welcome! Follow these steps to set up your new dashboard</h2>
        <p class="muted" style="margin-top:4px">About five minutes. Everything is saved as you go, so you can stop and come back, and you can skip anything and set it up later in Settings.</p></div>
      <ol class="wsteps">${GHS_STEPS.slice(1).map((s, k) => `<li><span class="n">${k + 1}</span><ha-icon icon="${GHS_STEP_INFO[s][1]}"></ha-icon><span><b>${esc(GHS_STEP_TITLE[s])}</b><small>${esc(GHS_STEP_HINT[s])}</small></span></li>`).join("")}</ol>
      <div class="row"><button type="button" class="btn primary" data-act="go" data-step="profile"><ha-icon icon="mdi:arrow-right"></ha-icon>Start with step 1</button></div>
    </section>`}
    <div class="feat3">
      <div><b><ha-icon icon="mdi:account-heart-outline"></ha-icon>Personal</b>Your name, your rooms and the weather where you live.</div>
      <div><b><ha-icon icon="mdi:connection"></ha-icon>Your devices</b>Everything Home Assistant already controls, placed room by room.</div>
      <div><b><ha-icon icon="mdi:shield-lock-outline"></ha-icon>Private</b>No extra accounts or passwords. Settings stay in your Home Assistant.</div>
    </div>`;
  }
  _step_profile() {
    const H = this._d.household;
    let zones = [];
    try { zones = Intl.supportedValuesOf("timeZone"); } catch (e) { zones = [H.timezone || GH_TZ]; }
    if (H.timezone && !zones.includes(H.timezone)) zones.unshift(H.timezone);
    const fmt = (() => {
      try {
        const t = new Date();
        const tz = H.timezone || undefined, loc = H.locale || undefined;
        return { time: t.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit", hour12: H.clock === "12", timeZone: tz }), date: t.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone: tz }) };
      } catch (e) { return { time: "", date: "" }; }
    })();
    return `<div><h1 id="ghs-h" tabindex="-1">About you and your home</h1><p class="lead">How the dashboard greets you, and how it shows times, dates and temperatures.${this._mode === "wizard" ? " You can change all of this later in Settings." : ""}</p></div>
    <div class="grid2">
      <div class="stack">
        <label class="f">Your name (for the greeting)<input type="text" data-bind="household.greeting" data-k="greeting" value="${esc(H.greeting)}" placeholder="For example James" autocomplete="given-name" maxlength="40"></label>
        <label class="f">Home name<input type="text" data-bind="household.name" data-k="hname" value="${esc(H.name)}" placeholder="For example Maple Cottage" maxlength="60"></label>
        <label class="f">Language and formats
          <select data-bind="household.locale" data-k="locale">${GHS_LOCALES.map(([v, l]) => `<option value="${v}"${v === H.locale ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
          <span class="muted small">The dashboard's words are in English. This sets how dates and numbers are written.</span></label>
        <label class="f">Time zone
          <select data-bind="household.timezone" data-k="tz">${zones.map((z) => `<option${z === (H.timezone || GH_TZ) ? " selected" : ""}>${esc(z)}</option>`).join("")}</select></label>
      </div>
      <div class="stack">
        <div class="f"><span>Clock</span>${this._seg("household.clock", [["24", "24-hour"], ["12", "12-hour"]])}</div>
        <div class="f"><span>Temperature</span>${this._seg("household.temperature_unit", [["C", "Celsius °C"], ["F", "Fahrenheit °F"]])}</div>
        <div class="f"><span>Distance and wind</span>${this._seg("household.distance_unit", [["km", "Kilometres"], ["mi", "Miles"]])}</div>
        ${this._currencyHtml()}
        <div class="row between"><span class="f">Show the greeting</span>${this._toggle("toggle", H.show_greeting !== false, 'data-path="household.show_greeting"', "Show the greeting")}</div>
        <div class="glass panel" style="padding:18px" aria-label="Preview">
          <div class="muted small">Preview</div>
          <div class="greet" data-live="greet">${esc(this._greetPreview())}</div>
          <div class="bigt" style="margin-top:6px">${esc(fmt.time)}</div><div class="muted">${esc(fmt.date)}</div>
        </div>
        <p class="muted small">Temperatures from your own Home Assistant devices use Home Assistant's unit setting. The built-in weather follows the choice here.</p>
      </div>
    </div>`;
  }
  _step_weather() {
    const W = this._d.weather, u = this._ui;
    const ents = this._ofDomain("weather");
    const pv = u.wxPreview;
    const preview = W.source !== "open_meteo" || !W.place ? "" : !pv ? "" : pv.loading ? `<div class="row"><div class="spin"></div><span class="muted">Getting the forecast…</span></div>`
      : pv.error ? `<div class="note warn">${esc(pv.error)}</div>` : (() => {
        const a = pv.attributes, t = pv.daily[0] || {};
        const hm = (x) => (x ? new Date(x).toLocaleTimeString(this._d.household.locale || undefined, { hour: "numeric", minute: "2-digit", hour12: this._d.household.clock === "12" }) : "–");
        return `<div class="glass panel" style="padding:18px"><div class="wx"><ha-icon icon="${WEATHER_ICON_OF(pv.state)}" style="--mdc-icon-size:46px"></ha-icon>
          <div class="tmp">${Math.round(a.temperature)}${esc(a.temperature_unit)}</div><div><b>${esc(GHS_CONDITION[pv.state] || pv.state)}</b><div class="muted">Feels like ${Math.round(a.apparent_temperature)}° · ${esc(W.place.label || W.place.name)}</div></div></div>
          <div class="wxd" style="margin-top:12px"><div>Today<b>${Math.round(t.temperature)}° / ${Math.round(t.templow)}°</b></div><div>Rain chance<b>${t.precipitation_probability != null ? `${t.precipitation_probability}%` : "–"}</b></div>
          <div>Wind<b>${Math.round(a.wind_speed)} ${esc(a.wind_speed_unit)}</b></div><div>Humidity<b>${a.humidity}%</b></div><div>Sunrise<b>${hm(t.sunrise)}</b></div><div>Sunset<b>${hm(t.sunset)}</b></div></div>
          <p class="muted small" style="margin-top:10px">Forecast by Open-Meteo.com. The dashboard also shows the hourly forecast, rain timing and more in its weather pop-up.</p></div>`;
      })();
    const search = W.source !== "open_meteo" ? "" : `<div class="stack">
      <div class="row"><input type="search" data-ui="wxq" data-k="wxq" data-enter="wxSearch" value="${esc(u.wxq || "")}" placeholder="Town, city or postcode" aria-label="Search for your town, city or postcode" style="flex:1 1 220px;width:auto">
        <button type="button" class="btn primary" data-act="wxSearch"${u.searching ? " disabled" : ""}><ha-icon icon="mdi:magnify"></ha-icon>Search</button>
        <button type="button" class="btn" data-act="wxLocate"><ha-icon icon="mdi:crosshairs-gps"></ha-icon>Use my location</button></div>
      ${u.searching ? `<div class="row"><div class="spin"></div><span class="muted">Searching…</span></div>` : ""}
      ${u.wxErr ? `<div class="note warn">${esc(u.wxErr)}</div>` : ""}
      ${u.results && u.results.length ? `<div class="res" role="list">${u.results.map((r, i) => `<button type="button" class="item" role="listitem" data-act="wxPick" data-i="${i}"><div class="ic"><ha-icon icon="mdi:map-marker-outline"></ha-icon></div>
        <div class="tx"><div class="n">${esc(r.name)}</div><div class="s">${esc(ghsPlaceLabel(r))}</div></div><ha-icon icon="mdi:chevron-right"></ha-icon></button>`).join("")}</div>` : ""}
      ${W.place ? `<div class="item"><div class="ic"><ha-icon icon="mdi:map-marker-check-outline"></ha-icon></div><div class="tx"><div class="n">${esc(W.place.name)}</div><div class="s">${esc(W.place.label || "")}</div></div><span class="tag ok">Chosen</span></div>` : ""}
      ${preview}
      <p class="muted small">Only the place (rounded to about 1 km) is sent to Open-Meteo to get the forecast. It's free and needs no account or key.</p></div>`;
    const entity = W.source !== "entity" ? "" : ents.length ? `<div class="stack"><label class="f">Weather entity
      <select data-act="wxEntity" data-k="wxe"><option value="">Choose…</option>${ents.map((id) => {
        const s = this._hass.states[id];
        return `<option value="${esc(id)}"${id === W.entity ? " selected" : ""}>${esc(this._stateName(id))} · ${esc(String(s.attributes.temperature ?? "–"))}${esc(s.attributes.temperature_unit || "")} ${esc(GHS_CONDITION[s.state] || s.state)}</option>`;
      }).join("")}</select></label>
      <p class="muted small">Any weather integration in Home Assistant works (Met.no is added to new installs). Some don't report rain chance or gusts; the dashboard simply leaves those out.</p></div>`
      : `<div class="note warn">Home Assistant has no weather entity yet. Use the built-in weather instead, or add a weather integration such as Met.no (<button type="button" class="btn sm" data-act="nav" data-path="/_my_redirect/config_flow_start?domain=met">Add Met.no</button>).</div>`;
    return `<div><h1 id="ghs-h" tabindex="-1">Weather where you live</h1><p class="lead">The welcome panel's sky, the forecast strip and the weather pop-up all follow this.</p></div>
      <div class="grid2">
        <button type="button" class="opt" data-act="wxSource" data-value="open_meteo" aria-pressed="${W.source === "open_meteo"}"><ha-icon icon="mdi:map-search-outline"></ha-icon>Search for my town<span class="muted small">Built-in weather. No account needed. Includes rain chance and gusts.</span></button>
        <button type="button" class="opt" data-act="wxSource" data-value="entity" aria-pressed="${W.source === "entity"}"><ha-icon icon="mdi:home-assistant"></ha-icon>Use Home Assistant's weather<span class="muted small">${ents.length ? `${ents.length} weather entit${ents.length === 1 ? "y" : "ies"} found` : "None found yet"}</span></button>
      </div>
      ${search}${entity}
      ${W.source ? "" : `<p class="muted">Choose one, or skip: the welcome panel then shows the time and greeting without weather.</p>`}`;
  }
  _step_connect() {
    const h = this._hass, I = this._ints, disc = this._disc || [];
    const by = {};
    for (const dv of disc) by[dv.kind.group] = (by[dv.kind.group] || 0) + 1;
    const areas = Object.keys((this._reg && this._reg.areas) || {}).length;
    const have = new Set(((I && I.entries) || []).map((e) => e.domain));
    const admin = !!(h.user && h.user.is_admin);
    const flows = (I && I.flows) || [];
    const bad = ((I && I.entries) || []).filter((e) => ["setup_error", "setup_retry", "migration_error"].includes(e.state));
    const kinds = Object.keys(GHS_KIND_LABEL).filter((k) => by[k]);
    const list = this._filtered();
    return `<div><h1 id="ghs-h" tabindex="-1">Connect your devices</h1>
      <p class="lead">Glass Home shows and controls the devices your Home Assistant already knows. To add more, connect them to Home Assistant with one of the options below, then come back: your setup is saved.</p></div>
    <div class="item"><div class="ic" style="background:rgba(52,211,153,0.2);color:#6ee7b7"><ha-icon icon="mdi:home-assistant"></ha-icon></div>
      <div class="tx"><div class="n">Home Assistant${h.config && h.config.version ? ` ${esc(h.config.version)}` : ""}</div>
      <div class="s">Connected as ${esc((h.user && h.user.name) || "you")}${admin ? " (administrator)" : ""}. Glass Home uses this signed-in session: no token or password is needed or stored.</div></div><span class="tag ok"><span class="dot on"></span>Connected</span></div>
    <div class="row">${kinds.map((k) => `<button type="button" class="chip" data-act="kind" data-kind="${k}" aria-pressed="${this._ui.kind === k}"${this._ui.kind === k ? ' style="background:rgba(139,92,246,0.4)"' : ""}>${esc(GHS_KIND_LABEL[k])} <b>${by[k]}</b></button>`).join("")}
      <span class="chip">Rooms in Home Assistant <b>${areas}</b></span>
      <button type="button" class="btn sm" data-act="refresh"><ha-icon icon="mdi:refresh"></ha-icon>Look again</button></div>
    ${flows.length ? `<div class="stack"><h2>Found on your network</h2><p class="muted">Home Assistant discovered these. Set them up there, then tap Look again.</p>
      <div class="grid3">${flows.map((f) => `<div class="item"><div class="ic"><ha-icon icon="mdi:access-point-network"></ha-icon></div><div class="tx"><div class="n">${esc((f.context.title_placeholders && f.context.title_placeholders.name) || f.handler)}</div><div class="s">${esc(f.handler)}</div></div>
        <button type="button" class="btn sm" data-act="nav" data-path="/config/integrations/dashboard">Set up</button></div>`).join("")}</div></div>` : ""}
    ${bad.length ? `<div class="stack"><h2>Needs attention</h2><div class="grid3">${bad.map((e) => `<div class="item"><div class="ic" style="background:rgba(248,113,113,0.18);color:#fca5a5"><ha-icon icon="mdi:alert-circle-outline"></ha-icon></div>
      <div class="tx"><div class="n">${esc(e.title || e.domain)}</div><div class="s">${esc(e.domain)} · ${e.state === "setup_retry" ? "can't connect, retrying" : "failed to start"}${e.reason ? ` · ${esc(e.reason)}` : ""}</div></div>
      <button type="button" class="btn sm" data-act="retry" data-entry="${esc(e.entry_id)}">Retry</button></div>`).join("")}</div></div>` : ""}
    <div class="stack"><div class="row between"><h2>Your devices <span class="muted small">(${disc.length})</span></h2>
      <input type="search" data-ui="search" data-k="dsearch" value="${esc(this._ui.search)}" placeholder="Search devices" aria-label="Search devices" style="max-width:260px"></div>
      ${disc.length ? `<div class="scroll"><table><thead><tr><th>Device</th><th>Type</th><th>Controls</th><th>Status</th><th>Room</th><th>Source</th></tr></thead>
        <tbody data-devrows>${this._devRows(list)}</tbody></table></div>`
        : `<div class="note">No devices yet. Add a connection below, or skip this step: the dashboard shows tidy "Set up" boxes until there's something to show.</div>`}</div>
    <div class="stack"><h2>Add a connection</h2>
      <p class="muted">These run in Home Assistant${admin ? "" : " (an administrator has to add them)"}. Glass Home doesn't pair devices itself: a web page can't reach Matter, Zigbee or most Wi-Fi devices directly, so Home Assistant does it safely and Glass Home uses the result.</p>
      ${I && I.loading ? `<div class="row"><div class="spin"></div><span class="muted">Checking your integrations…</span></div>` : ""}
      ${I && I.err === "admin" ? `<div class="note">Sign in as an administrator to see which integrations are set up.</div>` : ""}
      <div class="grid3">${GHS_CONNECT.map((c) => `<div class="item" style="align-items:flex-start"><div class="ic"><ha-icon icon="${c.icon}"></ha-icon></div>
        <div class="tx"><div class="n" style="white-space:normal">${esc(c.name)}</div><div class="s">${esc(c.note)}</div>
        <div class="row" style="margin-top:8px">${have.has(c.domain) ? `<span class="tag ok">Connected</span><button type="button" class="btn sm" data-act="nav" data-path="/config/integrations/integration/${c.domain}">Open</button>`
          : `<button type="button" class="btn sm" data-act="nav" data-path="/_my_redirect/config_flow_start?domain=${c.domain}"${admin ? "" : " disabled"}>Add in Home Assistant</button>`}</div></div></div>`).join("")}</div>
      <p class="muted small">Not listed? Home Assistant supports over 2,000 integrations: <button type="button" class="btn sm" data-act="nav" data-path="/config/integrations/dashboard"${admin ? "" : " disabled"}>Browse all integrations</button></p></div>`;
  }
  _filtered() {
    const q = String(this._ui.search || "").toLowerCase(), k = this._ui.kind;
    return (this._disc || []).filter((dv) => (!k || dv.kind.group === k) && (!q || `${dv.name} ${dv.id} ${dv.areaName} ${dv.kind.type} ${dv.source}`.toLowerCase().includes(q)));
  }
  _devRows(list) {
    return list.slice(0, 300).map((dv) => `<tr><td><div class="row" style="flex-wrap:nowrap"><ha-icon icon="${esc(dv.icon)}"></ha-icon><div><div class="nm">${esc(dv.name)}</div><div class="muted small">${esc(dv.id)}</div></div></div></td>
      <td>${esc(dv.kind.type)}</td><td class="muted">${esc(dv.kind.controls.join(", ") || "Shows its reading")}</td>
      <td><span class="row" style="gap:6px;flex-wrap:nowrap"><span class="dot ${dv.online ? "on" : "off"}"></span>${dv.online ? "Online" : "Offline"}</span></td>
      <td>${esc(dv.areaName || "–")}</td><td class="muted">${esc(dv.source || "–")}</td></tr>`).join("")
      + (list.length > 300 ? `<tr><td colspan="6" class="muted">${list.length - 300} more: search to narrow the list</td></tr>` : "");
  }
  _filterDevices() {
    const tb = this.shadowRoot.querySelector("[data-devrows]");
    if (tb) tb.innerHTML = this._devRows(this._filtered());
  }
  _iconPicker(target, current) {
    if (this._ui.picker !== target) return "";
    return `<div class="icons" role="group" aria-label="Choose an icon">${GHS_ROOM_ICONS.concat(["mdi:lightbulb-outline", "mdi:lamp", "mdi:ceiling-light", "mdi:led-strip-variant", "mdi:power-socket-uk", "mdi:television", "mdi:speaker", "mdi:thermostat", "mdi:radiator", "mdi:fan", "mdi:blinds", "mdi:cctv", "mdi:door", "mdi:thermometer"])
      .filter((x, i, a) => a.indexOf(x) === i).map((ic) => `<button type="button" data-act="pickIcon" data-icon="${ic}" aria-pressed="${ic === current}" aria-label="${ic.slice(4).replace(/-/g, " ")}"><ha-icon icon="${ic}"></ha-icon></button>`).join("")}
      <input type="text" data-act="iconText" data-enter="iconText" data-k="icontext" placeholder="Any icon: mdi:… then Enter" aria-label="Type any Material Design icon name" style="grid-column:1/-1;min-height:40px"></div>`;
  }
  _step_rooms() {
    const d = this._d, areas = Object.values((this._reg && this._reg.areas) || {});
    const unused = GHS_ROOM_SUGGESTIONS.filter(([n]) => !d.rooms.some((r) => r.name.toLowerCase() === n.toLowerCase()));
    return `<div><h1 id="ghs-h" tabindex="-1">Your rooms</h1><p class="lead">Rooms group your devices on the dashboard. Rename, reorder or hide them any time.</p></div>
    ${areas.length ? `<div class="note row between"><span>Home Assistant already has <b>${areas.length}</b> room${areas.length === 1 ? "" : "s"} (areas)${d.rooms.length ? "" : ", with your devices in them"}.</span>
      <button type="button" class="btn primary sm" data-act="importAreas"><ha-icon icon="mdi:import"></ha-icon>Import from Home Assistant</button></div>` : ""}
    <div class="stack">${d.rooms.length ? d.rooms.map((r, i) => `<div class="room${r.visible === false ? " hidden" : ""}">
      <div class="rhead">
        <button type="button" class="iconbtn" data-act="picker" data-target="room:${i}" aria-label="Change the icon for ${esc(r.name || "this room")}" aria-expanded="${this._ui.picker === `room:${i}`}"><ha-icon icon="${esc(r.icon)}"></ha-icon></button>
        <input type="text" data-room="${i}" data-f="name" data-k="room${i}" value="${esc(r.name)}" aria-label="Room name" maxlength="40">
        <span class="muted small">${r.entities.length} device${r.entities.length === 1 ? "" : "s"}${r.area_id ? " · from Home Assistant" : ""}</span>
        <div class="row" style="gap:6px">
          ${this._toggle("roomVisible", r.visible !== false, `data-room="${i}"`, `Show ${r.name} on the dashboard`)}
          <button type="button" class="btn ib" data-act="roomUp" data-room="${i}" aria-label="Move ${esc(r.name)} up"${i === 0 ? " disabled" : ""}><ha-icon icon="mdi:arrow-up"></ha-icon></button>
          <button type="button" class="btn ib" data-act="roomDown" data-room="${i}" aria-label="Move ${esc(r.name)} down"${i === d.rooms.length - 1 ? " disabled" : ""}><ha-icon icon="mdi:arrow-down"></ha-icon></button>
          <button type="button" class="btn ib danger" data-act="roomRemove" data-room="${i}" aria-label="Remove ${esc(r.name)}"><ha-icon icon="mdi:delete-outline"></ha-icon></button>
        </div></div>${this._iconPicker(`room:${i}`, r.icon)}</div>`).join("") : `<div class="note">No rooms yet. Pick some below${areas.length ? " or import them from Home Assistant" : ""}.</div>`}</div>
    <div class="stack"><h2>Add a room</h2>
      <div class="row">${unused.map(([n, ic]) => `<button type="button" class="chip" data-act="addRoom" data-name="${esc(n)}" data-icon="${ic}"><ha-icon icon="${ic}"></ha-icon>${esc(n)}</button>`).join("")}</div>
      <div class="row"><input type="text" data-ui="newRoom" data-k="newroom" data-enter="addRoom" value="${esc(this._ui.newRoom || "")}" placeholder="Another room, e.g. Nursery" aria-label="New room name" style="flex:1 1 220px;width:auto" maxlength="40">
        <button type="button" class="btn" data-act="addRoom"><ha-icon icon="mdi:plus"></ha-icon>Add room</button></div></div>`;
  }
  _devLine(id, i) {
    const d = this._d, o = d.devices[id] || {}, dv = (this._disc || []).find((x) => x.id === id), st = this._hass.states[id];
    const kind = dv ? dv.kind : ghsKind(id, (st && st.attributes) || {}) || { type: id.split(".")[0], controls: [], icon: "mdi:help-circle-outline" };
    const icon = o.icon || (dv && dv.icon) || kind.icon;
    const rooms = `<select data-dev="${esc(id)}" data-f="room" data-k="room-${esc(id)}" aria-label="Room for ${esc(this._stateName(id))}"><option value="">Not in a room</option>${d.rooms.map((r, k) => `<option value="${k}"${k === i ? " selected" : ""}>${esc(r.name || "Unnamed")}</option>`).join("")}</select>`;
    return `<div class="dev${o.hidden ? " off" : ""}">
      <button type="button" class="iconbtn" data-act="picker" data-target="dev:${esc(id)}" aria-label="Change the icon for ${esc(this._stateName(id))}"><ha-icon icon="${esc(icon)}"></ha-icon></button>
      <div class="tx"><input type="text" data-dev="${esc(id)}" data-f="name" data-k="dn-${esc(id)}" value="${esc(o.name || "")}" placeholder="${esc((st && st.attributes.friendly_name) || id)}" aria-label="Name shown for ${esc((st && st.attributes.friendly_name) || id)}" maxlength="40">
        <div class="muted small" style="margin-top:4px">${esc(kind.type)}${kind.controls.length ? ` · ${esc(kind.controls.join(", "))}` : ""}${st ? (GHS_UNAVAILABLE.includes(st.state) ? ' · <span style="color:#fca5a5">offline</span>' : "") : ' · <span style="color:#fca5a5">not found</span>'}</div></div>
      <div class="acts">
        ${id.startsWith("switch.") ? `<button type="button" class="chip" data-act="asLight" data-dev="${esc(id)}" aria-pressed="${!!o.as_light}"${o.as_light ? ' style="background:rgba(139,92,246,0.4)"' : ""}>Is a light</button>` : ""}
        <button type="button" class="btn ib star" data-act="fav" data-dev="${esc(id)}" aria-pressed="${!!o.favourite}" aria-label="Favourite"><ha-icon icon="${o.favourite ? "mdi:star" : "mdi:star-outline"}"></ha-icon></button>
        <button type="button" class="btn ib" data-act="hide" data-dev="${esc(id)}" aria-pressed="${!!o.hidden}" aria-label="${o.hidden ? "Show" : "Hide"} on the dashboard"><ha-icon icon="${o.hidden ? "mdi:eye-off-outline" : "mdi:eye-outline"}"></ha-icon></button>
        ${rooms}</div>
      ${this._ui.picker === `dev:${id}` ? `<div style="grid-column:1/-1">${this._iconPicker(`dev:${id}`, icon)}</div>` : ""}</div>`;
  }
  _step_devices() {
    const d = this._d, taken = this._assigned();
    const free = (this._disc || []).filter((dv) => !taken.has(dv.id) && !["weather", "people", "scenes"].includes(dv.kind.group));
    const opts = free.map((dv) => `<option value="${esc(dv.id)}">${esc(dv.name)} · ${esc(dv.kind.type)}${dv.areaName ? ` (${esc(dv.areaName)})` : ""}</option>`).join("");
    const canArea = free.some((dv) => dv.area && d.rooms.some((r) => r.area_id === dv.area));
    return `<div><h1 id="ghs-h" tabindex="-1">What's on your dashboard</h1>
      <p class="lead">Each device gets the right control automatically: lights get brightness and colour, thermostats a temperature control, TVs and speakers media controls, cameras a live view and sensors their reading. Rename, star your favourites (shown first on the homepage) or hide what you don't need.</p></div>
    ${canArea ? `<div class="note row between"><span>Some devices already have a room in Home Assistant.</span><button type="button" class="btn primary sm" data-act="assignArea"><ha-icon icon="mdi:auto-fix"></ha-icon>Put them in their rooms</button></div>` : ""}
    ${d.rooms.length ? d.rooms.map((r, i) => `<section class="room stack" aria-label="${esc(r.name)}"><div class="row between"><h2 class="row" style="gap:8px"><ha-icon icon="${esc(r.icon)}"></ha-icon>${esc(r.name || "Unnamed room")}</h2>${r.visible === false ? '<span class="tag">Hidden</span>' : ""}</div>
      ${r.entities.length ? `<div class="stack" style="gap:8px">${r.entities.map((id) => this._devLine(id, i)).join("")}</div>` : `<p class="muted">No devices here yet.</p>`}
      ${free.length ? `<div class="row"><select data-addfor="${i}" data-k="add${i}" aria-label="Add a device to ${esc(r.name)}" style="flex:1 1 220px;width:auto"><option value="">Add a device…</option>${opts}</select>
        <button type="button" class="btn sm" data-act="addToRoom" data-room="${i}"><ha-icon icon="mdi:plus"></ha-icon>Add</button></div>` : ""}</section>`).join("")
      : `<div class="note">Add some rooms first (step ${GHS_STEPS.indexOf("rooms")}), then put devices in them here. <button type="button" class="btn sm" data-act="go" data-step="rooms">Go to rooms</button></div>`}
    ${free.length ? `<details class="room"><summary class="row" style="cursor:pointer"><b>Not in a room</b><span class="muted small">${free.length} device${free.length === 1 ? "" : "s"}, not on the dashboard yet</span></summary>
      <div class="stack" style="gap:8px;margin-top:10px">${free.slice(0, 120).map((dv) => this._devLine(dv.id, -1)).join("")}</div></details>` : ""}`;
  }
  _step_personalise() {
    const A = this._d.appearance, F = this._d.features;
    const pages = GHS_PAGES.filter((p) => !p.feature || F[p.feature] !== false);
    return `<div><h1 id="ghs-h" tabindex="-1">Make it yours</h1><p class="lead">Glass Home is a dark, frosted-glass design built for night-time and wall tablets, so there's no light version. These keep the look and change what you see.</p></div>
    <div class="stack"><h2>Background</h2><div class="grid2">
      <button type="button" class="opt" data-act="seg" data-path="appearance.background" data-value="aurora" aria-pressed="${A.background !== "plain"}"><div class="swatch" style="background:#120d22 url('${GH_ASSETS}bg.svg') center/cover"></div>Aurora (standard)</button>
      <button type="button" class="opt" data-act="seg" data-path="appearance.background" data-value="plain" aria-pressed="${A.background === "plain"}"><div class="swatch" style="background:linear-gradient(170deg,#1a1430,#0f0b1d)"></div>Midnight (plain)</button></div></div>
    <div class="grid2">
      <label class="f">Home screen<select data-bind="appearance.home" data-k="home">${pages.filter((p) => A.pages[p.id] !== false).map((p) => `<option value="${p.id}"${p.id === A.home ? " selected" : ""}>${esc(p.title)}</option>`).join("")}</select>
        <span class="muted small">The page the dashboard opens on.</span></label>
      <div class="f"><span>On narrow screens</span>${this._seg("appearance.fit", [["reflow", "Scroll at full size"], ["scale", "Shrink to fit"]])}<span class="muted small">"Shrink to fit" suits wall tablets that should never scroll.</span></div></div>
    <div class="stack"><h2>Pages in the navigation bar</h2><p class="muted small" style="margin:-4px 0 0">Type a new name to rename a page in the bottom bar. Leave it blank for the usual name.</p><div class="grid3">${pages.map((p) => `<div class="item"><div class="ic"><ha-icon icon="${p.icon}"></ha-icon></div><div class="tx"><input type="text" class="pname" data-bind="appearance.titles.${p.id}" data-k="pt-${p.id}" value="${esc((A.titles || {})[p.id] || "")}" placeholder="${esc(this._pageDefault(p))}" maxlength="16" aria-label="Name of the ${esc(p.title)} page"></div>
      ${p.id === "home" ? '<span class="tag">Always</span>' : this._toggle("page", A.pages[p.id] !== false, `data-page="${p.id}"`, `Show ${p.title}`)}</div>`).join("")}</div>
      <p class="muted small">Pages for features you switch off ${this._mode === "wizard" ? "in the next step" : "in Dashboard features"} disappear by themselves.</p></div>
    <div class="row between item"><div class="tx"><div class="n">Greeting</div><div class="s">"${esc(this._greetPreview())}" on the welcome panel</div></div>${this._toggle("toggle", this._d.household.show_greeting !== false, 'data-path="household.show_greeting"', "Show the greeting")}</div>`;
  }
  // the name a page has when you haven't renamed it (the Media page takes the music service's name)
  _pageDefault(p) {
    if (p.id !== "media") return p.title;
    const C = this._d.choices, F = this._d.features, m = GHS_MUSIC[C.music_service];
    if (m && C.music_service === "spotify" ? F.spotify : m && F.music) return m.name;
    return p.title;
  }
  // media players for the TV choice: real TVs first, music accounts (Spotify) left out
  _tvList() {
    const S = this._hass.states, spot = new Set(this._spotifyIds ? this._spotifyIds() : []);
    const tv = (id) => (S[id] && S[id].attributes.device_class === "tv") || /tv|television/i.test(this._stateName(id)) ? 0 : 1;
    return this._ofDomain("media_player").filter((id) => !spot.has(id)).sort((a, b) => tv(a) - tv(b));
  }
  // when Home Assistant has exactly one of something, choose it, so nobody has to pick from a list of one.
  // Only fills empty choices; never changes one that was made.
  _autoPick() {
    const d = this._d, C = d.choices;
    if (!C || this._mode !== "wizard" || !this._hass) return;
    // each choice is filled at most once a visit, so clearing it on purpose sticks
    const done = (this._ui.autoPicked = this._ui.autoPicked || {});
    const one = (path, ids) => { if (done[path] || this._get(path) || ids.length !== 1) return false; done[path] = true; this._set(path, ids[0]); return true; };
    one("choices.thermostat", this._ofDomain("climate"));
    one("choices.person", this._ofDomain("person"));
    const tvs = this._tvList(), S = this._hass.states;
    if (!C.tv && !done["choices.tv"]) { const real = tvs.filter((id) => S[id].attributes.device_class === "tv"); if (real.length === 1) { done["choices.tv"] = true; this._set("choices.tv", real[0]); } else one("choices.tv", tvs); }
    if (this._spotifyIds && C.spotify !== undefined) one("choices.spotify", this._spotifyIds());
    if (C.bins && C.bins.source === "calendar") one("choices.bins.calendar", this._ofDomain("calendar"));
  }
  _feat(key, icon, title, desc, opts = {}) {
    const on = !!this._d.features[key], can = opts.can !== false;
    return `<div class="feat"><div class="top"><div class="item" style="padding:0;background:none;border:0"><div class="ic"><ha-icon icon="${icon}"></ha-icon></div></div>
      <div class="tx"><h3>${esc(title)}</h3><p class="muted" style="margin-top:3px">${desc}</p>${opts.status ? `<div style="margin-top:6px">${opts.status}</div>` : ""}</div>
      ${this._toggle("feature", on && can, `data-feature="${key}"`, title, !can)}</div>${on && can && opts.body ? opts.body : ""}</div>`;
  }
  _step_features() {
    const d = this._d, C = d.choices, S = this._hass.states, svc = this._hass.services || {};
    // first time here in the wizard: fill the scene buttons from the scenes' names
    if (this._mode === "wizard" && !this._ui.sceneAuto && !Object.values(C.scenes || {}).some(Boolean)) { this._ui.sceneAuto = true; C.scenes = ghsSceneMatch(S, {}); }
    const ok = (t) => `<span class="tag ok">${esc(t)}</span>`, warn = (t) => `<span class="tag warn">${esc(t)}</span>`;
    const cams = this._ofDomain("camera"), tvs = this._tvList(), people = this._ofDomain("person"), scenes = this._ofDomain("scene");
    const climates = this._ofDomain("climate"), todos = this._ofDomain("todo"), remotes = this._ofDomain("remote");
    const energy = ghsDetectEnergy(S), laundry = ghsDetectLaundry(S), hive = ghsDetectHive(S, (this._reg && this._reg.entities) || {}, C.thermostat);
    const spotify = this._spotifyIds ? this._spotifyIds() : [];
    const news = !!(svc.glasshome_news && svc.glasshome_news.fetch);
    const tvScript = !!S["script.glasshome_tv_power"];
    const sel = (bind, ids, none, label) => `<label class="f">${esc(label)}${this._select(bind, ids, this._get(bind), none)}</label>`;
    return `<div><h1 id="ghs-h" tabindex="-1">${this._mode === "wizard" ? "Extras" : "Dashboard features"}</h1><p class="lead">Switch on what you use. Each one only appears on the dashboard when it's on, and anything Glass Home can't find is greyed out with the reason.</p></div>
    <div class="stack">
      ${this._feat("climate", "mdi:thermostat", "Heating and climate", "Thermostat control on the Climate page and the indoor temperature pill.", {
        can: climates.length > 0, status: climates.length ? ok(`${climates.length} thermostat${climates.length === 1 ? "" : "s"} found`) : warn("No thermostat in Home Assistant"),
        body: `<div class="grid2">${sel("choices.thermostat", climates, "Choose a thermostat", "Thermostat")}${sel("choices.temperature", this._sensors("temperature"), "The thermostat's own reading", "Indoor temperature sensor (optional)")}
          ${sel("choices.heater_switch", this._ofDomain("switch"), "No plug-in heater", "Plug-in heater (optional)")}${C.heater_switch ? sel("choices.heater_power", this._sensors("power"), "No power reading", "Heater power sensor (optional)") : ""}</div>` })}
      ${this._feat("heating_hive", "mdi:calendar-clock", "Hive heating schedule", "A full heating control centre with schedules, boost and history for Hive thermostats.", {
        can: !!(hive && hive.helpers), status: !hive ? warn("Needs a Hive thermostat") : hive.helpers ? ok("Hive and the schedule helpers found") : warn("Needs packages/glasshome_heating.yaml and the Heating schedule helper (see the install guide)") })}
      ${this._feat("media", "mdi:television-play", "TV and media", "TV state, volume and playback on the Media page.", {
        can: tvs.length > 0, status: tvs.length ? ok(`${tvs.length} media player${tvs.length === 1 ? "" : "s"} found`) : warn("No media players in Home Assistant"),
        body: `<div class="grid2">${sel("choices.tv", tvs, "Choose your TV", "TV")}${sel("choices.tv_remote", remotes, "None", "TV remote (Android TV Remote, optional)")}</div>` })}
      ${this._feat("tv_power", "mdi:power", "TV power button", "Turns the TV on (Wake-on-LAN) and off.", { can: tvScript && !!C.tv_remote, status: tvScript ? (C.tv_remote ? ok("Ready") : warn("Choose the TV remote above")) : warn("Needs packages/glasshome_tv_power.yaml (see the install guide)") })}
      ${this._mode === "wizard" ? this._musicPickerHtml() : `<div class="feat"><div class="top"><div class="item" style="padding:0;background:none;border:0"><div class="ic"><ha-icon icon="mdi:music-circle-outline"></ha-icon></div></div>
        <div class="tx"><h3>Music</h3><p class="muted" style="margin-top:3px">Spotify, Apple Music or another music service: what's playing and your playlists on the Media page.</p>
        <div style="margin-top:6px">${GHS_MUSIC[C.music_service] ? ok(`Using ${GHS_MUSIC[C.music_service].name === "Music" ? "a music player" : GHS_MUSIC[C.music_service].name}`) : warn("No music service chosen")}${this._moreHere("media", "Choose a music service in Media and music", "")}</div></div></div></div>`}
      ${this._feat("cctv", "mdi:cctv", "Cameras and security", "Live camera views on the Security page and a camera status pill.", {
        can: cams.length > 0, status: cams.length ? ok(`${cams.length} camera${cams.length === 1 ? "" : "s"} found`) : warn("No cameras in Home Assistant"),
        body: `<div class="grid3">${cams.map((id) => `<div class="item"><div class="tx"><div class="n">${esc(this._stateName(id))}</div><div class="s">${esc(id)}</div></div>${this._toggle("camera", C.cameras.includes(id), `data-dev="${esc(id)}"`, `Show ${this._stateName(id)}`)}</div>`).join("")}</div>` })}
      ${this._feat("presence", "mdi:home-account", "Home or away", "A pill showing whether someone is home.", {
        can: people.length > 0, status: people.length ? ok(`${people.length} ${people.length === 1 ? "person" : "people"} found`) : warn("No people in Home Assistant"),
        body: `<div class="grid2">${sel("choices.person", people, "Choose a person", "Person")}</div>` })}
      ${this._feat("lighting", "mdi:palette-outline", "Lights page and scenes", "Room switches, all on and off, and up to six scene buttons.", {
        status: scenes.length ? ok(`${scenes.length} scene${scenes.length === 1 ? "" : "s"} found`) : `<span class="tag">No scenes yet: the scene buttons stay hidden</span>`,
        body: scenes.length ? `<p class="muted small" style="margin:10px 0 6px">Each button shows the scene's own name. <b>Match by name</b> fills the empty buttons with scenes whose names fit (for example "Movie night" for film).</p>
          <div class="grid3">${GHS_SCENES.map((k) => sel(`choices.scenes.${k}`, scenes, "Not used", `"${k.replace("_", " ")}" button`)).join("")}</div>
          <div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-act="sceneMatch"><ha-icon icon="mdi:auto-fix"></ha-icon>Match by name</button><button type="button" class="btn sm" data-act="sceneClear">Clear all</button></div>` : "" })}
      ${this._feat("news", "mdi:newspaper-variant-outline", "News", "Headlines from public news feeds, with saved stories.", {
        can: news, status: news ? ok("Glass Home News is installed") : warn("Needs the Glass Home News integration (included, see the install guide)"),
        body: `<div class="grid2">${sel("choices.news_todo", todos, "todo.glasshome_news", "To-do list for saved stories")}</div>${this._hass.states[C.news_todo || "todo.glasshome_news"] ? "" : `<div class="note warn row between"><span>Saving stories needs a to-do list. Add a Local To-do list called <b>Glass Home News</b>, or choose another list above. Headlines work without it.</span>${typeof this._addBtn === "function" ? this._addBtn("local_todo", "Add a to-do list") : ""}</div>`}` })}
      ${this._feat("energy", "mdi:lightning-bolt", "Energy", "Live use, today's use and cost from your supplier's smart meter or any meter in Home Assistant.", {
        status: energy ? ok(`Octopus Energy found${energy.gas ? " (electricity and gas)" : ""}`) : C.energy.method ? ok("Connection chosen") : warn("Choose your supplier and meter"),
        body: this._moreHere("energy", "Choose your supplier and meters in Energy", this._energyHtml()) })}
      ${this._feat("laundry", "mdi:washing-machine", "Laundry", "Washer progress and wash history.", { can: !!(laundry && laundry.helpers), status: !laundry ? warn("Needs a SmartThings washer") : laundry.helpers ? ok("Washer and helpers found") : warn("Needs packages/glasshome_laundry.yaml") })}
      ${this._feat("bins", "mdi:delete-variant", "Bin day", "A reminder the evening before collection, and the next collections on the home screen. Upload your council's calendar for exact dates.", {
        body: this._moreHere("bins", "Set up collections in Bin collections", this._binsHtml()) })}
      ${this._feat("floorplan", "mdi:floor-plan", "Floor plan", "An interactive plan of your home with your devices on it. Starts with a sample plan: after setup, upload a picture of your own plan or draw it in the building editor (Settings, Floor plan), then place your devices on it.")}
    </div>`;
  }
  // "androidtv_remote" -> "Android TV Remote": the integration's own title when Home Assistant has loaded it
  _intName(domain) {
    if (!domain) return domain;
    const e = ((this._ints && this._ints.entries) || []).find((x) => x.domain === domain);
    const known = { hue: "Philips Hue", tplink: "TP-Link", androidtv_remote: "Android TV Remote", generic_thermostat: "Generic Thermostat", generic: "Generic Camera", met: "Met.no", hildebrand_glow_dcc: "Hildebrand Glow", octopus_energy: "Octopus Energy", esphome: "ESPHome", mqtt: "MQTT", zha: "Zigbee (ZHA)", zwave_js: "Z-Wave", homekit_controller: "HomeKit", cast: "Google Cast", smartthings: "SmartThings" };
    return known[domain] || (e && e.title && !/[0-9]{3}|@/.test(e.title) ? e.title : domain.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  _summary(cfg) {
    const F = cfg.features || {}, rooms = cfg.rooms || [], devs = ghsUniq(rooms.flatMap((r) => (r.entities || []).map((e) => (typeof e === "object" ? e.entity : e))));
    // integrations that are failing (and have no working entry) aren't connecting anything, so they're left out
    const E = (this._ints && this._ints.entries) || [], BAD = ["setup_error", "setup_retry", "migration_error", "failed_unload", "not_loaded"];
    const failing = (dom) => E.some((e) => e.domain === dom) && !E.some((e) => e.domain === dom && !BAD.includes(e.state));
    const ints = ghsUniq(devs.map((id) => ((this._reg && this._reg.entities[id]) || {}).platform)).filter((d) => d && !failing(d)).map((d) => this._intName(d));
    const W = cfg.weather;
    const names = { weather: "Weather", lighting: "Lights", climate: "Heating", news: "News", presence: "Home or away", heating_hive: "Hive schedule", energy: "Energy",
      media: "TV", spotify: "Spotify", music: (GHS_MUSIC[(cfg.media && cfg.media.music && cfg.media.music.service) || ""] || { name: "Music" }).name, tv_power: "TV power",
      cctv: "Cameras", laundry: "Laundry", bins: "Bin day", floorplan: "Floor plan" };
    const on = Object.entries(F).filter(([, v]) => v).map(([k]) => names[k] || k.replace(/_/g, " "));
    const cell = (l, v) => `<div>${esc(l)}<b>${esc(v)}</b></div>`;
    return `<div class="sum">${cell("Home", cfg.household.name || "Not named")}${cell("Greeting", cfg.household.greeting || "None")}
      ${cell("Weather", W ? (W.provider === "open_meteo" ? W.place.label || W.place.name : this._stateName(W.entity)) : "Not set")}
      ${cell("Connected through", ints.length ? ints.join(", ") : "Home Assistant")}${cell("Devices on the dashboard", String(devs.length))}
      ${cell("Rooms", rooms.length ? rooms.map((r) => r.name).join(", ") : "None yet")}${((cfg.setup && cfg.setup.empty_rooms) || []).length ? cell("Not shown yet (no devices)", cfg.setup.empty_rooms.map((r) => r.name).join(", ")) : ""}${cell("Features on", on.join(", ") || "None")}</div>`;
  }
  _step_done() {
    const probs = ghsProblems(this._d);
    let cfg = null, err = "";
    try { cfg = this._buildCfg(); } catch (e) { err = e.message; }
    const admin = !!(this._hass.user && this._hass.user.is_admin);
    return `<div><h1 id="ghs-h" tabindex="-1">Ready to save</h1><p class="lead">Here's your setup. Saving writes it into this dashboard in Home Assistant; you can change anything later in Settings.</p></div>
      ${cfg ? this._summary(cfg) : `<div class="note bad">${esc(err)}</div>`}
      ${probs.length ? `<div class="note warn">${probs.map((p) => `${esc(p.text)} <button type="button" class="btn sm" data-act="go" data-step="${p.step}">Fix</button>`).join("<br>")}</div>` : ""}
      ${admin ? "" : `<div class="note warn">You're signed in without administrator rights, and Home Assistant only lets administrators save dashboards. Ask an administrator to finish, or copy the settings below for them.</div>`}
      ${this._ui.saveErr ? `<div class="note bad" role="alert">Not saved: ${esc(this._ui.saveErr)}</div>` : ""}
      ${this._ui.saveYaml || !admin ? `<div class="stack"><p class="muted">Paste this into the dashboard's raw configuration editor (or <code>/config/glasshome/config.yaml</code> for a YAML dashboard), replacing any <code>glasshome:</code> section:</p>
        <textarea readonly aria-label="Glass Home settings as YAML" data-k="yaml">${esc(this._yaml())}</textarea><div class="row"><button type="button" class="btn" data-act="copyYaml"><ha-icon icon="mdi:content-copy"></ha-icon>Copy</button>
        <button type="button" class="btn" data-act="export" data-format="yaml"><ha-icon icon="mdi:download"></ha-icon>Download</button></div></div>` : ""}`;
  }
  _readyHtml() {
    const cfg = this._ui.saved;
    return `<main class="glass panel stack ready fade" aria-labelledby="ghs-h"><div class="badge"><ha-icon icon="mdi:check-bold"></ha-icon></div>
      <h1 id="ghs-h" tabindex="-1">Your Glass Home is Ready</h1><p class="lead" style="margin:0 auto">Saved in Home Assistant. Settings is at the end of the navigation bar whenever you want to change something.</p>
      ${this._summary(cfg)}<button type="button" class="btn primary big" data-act="openDashboard"><ha-icon icon="mdi:view-dashboard-outline"></ha-icon>Open My Dashboard</button></main>`;
  }

  // ---------------------------------------------------------------- settings page
  _settingsHtml() {
    if (!this._tab) { try { this._tab = sessionStorage.getItem("glasshome.settings.tab") || ""; } catch (e) { /* not kept */ } }
    const tab = GHS_TABS.some(([id]) => id === this._tab) ? this._tab : "profile";
    const admin = !!(this._hass.user && this._hass.user.is_admin);
    const body = tab === "advanced" ? this._advancedHtml() : this[`_step_${tab}`]();
    return `<header class="glass panel row between" style="padding:16px 20px"><div class="row" style="gap:12px">${GHS_LOGO.replace("<svg", '<svg style="width:40px;height:40px"')}<div><h2>Settings</h2><div class="muted small">${esc((GH_CFG.household && GH_CFG.household.name) || "Glass Home")}${GH_DEMO ? " · demo mode is on" : ""}</div></div></div>
      <button type="button" class="btn" data-act="nav" data-path="${ghBase()}/home"><ha-icon icon="mdi:arrow-left"></ha-icon>Dashboard</button></header>
      ${admin ? "" : `<div class="note warn">Only administrators can save these settings. You can look around and export them.</div>`}
      <div class="settings"><select class="tabsel glass" data-act="tabSel" data-k="tabsel" aria-label="Settings section">${GHS_TABS.map(([id, l]) => `<option value="${id}"${id === tab ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <nav class="glass tabs" aria-label="Settings sections">${GHS_TABS.map(([id, l, ic]) => `<button type="button" data-act="tab" data-tab="${id}"${id === tab ? ' aria-current="page"' : ""}><ha-icon icon="${ic}"></ha-icon>${esc(l)}</button>`).join("")}</nav>
      <div class="stack"><main class="glass panel stack fade" aria-labelledby="ghs-h">${body}</main>
      ${tab === "advanced" ? "" : `<div class="glass float foot">${this._ui.saveErr ? `<span class="note bad" role="alert" style="flex:1 1 100%">Not saved: ${esc(this._ui.saveErr)}</span>` : `<span class="muted small">${this._dirty ? "You have unsaved changes" : "Everything is saved"}</span>`}
        <div class="row"><button type="button" class="btn ghost" data-act="discard"${this._dirty ? "" : " disabled"}>Discard</button>
        <button type="button" class="btn primary" data-act="saveSettings"${admin ? "" : " disabled"}>${this._ui.saving ? '<span class="spin"></span>Saving…' : '<ha-icon icon="mdi:content-save-outline"></ha-icon>Save changes'}</button></div></div>`}
      ${this._ui.saveYaml ? `<div class="glass panel stack"><p class="muted">Copy these settings into the dashboard's raw configuration editor, replacing its <code>glasshome:</code> section:</p><textarea readonly data-k="yaml">${esc(this._yaml())}</textarea>
        <div class="row"><button type="button" class="btn" data-act="copyYaml"><ha-icon icon="mdi:content-copy"></ha-icon>Copy</button></div></div>` : ""}</div></div>`;
  }
  _importHtml() {
    const u = this._ui;
    return `<div class="row"><label class="btn" style="cursor:pointer"><ha-icon icon="mdi:file-upload-outline"></ha-icon>Choose a settings file<input type="file" accept="application/json,.json" class="vh" aria-label="Choose a settings file" data-k="import"></label></div>
        ${u.importErr ? `<div class="note bad">${esc(u.importErr)}</div>` : ""}
        ${u.importCfg ? `<div class="note">Found settings for ${esc((u.importCfg.household && u.importCfg.household.name) || "a home")} with ${(u.importCfg.rooms || []).length} rooms. <button type="button" class="btn sm primary" data-act="importApply">Use these</button></div>` : ""}`;
  }
  _advancedHtml() {
    const u = this._ui, diag = this._diag();
    return `<div><h1 id="ghs-h" tabindex="-1">Advanced</h1><p class="lead">Back up, move or reset your Glass Home settings.</p></div>
    <div class="grid2">
      <div class="feat"><h3>Export settings</h3><p class="muted">A file with everything set up here. It lists your devices and your weather place, so keep it private. Your Home Assistant backups include these settings too.</p>
        <div class="row"><button type="button" class="btn" data-act="export" data-format="json"><ha-icon icon="mdi:download"></ha-icon>Export (JSON)</button><button type="button" class="btn" data-act="export" data-format="yaml"><ha-icon icon="mdi:code-braces"></ha-icon>As YAML</button></div></div>
      <div class="feat"><h3>Import settings</h3><p class="muted">Load a JSON file made by Export (JSON). You'll see the result before anything is saved.</p>
        ${this._importHtml()}</div>
      <div class="feat"><h3>Run the setup wizard again</h3><p class="muted">Walk through every step with your current settings filled in. Nothing changes until you save at the end.</p>
        <div class="row"><button type="button" class="btn" data-act="rerun"><ha-icon icon="mdi:restart"></ha-icon>Open the wizard</button></div></div>
      ${GH_DEMO ? `<div class="feat"><h3>Reset the demo</h3><p class="muted">The demo's devices live only in your browser and start fresh each visit. This also ends an "Explore the demo" session in this tab.</p>
        <div class="row"><button type="button" class="btn" data-act="resetDemo"><ha-icon icon="mdi:backup-restore"></ha-icon>Reset demo</button></div></div>` : ""}
      <div class="feat" style="grid-column:1/-1"><h3>Clear all Glass Home settings</h3><p class="muted">Removes this dashboard's Glass Home settings and opens the welcome screen. Your devices, Home Assistant and other dashboards are not touched. Export first if you might want them back.</p>
        ${u.confirmClear ? `<div class="note bad row between" role="alertdialog" aria-label="Confirm clearing the settings"><span>Clear every Glass Home setting on this dashboard?</span><span class="row"><button type="button" class="btn sm" data-act="clearCancel">Cancel</button><button type="button" class="btn sm danger" data-act="clearDo"${this._ui.saving ? " disabled" : ""}>Yes, clear them</button></span></div>`
          : `<div class="row"><button type="button" class="btn danger" data-act="clearAsk"><ha-icon icon="mdi:delete-sweep-outline"></ha-icon>Clear settings…</button></div>`}</div>
    </div>
    <div class="feat"><div class="row between"><h3>Troubleshooting</h3><button type="button" class="btn sm" data-act="copyDiag"><ha-icon icon="mdi:content-copy"></ha-icon>Copy diagnostics</button></div>
      <div class="sum">${[["Glass Home", diag.glasshome], ["Home Assistant", diag.home_assistant], ["Dashboard", `/${diag.dashboard}`], ["Settings", diag.settings_found ? (diag.setup_complete ? "Saved, setup complete" : "Saved") : "None yet"],
        ["Weather", diag.weather], ["Devices found", String(diag.devices_found)], ["card-mod", diag.card_mod ? "Installed" : "Missing (needed for the glass styling)"], ["Missing entities", diag.missing_entities.length ? diag.missing_entities.slice(0, 6).join(", ") + (diag.missing_entities.length > 6 ? ` +${diag.missing_entities.length - 6}` : "") : "None"]]
        .map(([l, v]) => `<div>${esc(l)}<b>${esc(v)}</b></div>`).join("")}</div>
      <p class="muted small">The diagnostics never include your weather place, names or network addresses. The setup checklist (<button type="button" class="btn sm" data-act="nav" data-path="${ghBase()}/setup">Open checklist</button>) shows what each part still needs.</p></div>`;
  }
}
const GHS_CONDITION = { "clear-night": "Clear", cloudy: "Cloudy", exceptional: "Unusual weather", fog: "Fog", hail: "Hail", lightning: "Thunder", "lightning-rainy": "Thunderstorms",
  partlycloudy: "Partly cloudy", pouring: "Heavy rain", rainy: "Rain", snowy: "Snow", "snowy-rainy": "Sleet", sunny: "Sunny", windy: "Windy", "windy-variant": "Windy" };
const WEATHER_ICON_OF = (c) => ({ "clear-night": "mdi:weather-night", cloudy: "mdi:weather-cloudy", fog: "mdi:weather-fog", hail: "mdi:weather-hail", lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy", partlycloudy: "mdi:weather-partly-cloudy", pouring: "mdi:weather-pouring", rainy: "mdi:weather-rainy", snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy", sunny: "mdi:weather-sunny", windy: "mdi:weather-windy" }[c] || "mdi:weather-partly-cloudy");

class GlassHomeWizardCard extends GlassHomeSetupBase {}
class GlassHomeSettingsCard extends GlassHomeSetupBase { constructor() { super(); this._mode = "settings"; } }
if (LG_SHEET) [GlassHomeWizardCard, GlassHomeSettingsCard].forEach((C) => {
  C.prototype.attachShadow = function (init) {
    const root = HTMLElement.prototype.attachShadow.call(this, init);
    try { root.adoptedStyleSheets = [...root.adoptedStyleSheets, LG_SHEET]; } catch (e) { /* older browser */ }
    return root;
  };
});
customElements.define("glasshome-wizard-card", GlassHomeWizardCard);
customElements.define("glasshome-settings-card", GlassHomeSettingsCard);
window.customCards.push(
  { type: "glasshome-wizard-card", name: "Glass Home Setup Wizard", description: "First-time setup: you, weather, devices, rooms and features." },
  { type: "glasshome-settings-card", name: "Glass Home Settings", description: "Change the Glass Home settings after setup." },
);


// ================================================================== Settings: bins, energy, Spotify, floor plan, guides
// Step-by-step help for every connection that needs an account, a key or an app. Keys and passwords are
// always typed into Home Assistant's own setup, never into Glass Home.
const GHS_GUIDES = [
  { id: "spotify", title: "Spotify", icon: "mdi:spotify", domain: "spotify", docs: "https://www.home-assistant.io/integrations/spotify/",
    need: "Spotify Premium (needed to control playback), and about 10 minutes.",
    steps: [
      "Go to developer.spotify.com, sign in with your Spotify account and open the Dashboard.",
      "Create an app. Any name and description will do. Add this Redirect URI exactly: https://my.home-assistant.io/redirect/oauth, tick Web API, and save.",
      "Open the app's Settings and copy its Client ID and Client secret.",
      "In Home Assistant, press Connect Spotify below (or Settings, Devices & services, Add integration, Spotify). When it asks for application credentials, paste the Client ID and Client secret.",
      "Sign in to Spotify in the window that opens and allow access.",
      "Back here, open Media and music, choose Spotify, then choose the account and the speaker or TV music should play on.",
    ],
    note: "Spotify only allows a small number of people to use an app in development mode: add the Spotify email of anyone else in the house under User Management in the app's settings. The Client secret stays in Home Assistant." },
  { id: "apple_music", title: "Apple Music", icon: "mdi:apple", docs: "https://www.home-assistant.io/integrations/music_assistant/",
    need: "An Apple Music subscription. Home Assistant has no Apple Music integration of its own, and Apple offers no way to control Apple Music directly from it, so one of the two routes below is needed.",
    steps: [
      "Route 1, Music Assistant (your playlists, played on your speakers): in Home Assistant go to Settings, Apps (Add-ons), App store, install Music Assistant Server and start it. Home Assistant then offers the Music Assistant integration: press Add.",
      "Open Music Assistant (in the sidebar), go to Settings, Music providers, add Apple Music and sign in with your Apple Account as it asks. Check the Music Assistant documentation for the provider's current status and limits.",
      "Still in Music Assistant, add your speakers under Player providers (for example AirPlay, Google Cast or Sonos). Each speaker appears in Home Assistant as a media player.",
      "Route 2, Apple TV or HomePod (shows and controls what is playing, but no playlists): add Home Assistant's Apple TV integration and follow its pairing steps.",
      "Back here, open Media and music, choose Apple Music and pick the speaker (Music Assistant) or the Apple TV / HomePod (route 2).",
    ],
    note: "Your Apple Account is entered in Music Assistant's own sign-in, never in Glass Home. The Media page is called \"Apple Music\" once it's set up; you can rename it in Appearance." },
  { id: "music_assistant", title: "Music Assistant (YouTube Music, Tidal, Deezer and more)", icon: "mdi:music-box-multiple-outline", docs: "https://music-assistant.io/",
    need: "Home Assistant with the Apps (Add-ons) store, or a Music Assistant server you already run, and an account with the music service you want.",
    steps: [
      "In Home Assistant go to Settings, Apps (Add-ons), App store, install Music Assistant Server and start it.",
      "Home Assistant finds it: go to Settings, Devices & services and add the Music Assistant integration (or press Add Music Assistant below).",
      "Open Music Assistant from the sidebar. Under Settings, Music providers, add your service (for example YouTube Music, Tidal, Deezer, Qobuz, SoundCloud, Plex, Jellyfin, radio or local files) and sign in as it asks.",
      "Under Settings, Player providers, add the speakers you want to play on. Each one becomes a media player in Home Assistant.",
      "Back here, open Media and music, choose Music Assistant and pick the speaker.",
    ],
    note: "Sign-ins and keys for the music service stay in Music Assistant. Which services work, and whether they need a paid plan, is up to Music Assistant and the service." },
  { id: "music_other", title: "Any other music player", icon: "mdi:music", docs: "https://www.home-assistant.io/integrations/#media-player",
    need: "A speaker or music app that already works in Home Assistant as a media player (for example Sonos, Plex, Jellyfin, Squeezebox, Bluesound or a Google Cast speaker).",
    steps: [
      "Add the player's integration in Home Assistant: Settings, Devices & services, Add integration, then search for the brand. Follow its own sign-in or pairing steps.",
      "Check that it shows what is playing in Home Assistant (Settings, Devices & services, Entities, search for media_player).",
      "Back here, open Media and music, choose Other music player and pick it.",
    ],
    note: "Playlists appear only if the integration lets Home Assistant browse its music; otherwise you still get what's playing and the controls." },
  { id: "octopus", title: "Octopus Energy", icon: "mdi:octagon-outline", docs: "https://bottlecapdave.github.io/HomeAssistant-OctopusEnergy/",
    need: "An Octopus Energy account with a smart meter, and HACS (the Home Assistant Community Store) installed.",
    steps: [
      "In HACS, search for Octopus Energy, download it, then restart Home Assistant.",
      "In your Octopus account online, open Personal details, then API access, and copy your API key. Note your account number (it starts with A-).",
      "In Home Assistant, add the Octopus Energy integration and paste the API key and account number.",
      "Optional: an Octopus Home Mini gives a live reading about once a minute; without one, readings arrive later in the day.",
      "Back here, open Energy and choose Octopus Energy. Glass Home finds its sensors by itself.",
    ],
    note: "The API key is kept by the Octopus Energy integration in Home Assistant, never by Glass Home." },
  { id: "glow", title: "Any UK smart meter (Hildebrand Glow)", icon: "mdi:meter-electric-outline", docs: "https://glowmarkt.com/",
    need: "A smart meter from any UK supplier (British Gas, EDF, E.ON Next, OVO, Scottish Power and others), and HACS.",
    steps: [
      "Install the free Bright app by Hildebrand and sign up with your address and meter details. It can take a day or two before it shows readings.",
      "In HACS, search for Hildebrand Glow (DCC), download it, then restart Home Assistant.",
      "Add the Hildebrand Glow (DCC) integration and sign in with your Bright account.",
      "Back here, open Energy, choose Smart meter through Hildebrand Glow, and press Suggest meters.",
    ],
    note: "Readings from the smart meter network usually arrive about half an hour late. For a live reading, a Glow display (IHD) or a clamp meter on your electricity supply can send it to Home Assistant directly." },
  { id: "meters", title: "Clamp meters and smart plugs", icon: "mdi:current-ac", docs: "https://www.home-assistant.io/docs/energy/electricity-grid/",
    need: "A device that measures your whole home's use, such as a Shelly EM or Pro 3EM clamp, or smart plugs for single appliances.",
    steps: [
      "Fit the clamp (an electrician should fit anything inside the consumer unit), then add its integration in Home Assistant. Shelly devices are usually found by themselves.",
      "Back here, open Energy, choose Choose the sensors myself, and pick its power and energy sensors.",
      "Glass Home works out today's use from the meter's total, so you don't need any extra helpers.",
    ] },
  { id: "energy_dash", title: "Home Assistant's Energy dashboard", icon: "mdi:chart-donut", docs: "https://www.home-assistant.io/docs/energy/",
    need: "Meters already chosen in Home Assistant's own Energy dashboard.",
    steps: [
      "In Home Assistant, open Settings, Dashboards, Energy, and add your grid consumption (and gas) meters if you haven't already.",
      "Back here, open Energy, choose My Home Assistant Energy dashboard, and press Use my Energy dashboard meters.",
      "Add a live power sensor if you have one, for the reading on the home screen.",
    ] },
  { id: "cameras", title: "Cameras", icon: "mdi:cctv", docs: "https://www.home-assistant.io/integrations/#camera",
    need: "Cameras Home Assistant can reach. Most cameras that offer an RTSP stream or ONVIF work.",
    steps: [
      "Cameras with their own integration: Reolink, UniFi Protect, Ring, Blink, Google Nest and others. Add them from Settings, Devices & services. Ring and Blink sign in to their cloud. Google Nest needs Google's Device Access, which has a one-off fee charged by Google.",
      "Most other IP cameras: add the ONVIF integration. It finds the camera and asks for the camera's own user name and password.",
      "Cameras with only a stream address: add Generic Camera and paste the RTSP address from the camera's app or manual (it often looks like rtsp://camera-address:554/stream1).", // glasshome-validate: allow (a made-up example address)
      "Back here, open Dashboard features, switch on Cameras and security, and choose which cameras to show.",
    ],
    note: "Camera passwords are kept by Home Assistant. Glass Home shows the picture Home Assistant gives it and never sees the password." },
  { id: "bins", title: "Bin collection calendars", icon: "mdi:delete-variant", docs: "https://www.home-assistant.io/integrations/remote_calendar/",
    need: "Your council's collection dates.",
    steps: [
      "Find your council's bin day page and enter your postcode. Look for Add to calendar, Download calendar, iCal or .ics.",
      "Easiest: download the file and upload it in Bin collections, Council calendar file.",
      "Always up to date: if the council gives a calendar web address, add Home Assistant's Remote calendar integration with that address, then choose it in Bin collections, Home Assistant calendar. The Waste Collection Schedule integration (HACS) does the same for hundreds of councils.",
      "Only a PDF or a web page? Copy the dates and paste them in, or type them in.",
    ] },
  { id: "weather", title: "Weather", icon: "mdi:weather-partly-cloudy", docs: "https://open-meteo.com/",
    need: "Nothing: the built-in weather needs no account or key.",
    steps: ["Open Location and weather and search for your town. Or choose a weather integration you already have in Home Assistant, such as Met.no."] },
  { id: "news", title: "News", icon: "mdi:newspaper-variant-outline", docs: "",
    need: "The Glass Home News integration, which comes with Glass Home.",
    steps: ["Copy custom_components/glasshome_news into Home Assistant's config folder and restart.", "Add the Glass Home News integration. It has no options.", "Switch on News in Dashboard features."] },
  { id: "tv", title: "TV power button", icon: "mdi:television", domain: "androidtv_remote", docs: "https://www.home-assistant.io/integrations/androidtv_remote/",
    need: "An Android or Google TV with Wake-on-LAN, and the TV power package from Glass Home.",
    steps: ["Add the Android TV Remote integration and enter the code the TV shows.", "Copy packages/glasshome_tv_power.yaml into your packages folder and put the TV's network details in secrets.yaml (see the install guide).", "Switch on the TV power button in Dashboard features."] },
];

Object.assign(GlassHomeSetupBase.prototype, {
  // ---------------------------------------------------------------- shared pieces
  _intDomains() { return new Set(((this._ints && this._ints.entries) || []).map((e) => e.domain)); },
  _addBtn(domain, label) {
    const admin = !!(this._hass.user && this._hass.user.is_admin);
    return `<button type="button" class="btn sm" data-act="nav" data-path="/_my_redirect/config_flow_start?domain=${esc(domain)}"${admin ? "" : " disabled"}><ha-icon icon="mdi:open-in-new"></ha-icon>${esc(label)}</button>`;
  },
  _guideHtml(g, open) {
    const ints = this._intDomains();
    return `<details class="guide" id="guide-${g.id}"${open ? " open" : ""}><summary><ha-icon icon="${g.icon}"></ha-icon><b>${esc(g.title)}</b>${g.domain && ints.has(g.domain) ? '<span class="tag ok">Added to Home Assistant</span>' : ""}</summary>
        <div class="stack" style="gap:10px;margin-top:10px"><p style="margin:0"><b>You need:</b> ${esc(g.need)}</p>
        <ol>${g.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>${g.note ? `<p class="muted" style="margin:0">${esc(g.note)}</p>` : ""}
        <div class="row">${g.domain ? this._addBtn(g.domain, `Open ${g.title} setup in Home Assistant`) : ""}${g.docs ? `<a class="btn sm ghost" href="${esc(g.docs)}" target="_blank" rel="noopener noreferrer"><ha-icon icon="mdi:open-in-new"></ha-icon>Full instructions</a>` : ""}</div></div></details>`;
  },
  _guideBtn(id, label = "How to set this up") {
    const g = GHS_GUIDES.find((x) => x.id === id);
    if (this._mode === "wizard" && g && this._ui.guideInline === id) return `<div style="flex:1 1 100%">${this._guideHtml(g, true)}</div>`;
    return `<button type="button" class="btn sm ghost" data-act="guide" data-guide="${esc(id)}"><ha-icon icon="mdi:book-open-variant"></ha-icon>${esc(label)}</button>`; },
  _value(id) {
    const s = id && this._hass.states[id];
    if (!s) return "";
    const u = s.attributes.unit_of_measurement || "";
    return ["unknown", "unavailable"].includes(s.state) ? s.state : `${s.state}${u ? ` ${u}` : ""}`;
  },
  _binDot(id) { const c = GHS_BIN_COLOURS[id]; return c ? `<span class="bindot" style="--c:${c.main};--l:${c.lid}" title="${esc(c.name)}"></span>` : ""; },

  // ---------------------------------------------------------------- bins
  _step_bins() {
    const B = this._d.choices.bins, sch = this._binPreview();
    const status = sch.length ? `<span class="tag ok">Next: ${esc(this._binDay(sch[0][0]))}</span>` : this._ui.binCalLoading || (B.source === "calendar" && B.calendar && !this._ui.binCal) ? `<span class="tag">Reading the calendar…</span>` : `<span class="tag warn">No collections yet</span>`;
    return `<div><h1 id="ghs-h" tabindex="-1">Bin collections</h1><p class="lead">Bring in your council's collection days, so the reminder the evening before and the bin tile on the home screen are always right.</p></div>
      ${this._feat("bins", "mdi:delete-variant", "Bin day reminders", "A banner the evening before collection, and the next collection on the home screen.", { status })}
      ${this._binsHtml()}`;
  },
  _binDay(iso) { return new Date(`${iso}T12:00:00Z`).toLocaleDateString(GH_LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }); },
  _binEvents() {
    const B = this._d.choices.bins, src = B.source || (B.start ? "rotation" : "");
    if (src === "calendar") return (this._ui.binCal && this._ui.binCal.events) || [];
    return B.events || [];
  },
  // The next collections from what is chosen now (before saving)
  _binPreview() {
    const B = this._d.choices.bins, src = B.source || (B.start ? "rotation" : ""), today = ghsToday(this._d.household.timezone || GH_TZ);
    let sch = {};
    if (src === "rotation" && /^\d{4}-\d{2}-\d{2}$/.test(B.start || "")) {
      const pat = ghsBinPattern(B.pattern), step = Math.max(1, Number(B.every_days) || 7);
      for (let i = 0, d = B.start; i < 400 && pat.length; i++, d = ghsAddDays(d, step)) sch[d] = pat[i % pat.length];
    } else sch = ghsBinsSchedule(this._binEvents(), B.map || {});
    return Object.entries(sch).filter(([d]) => d >= today).sort((a, b) => a[0].localeCompare(b[0]));
  },
  _binsHtml() {
    const B = this._d.choices.bins, src = B.source || (B.start ? "rotation" : ""), u = this._ui;
    const srcs = [["file", "Council calendar file", "mdi:file-upload-outline"], ["calendar", "Home Assistant calendar", "mdi:calendar-sync"],
      ["dates", "Type the dates", "mdi:calendar-edit"], ["rotation", "Repeating pattern", "mdi:calendar-refresh"]];
    let body = "";
    if (src === "file") {
      body = `<div class="stack"><p class="muted" style="margin:0">On your council's bin day page, enter your postcode and look for <b>Add to calendar</b>, <b>Download calendar</b>, <b>iCal</b> or <b>.ics</b>. A spreadsheet saved as CSV works too.</p>
        <div class="row"><label class="btn primary" style="cursor:pointer"><ha-icon icon="mdi:upload"></ha-icon>Upload the file<input type="file" accept=".ics,.ical,.ifb,.csv,.txt,text/calendar,text/csv,text/plain" data-act="binFile" class="vh" aria-label="Council collection calendar file"></label>
        ${B.file ? `<span class="tag ok">${esc(B.file)} · ${(B.events || []).length} collections</span>` : ""}</div>
        <details${u.binPasteOpen ? " open" : ""}><summary>Only have a PDF or a web page? Paste the dates instead</summary>
          <div class="stack" style="margin-top:8px"><textarea data-ui="binPaste" aria-label="Collection dates, one per line" placeholder="Friday 20 November 2026 - Recycling&#10;27/11/2026, General waste">${esc(u.binPaste || "")}</textarea>
          <div class="row"><button type="button" class="btn sm" data-act="binPaste">Read these dates</button>
          <button type="button" class="chip" data-act="binMonthFirst" aria-pressed="${!!u.binMonthFirst}">Dates are written month first (11/20/2026)</button></div></div></details>
        ${u.binErr ? `<div class="note bad" role="alert">${esc(u.binErr)}</div>` : ""}</div>`;
    } else if (src === "calendar") {
      const cals = this._ofDomain("calendar");
      // a chosen calendar is read straight away (and again when another one is chosen), so its dates and bins show without a button
      if (B.calendar && (!u.binCal || u.binCal.cal !== B.calendar) && !u.binCalLoading) setTimeout(() => this._binCalRead(), 0);
      body = `<div class="stack"><p class="muted" style="margin:0">A calendar in Home Assistant that holds your collections, kept up to date for you: the <b>Remote calendar</b> integration with your council's calendar address, or the <b>Waste Collection Schedule</b> integration from HACS.</p>
        <div class="grid2"><label class="f">Calendar${this._select("choices.bins.calendar", cals, B.calendar, cals.length ? "Choose a calendar" : "No calendars in Home Assistant")}</label>
        <div class="f"><span>&nbsp;</span><div class="row"><button type="button" class="btn sm" data-act="binCalRead"${B.calendar ? "" : " disabled"}>${u.binCalLoading ? '<span class="spin"></span>Reading…' : "Read the calendar"}</button>${this._addBtn("remote_calendar", "Add Remote calendar")}</div></div></div>
        ${u.binCal && u.binCal.error ? `<div class="note bad" role="alert">${esc(u.binCal.error)}</div>` : ""}
        ${B.calendar && !u.binCal ? `<p class="muted small" style="margin:0">Reading the calendar…</p>` : ""}</div>`;
    } else if (src === "dates") {
      const ev = (B.events || []).map((e, i) => ({ ...e, i })).sort((a, b) => a.date.localeCompare(b.date));
      body = `<div class="stack"><div class="grid2"><label class="f">Collection date<input type="date" data-act="binDateSet" value="${esc(u.binDate || "")}"></label>
        <div class="f"><span>Bins collected</span><div class="row">${Object.keys(GHS_BIN_COLOURS).map((c) => `<button type="button" class="chip" data-act="binDateCol" data-c="${c}" aria-pressed="${(u.binDateCols || []).includes(c)}">${this._binDot(c)}${esc(GHS_BIN_COLOURS[c].short)}</button>`).join("")}</div></div></div>
        <div class="row"><button type="button" class="btn sm primary" data-act="binAddDate"${u.binDate && (u.binDateCols || []).length ? "" : " disabled"}><ha-icon icon="mdi:plus"></ha-icon>Add collection</button></div>
        ${ev.length ? `<div class="stack" style="gap:6px">${ev.map((e) => `<div class="item"><div class="tx"><div class="n">${esc(this._binDay(e.date))}</div><div class="s">${(B.map[ghsBinKey(e.summary)] || ghsBinGuess(e.summary)).map((c) => this._binDot(c) + esc(GHS_BIN_COLOURS[c] ? GHS_BIN_COLOURS[c].short : c)).join(" ")}</div></div><button type="button" class="iconbtn" data-act="binDelDate" data-i="${e.i}" aria-label="Remove ${esc(this._binDay(e.date))}"><ha-icon icon="mdi:close"></ha-icon></button></div>`).join("")}</div>` : `<p class="muted" style="margin:0">No dates yet.</p>`}</div>`;
    } else if (src === "rotation") {
      const C = this._d.choices;
      body = `<div class="grid2"><label class="f">First collection date<input type="date" data-bind="choices.bins.start" data-k="binstart" value="${esc(C.bins.start || "")}"></label>
          <label class="f">Every how many days<input type="number" min="1" max="28" data-bind="choices.bins.every_days" data-k="binevery" value="${esc(String(C.bins.every_days || 7))}"></label>
          <label class="f" style="grid-column:1/-1">Which bins, collection by collection<input type="text" data-bind="choices.bins.pattern" data-k="binpat" value="${esc(C.bins.pattern || "")}" placeholder="grey | blue, green">
          <span class="muted small">Separate collections with |, and bins on the same day with commas. Colours: ${Object.keys(GHS_BIN_COLOURS).join(", ")}. The pattern repeats. Bank holiday changes aren't included: a council calendar is more accurate.</span></label></div>`;
    }
    // what each entry in the calendar means
    let map = "";
    if (src === "file" || src === "calendar") {
      const sums = ghsBinSummaries(this._binEvents(), B.map || {});
      if (sums.length) map = `<div class="stack" style="gap:8px"><h2>What each entry means</h2><p class="muted" style="margin:0">Glass Home guessed the bins from the words in each entry. Tap the colours to correct them.</p>
        ${sums.map((s) => `<div class="item binmap"><div class="tx"><div class="n">${esc(s.label)}</div><div class="s">${s.count} collection${s.count === 1 ? "" : "s"}${s.bins.length ? "" : " · not shown until you choose a bin"}</div></div>
          <div class="row" role="group" aria-label="Bins for ${esc(s.label)}">${Object.keys(GHS_BIN_COLOURS).map((c) => `<button type="button" class="chip sm" data-act="binMap" data-key="${esc(s.key)}" data-c="${c}" aria-pressed="${s.bins.includes(c)}" aria-label="${esc(GHS_BIN_COLOURS[c].name)}" title="${esc(GHS_BIN_COLOURS[c].name)}">${this._binDot(c)}</button>`).join("")}</div></div>`).join("")}</div>`;
    }
    // names for the bins in use
    const prev = this._binPreview(), used = [...new Set(prev.flatMap(([, ids]) => ids))];
    const names = used.length ? `<div class="stack" style="gap:8px"><h2>Your bins</h2><div class="grid2">${used.map((id) => {
      const c = GHS_BIN_COLOURS[id] || {}, l = B.labels[id] || {};
      return `<div class="item" style="align-items:flex-start">${this._binDot(id)}<div class="tx stack" style="gap:6px"><label class="f">Name<input type="text" data-binlabel="${id}" data-f="name" value="${esc(l.name || c.name || id)}" maxlength="40"></label>
        <label class="f">What goes in it<input type="text" data-binlabel="${id}" data-f="waste" value="${esc(l.waste || c.waste || "")}" maxlength="40"></label></div></div>`;
    }).join("")}</div></div>` : "";
    const next = prev.length ? `<div class="stack" style="gap:8px"><h2>Next collections</h2><div class="grid3">${prev.slice(0, 6).map(([d, ids]) => `<div class="item"><div class="tx"><div class="n">${esc(this._binDay(d))}</div><div class="s">${ids.map((id) => this._binDot(id) + esc((B.labels[id] && B.labels[id].name) || (GHS_BIN_COLOURS[id] || {}).name || id)).join(" ")}</div></div></div>`).join("")}</div></div>` : "";
    const hours = [16, 17, 18, 19, 20, 21].map((h) => `<option value="${h}"${Number(B.reminder_hour ?? 18) === h ? " selected" : ""}>${h > 12 ? h - 12 : h} pm</option>`).join("");
    return `<div class="stack"><h2>Where your dates come from</h2><div class="grid2">${srcs.map(([id, l, ic]) => `<button type="button" class="opt" data-act="binSource" data-v="${id}" aria-pressed="${src === id}"><ha-icon icon="${ic}"></ha-icon>${esc(l)}</button>`).join("")}</div>
      ${body}${map}${names}${next}
      <label class="f" style="max-width:280px">Remind me the evening before, from<select data-bind="choices.bins.reminder_hour" data-k="binhour">${hours}</select></label>
      <div class="row">${this._guideBtn("bins", "Help finding my council's calendar")}</div></div>`;
  },
  async _binFile(input) {
    const f = input.files && input.files[0];
    input.value = "";
    if (!f) return;
    const B = this._d.choices.bins;
    this._ui.binErr = "";
    try {
      if (f.size > 3e6) throw new Error("That file is too big for a bin calendar. Check it's the right file.");
      if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") throw new Error("PDF calendars can't be read. Copy the dates from it and paste them below, or type them in.");
      const text = await f.text(), tz = this._d.household.timezone || GH_TZ;
      const r = /BEGIN:VCALENDAR/i.test(text) ? ghsParseIcs(text, { tz }) : ghsParseCsv(text, { tz, monthFirst: !!this._ui.binMonthFirst });
      if (!r.events.length) throw new Error("No upcoming collection dates were found in that file. Check it's for the coming months, or paste the dates instead.");
      Object.assign(B, { source: "file", events: r.events, file: f.name.slice(0, 80), map: {} });
      this._d.features.bins = true;
      ghToast(`${r.events.length} collections found`);
    } catch (e) { this._ui.binErr = e.message; }
    this._persist();
    this._render();
  },
  async _binCalRead() {
    const B = this._d.choices.bins;
    if (!B.calendar || this._ui.binCalLoading) return;
    const cal = B.calendar;
    this._ui.binCalLoading = true; this._render();
    const start = ghsToday(this._d.household.timezone || GH_TZ), end = ghsAddDays(start, 120);
    try {
      const evs = await this._hass.callApi("GET", `calendars/${B.calendar}?start=${encodeURIComponent(`${start}T00:00:00`)}&end=${encodeURIComponent(`${end}T23:59:59`)}`);
      const events = (Array.isArray(evs) ? evs : []).map((e) => ({ date: String((e.start && (e.start.date || e.start.dateTime)) || "").slice(0, 10), summary: e.summary || "" })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
      this._ui.binCal = { cal, events, error: events.length ? "" : "That calendar has nothing in the next four months." };
      const keys = new Set(events.map((e) => ghsBinKey(e.summary)));
      if (events.length) { B.map = Object.fromEntries(Object.entries(B.map || {}).filter(([k]) => keys.has(k))); this._persist(); }
    } catch (e) { this._ui.binCal = { cal, events: [], error: `The calendar couldn't be read: ${(e && (e.body && e.body.message || e.message)) || e}` }; }
    this._ui.binCalLoading = false;
    this._render();
  },

  // ---------------------------------------------------------------- energy
  _enSensors(kind) {
    const S = this._hass.states;
    return Object.keys(S).filter((id) => id.startsWith("sensor.") && !id.startsWith("sensor.glasshome_") && !id.startsWith("sensor.demo_")).filter((id) => {
      const a = S[id].attributes || {}, u = String(a.unit_of_measurement || ""), dc = a.device_class;
      if (kind === "power") return dc === "power" || /^k?W$/.test(u);
      if (kind === "energy") return dc === "energy" || /^[kM]?Wh$/.test(u);
      if (kind === "meter") return (dc === "energy" || /^[kM]?Wh$/.test(u)) && ["total_increasing", "total"].includes(a.state_class);
      if (kind === "cost") return dc === "monetary" || /^(£|GBP|EUR|€|\$|USD)$/.test(u);
      if (kind === "rate") return /\/\s*kWh$/.test(u);
      return false;
    }).sort((a, b) => this._stateName(a).localeCompare(this._stateName(b)));
  },
  _step_energy() {
    const E = this._d.choices.energy, oct = ghsDetectEnergy(this._hass.states);
    const m = E.method || (oct ? "octopus" : "");
    const en = m === "octopus" ? oct : m && m !== "keep" ? ghsEnergyFromMap(E) : null;
    const status = m === "keep" ? `<span class="tag acc">Using settings written by hand</span>` : en ? `<span class="tag ok">Ready${en.gas ? ": electricity and gas" : ": electricity"}</span>` : `<span class="tag warn">Choose how to connect below</span>`;
    return `<div><h1 id="ghs-h" tabindex="-1">Energy</h1><p class="lead">Connect your energy supplier's smart meter, or any meter Home Assistant can read, for live use, today's cost and history on the Energy page.</p></div>
      ${this._feat("energy", "mdi:lightning-bolt", "Energy page", "Live use, today's use and cost, history and appliances.", { status, can: !!en || m === "keep" })}
      ${this._energyHtml()}`;
  },
  _energyHtml() {
    const E = this._d.choices.energy, S = this._hass.states, oct = ghsDetectEnergy(S), u = this._ui;
    const m = E.method || (oct ? "octopus" : "");
    const sup = `<label class="f" style="max-width:420px">Who supplies your energy?<select data-act="enSupplier" data-k="ensupplier"><option value="">Choose your supplier</option>${GHS_SUPPLIERS.map(([id, name]) => `<option value="${id}"${E.supplier === id ? " selected" : ""}>${esc(name)}</option>`).join("")}</select></label>`;
    const methods = `<div class="grid2">${Object.entries(GHS_ENERGY_METHODS).map(([id, x]) => `<button type="button" class="opt left" data-act="enMethod" data-v="${id}" aria-pressed="${m === id}"><span class="stack" style="gap:3px;text-align:left"><b>${esc(x.name)}</b><span class="muted small">${esc(x.detail)}</span></span></button>`).join("")}</div>`;
    let body = "";
    if (m === "octopus") {
      body = oct ? `<div class="note">Octopus Energy found: live demand ${esc(this._value(oct.electricity.demand) || "not available")}, today ${esc(this._value(oct.electricity.today_kwh) || "–")}${oct.gas ? `, gas today ${esc(this._value(oct.gas.today_kwh) || "–")}` : ""}.</div>`
        : `<div class="note warn">The Octopus Energy integration isn't in Home Assistant yet. It's installed from HACS and needs your Octopus API key. ${this._guideBtn("octopus")}</div>`;
    } else if (m === "keep") {
      body = `<div class="note">Your energy settings were written by hand and are kept as they are. Choose a way to connect above to replace them.</div>`;
    } else if (m) {
      const sel = (path, kind, none, label) => `<label class="f">${esc(label)}${this._select(`choices.energy.${path}`, this._enSensors(kind), this._get(`choices.energy.${path}`), none)}${this._get(`choices.energy.${path}`) ? `<span class="muted small">Now: ${esc(this._value(this._get(`choices.energy.${path}`)))}</span>` : ""}</label>`;
      body = `<div class="row">${m === "ha_energy" ? `<button type="button" class="btn sm primary" data-act="enPrefs">${u.enLoading ? '<span class="spin"></span>' : '<ha-icon icon="mdi:chart-donut"></ha-icon>'}Use my Energy dashboard meters</button>` : `<button type="button" class="btn sm primary" data-act="enSuggest"><ha-icon icon="mdi:auto-fix"></ha-icon>Suggest meters</button>`}
          ${m === "glow" ? this._guideBtn("glow") : m === "other" ? this._guideBtn("meters") : this._guideBtn("energy_dash")}</div>
        ${u.enErr ? `<div class="note bad" role="alert">${esc(u.enErr)}</div>` : ""}
        <h2>Electricity</h2><div class="grid2">${sel("electricity.demand", "power", "No live reading", "Live use (watts)")}${sel("electricity.meter", "meter", "None", "Meter total (kWh, for today and history)")}
          ${sel("electricity.today_kwh", "energy", "Work it out from the meter", "Used today (kWh, optional)")}${sel("electricity.today_cost", "cost", "None", "Cost today (optional)")}
          ${sel("electricity.rate", "rate", "None", "Unit rate (optional)")}${sel("electricity.standing", "cost", "None", "Standing charge (optional)")}</div>
        <h2>Gas <span class="muted small">(optional)</span></h2><div class="grid2">${sel("gas.meter", "meter", "No gas", "Gas meter total (kWh)")}${sel("gas.today_kwh", "energy", "Work it out from the meter", "Gas used today (kWh, optional)")}
          ${sel("gas.today_cost", "cost", "None", "Gas cost today (optional)")}${sel("gas.rate", "rate", "None", "Gas unit rate (optional)")}</div>
        <p class="muted small" style="margin:0">Costs are shown in ${esc(this._d.household.currency || "GBP")} (${esc(ghsCurrencySymbol(this._d.household.currency || "GBP", this._d.household.locale || undefined))}), as chosen in Profile. A gas meter that reports cubic metres needs its kWh sensor (most integrations provide one).</p>`;
    }
    return `<div class="stack">${sup}<h2>How Home Assistant reads your meter</h2>${methods}${body}</div>`;
  },
  _enSuggest() {
    const E = this._d.choices.energy, reg = (this._reg && this._reg.entities) || {};
    const pick = (ids, re, not) => ids.find((id) => re.test(`${id} ${this._stateName(id)} ${(reg[id] || {}).platform || ""}`.toLowerCase()) && !(not && not.test(id))) || "";
    const glow = E.method === "glow" ? /glow|hildebrand/ : /./;
    const power = this._enSensors("power").filter((id) => glow.test(`${id} ${(reg[id] || {}).platform || ""}`));
    const meters = this._enSensors("meter").filter((id) => glow.test(`${id} ${(reg[id] || {}).platform || ""}`));
    const energy = this._enSensors("energy").filter((id) => glow.test(`${id} ${(reg[id] || {}).platform || ""}`));
    const costs = this._enSensors("cost").filter((id) => glow.test(`${id} ${(reg[id] || {}).platform || ""}`));
    const el = E.electricity = E.electricity || {}, g = E.gas = E.gas || {};
    el.demand = el.demand || pick(power, /electric|grid|import|house|home|demand|consumption|mains/, /solar|gas/) || power[0] || "";
    el.meter = el.meter || pick(meters, /electric|grid|import|consumption/, /gas|solar|export/) || meters.find((id) => !/gas|solar|export|feed/.test(`${id} ${this._stateName(id)}`.toLowerCase())) || "";
    el.today_kwh = el.today_kwh || pick(energy, /today|daily/, /gas|cost/) || "";
    el.today_cost = el.today_cost || pick(costs, /electric.*(today|daily)|(today|daily).*electric/, /gas/) || "";
    g.meter = g.meter || pick(meters, /gas/) || "";
    g.today_kwh = g.today_kwh || pick(energy, /gas.*(today|daily)|(today|daily).*gas/) || "";
    const found = [el.demand, el.meter, el.today_kwh, g.meter].filter(Boolean).length;
    this._ui.enErr = found ? "" : "No matching meters were found. Choose them from the lists below.";
    if (found) ghToast(`${found} meter${found === 1 ? "" : "s"} suggested: check they're right`);
    this._persist();
    this._render();
  },
  async _enPrefs() {
    const E = this._d.choices.energy;
    this._ui.enLoading = true; this._ui.enErr = ""; this._render();
    try {
      const p = ghsEnergyFromPrefs(await this._ws({ type: "energy/get_prefs" }));
      E.electricity = { ...(E.electricity || {}), ...Object.fromEntries(Object.entries(p.electricity).filter(([, v]) => v)) };
      E.gas = { ...(E.gas || {}), ...Object.fromEntries(Object.entries(p.gas).filter(([, v]) => v)) };
      if (!p.electricity.meter) this._ui.enErr = "Home Assistant's Energy dashboard has no electricity meter yet. Add one there (Settings, Dashboards, Energy), or choose the sensors below.";
    } catch (e) { this._ui.enErr = `The Energy dashboard couldn't be read: ${(e && e.message) || e}`; }
    this._ui.enLoading = false;
    this._persist();
    this._render();
  },

  // ---------------------------------------------------------------- media and Spotify
  _spotifyIds() {
    const reg = (this._reg && this._reg.entities) || {};
    return this._ofDomain("media_player").filter((id) => (reg[id] || {}).platform === "spotify" || /^media_player\.spotify/.test(id));
  },
  _step_media() {
    const C = this._d.choices, tvs = this._tvList(), remotes = this._ofDomain("remote");
    const sel = (bind, ids, none, label) => `<label class="f">${esc(label)}${this._select(bind, ids, this._get(bind), none)}</label>`;
    return `<div><h1 id="ghs-h" tabindex="-1">Media and music</h1><p class="lead">Your TV on the Media page, and your music service with what's playing and your playlists.</p></div>
      ${this._feat("media", "mdi:television-play", "TV and media", "TV state, volume and playback on the Media page.", {
        can: tvs.length > 0, status: tvs.length ? `<span class="tag ok">${tvs.length} media player${tvs.length === 1 ? "" : "s"} found</span>` : `<span class="tag warn">No media players in Home Assistant</span>`,
        body: `<div class="grid2">${sel("choices.tv", tvs, "Choose your TV", "TV")}${sel("choices.tv_remote", remotes, "None", "TV remote (Android TV Remote, optional)")}</div>` })}
      ${this._musicPickerHtml()}`;
  },
  // ---------------------------------------------------------------- music service
  _musicPickerHtml() {
    const C = this._d.choices, svc = C.music_service;
    const opts = [["spotify", "Spotify", "mdi:spotify", "Official integration"], ["apple_music", "Apple Music", "mdi:apple", "Through Music Assistant or Apple TV"],
      ["music_assistant", "Music Assistant", "mdi:music-box-multiple-outline", "YouTube Music, Tidal, Deezer…"], ["other", "Other music player", "mdi:music", "Sonos, Plex, Jellyfin…"], ["", "No music", "mdi:music-off", "Media page shows the TV only"]];
    const name = GHS_MUSIC[svc] ? GHS_MUSIC[svc].name : "";
    return `<div class="stack"><h2>Music service</h2><p class="muted" style="margin:0">Choose where your music comes from. The Media page then shows what's playing with your playlists underneath${name ? `, and is called <b>${esc(this._d.appearance.titles && this._d.appearance.titles.media ? this._d.appearance.titles.media : name)}</b> in the bottom bar (rename it in Appearance)` : ""}.</p>
      <div class="msvc">${opts.map(([v, l, ic, sub]) => `<button type="button" class="opt" data-act="musicService" data-v="${v}" aria-pressed="${svc === v}"><ha-icon icon="${ic}"></ha-icon><span>${esc(l)}<small>${esc(sub)}</small></span></button>`).join("")}</div></div>
      ${svc === "spotify" ? this._spotifyHtml() : GHS_MUSIC[svc] ? this._musicHtml(svc) : ""}`;
  },
  _musicPlayers(svc) {
    const reg = (this._reg && this._reg.entities) || {}, sp = this._spotifyIds();
    const plat = (id) => (reg[id] || {}).platform;
    const all = this._ofDomain("media_player").filter((id) => !sp.includes(id));
    if (svc === "music_assistant") return all.filter((id) => plat(id) === "music_assistant");
    if (svc === "apple_music") return all.filter((id) => ["music_assistant", "apple_tv"].includes(plat(id)));
    return all;
  },
  _musicHtml(svc) {
    const C = this._d.choices, m = GHS_MUSIC[svc], ints = this._intDomains(), players = this._musicPlayers(svc);
    const guide = svc === "other" ? "music_other" : svc;
    const added = svc === "apple_music" ? ints.has("music_assistant") || ints.has("apple_tv") : svc === "music_assistant" ? ints.has("music_assistant") : players.length > 0;
    const p = C.music_player && this._hass.states[C.music_player];
    const step = (n, done, title, body) => `<div class="item" style="align-items:flex-start"><div class="ic">${done ? '<ha-icon icon="mdi:check-bold"></ha-icon>' : n}</div><div class="tx stack" style="gap:8px"><div class="n">${esc(title)}</div>${body}</div></div>`;
    const status = p ? `<span class="tag ok">Plays on ${esc(this._stateName(C.music_player))}</span>` : added ? `<span class="tag warn">Choose the player below</span>` : `<span class="tag warn">Not set up in Home Assistant yet</span>`;
    const addBtns = svc === "apple_music" ? `${this._addBtn("music_assistant", "Add Music Assistant")}${this._addBtn("apple_tv", "Add Apple TV")}`
      : svc === "music_assistant" ? this._addBtn("music_assistant", "Add Music Assistant") : `<button type="button" class="btn sm" data-act="nav" data-path="/config/integrations/dashboard"><ha-icon icon="mdi:open-in-new"></ha-icon>Devices & services</button>`;
    return `${this._feat("music", m.icon, svc === "other" ? "Music player" : svc === "music_assistant" ? "Music Assistant" : m.name, "What's playing, your playlists and controls on the Media page.", { status, can: !!p })}
      <div class="stack"><h2>Connect ${esc(svc === "other" ? "your music player" : svc === "music_assistant" ? "Music Assistant" : m.name)}</h2>
      ${step(1, added, svc === "apple_music" ? "Connect Apple Music to Home Assistant" : svc === "music_assistant" ? "Add Music Assistant to Home Assistant" : "Add your player to Home Assistant",
        `<p class="muted" style="margin:0">${svc === "apple_music" ? "Home Assistant has no Apple Music integration of its own. Music Assistant plays your Apple Music playlists on your speakers; the Apple TV integration shows and controls what an Apple TV or HomePod plays." : svc === "music_assistant" ? "Music Assistant connects YouTube Music, Tidal, Deezer, Qobuz, SoundCloud, Plex, Jellyfin, radio and your own files, and plays them on your speakers." : "Any media player in Home Assistant works. Playlists show if its integration can browse music."}</p>
        <div class="row">${addBtns}${this._guideBtn(guide)}</div>`)}
      ${step(2, !!p, "Choose the player", players.length ? `<div style="max-width:420px">${this._select("choices.music_player", players, C.music_player, "Choose the player")}</div>${p ? `<span class="muted small">Now: ${esc(p.state)}${p.attributes.media_title ? ` · ${esc(p.attributes.media_title)}` : ""}</span>` : ""}`
        : `<span class="muted">${svc === "other" ? "No media players found in Home Assistant yet." : "No players from it yet. Add your speakers in Music Assistant (or pair the Apple TV), then come back."}</span>`)}
      </div>`;
  },
  _spotifyHtml() {
    const C = this._d.choices, ids = this._spotifyIds(), ints = this._intDomains(), u = this._ui;
    const connected = ids.length > 0, acct = C.spotify && this._hass.states[C.spotify];
    const sources = (acct && acct.attributes.source_list) || [];
    const step = (n, done, title, body) => `<div class="item" style="align-items:flex-start"><div class="ic">${done ? '<ha-icon icon="mdi:check-bold"></ha-icon>' : n}</div><div class="tx stack" style="gap:8px"><div class="n">${esc(title)}</div>${body}</div></div>`;
    const status = connected && C.spotify && C.spotify_device ? `<span class="tag ok">Connected: plays on ${esc(C.spotify_device)}</span>` : connected ? `<span class="tag warn">Choose the account and speaker below</span>` : `<span class="tag warn">Not connected yet</span>`;
    return `${this._feat("spotify", "mdi:spotify", "Spotify", "What's playing, your playlists and library, and controls on the Media page.", { status, can: connected && !!C.spotify && !!C.spotify_device })}
      <div class="stack"><h2>Connect Spotify</h2>
      ${step(1, connected, "Connect Spotify to Home Assistant", connected ? `<span class="muted">Spotify is connected${ints.has("spotify") ? "" : ""}.</span>`
        : `<p class="muted" style="margin:0">Home Assistant's own Spotify integration signs in to your account. You need Spotify Premium, and a free Spotify developer app the first time (the guide shows how, step by step).</p><div class="row">${this._addBtn("spotify", "Connect Spotify")}${this._guideBtn("spotify")}</div>`)}
      ${step(2, !!C.spotify, "Choose the account", ids.length ? `<div style="max-width:420px">${this._select("choices.spotify", ids, C.spotify, "Choose the account")}</div>` : `<span class="muted">Available once Spotify is connected.</span>`)}
      ${step(3, !!C.spotify_device, "Choose where music plays", C.spotify ? `<p class="muted" style="margin:0">Spotify lists speakers, TVs and computers that are switched on and have played recently. If yours is missing, play something on it in the Spotify app, then press Refresh.</p>
        <div class="grid2"><label class="f">Speaker or TV<select data-bind="choices.spotify_device" data-k="spdev"><option value="">Choose a speaker</option>${[...new Set([...(C.spotify_device ? [C.spotify_device] : []), ...sources])].map((s) => `<option${s === C.spotify_device ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
        <label class="f">Or type its name exactly as Spotify shows it<input type="text" data-bind="choices.spotify_device" data-k="spdevtext" value="${esc(C.spotify_device || "")}" maxlength="80"></label></div>
        <div class="row"><button type="button" class="btn sm" data-act="spRefresh"><ha-icon icon="mdi:refresh"></ha-icon>Refresh</button></div>` : `<span class="muted">Choose the account first.</span>`)}
      </div>`;
  },

  // ---------------------------------------------------------------- floor plan
  _step_plan() {
    const fp = GH_CFG.floorplan || {}, own = ghsNormArch(fp.arch), imgs = fp.images || {};
    const floors = own ? Object.entries(own).map(([fid, A]) => `<div class="item"><div class="ic"><ha-icon icon="mdi:floor-plan"></ha-icon></div><div class="tx"><div class="n">${esc(A.name)}</div><div class="s">${A.rooms.length} room${A.rooms.length === 1 ? "" : "s"}, ${A.walls.length} wall${A.walls.length === 1 ? "" : "s"}, ${A.doors.length} door${A.doors.length === 1 ? "" : "s"}${ghsSafeImage(imgs[fid]) ? ", with a picture" : ""}</div></div></div>`).join("") : "";
    const dirty = this._dirty;
    return `<div><h1 id="ghs-h" tabindex="-1">Floor plan</h1><p class="lead">Your own home on the Plan page: upload a picture of your floor plan or draw it, then place your devices on it and tap them to control them.</p></div>
      ${this._feat("floorplan", "mdi:floor-plan", "Plan page", "An interactive plan of your home with your devices on it.", { status: own ? `<span class="tag ok">Your own plan</span>` : `<span class="tag">Using the sample plan</span>` })}
      <div class="stack"><h2>${own ? "Your plan" : "Make your own plan"}</h2>
        ${own ? `<div class="grid2">${floors}</div>` : `<p class="muted" style="margin:0">Until you make your own, the Plan page shows a sample home.</p>`}
        ${dirty ? `<div class="note warn">Save or discard your other changes first: the building editor saves straight away and reloads the dashboard.</div>` : ""}
        <div class="row"><button type="button" class="btn primary" data-act="planEdit"${dirty ? " disabled" : ""}><ha-icon icon="mdi:pencil-ruler"></ha-icon>${own ? "Open the building editor" : "Upload or draw my plan"}</button>
          <button type="button" class="btn" data-act="nav" data-path="${ghBase()}/home#devices"><ha-icon icon="mdi:arrow-right"></ha-icon>Go to the Plan page</button></div></div>
      <div class="stack"><h2>How it works</h2><div class="grid3">
        <div class="item" style="align-items:flex-start"><div class="ic">1</div><div class="tx"><div class="n">The building</div><div class="s">Upload a photo or screenshot of your plan (an estate agent's plan works well) and use it as it is, or draw walls, rooms, doors and windows over it. Several floors are fine.</div></div></div>
        <div class="item" style="align-items:flex-start"><div class="ic">2</div><div class="tx"><div class="n">Your devices</div><div class="s">On the Plan page, press Edit, then Devices: add a light, plug, sensor or camera and drag it to where it is. Furniture works the same way.</div></div></div>
        <div class="item" style="align-items:flex-start"><div class="ic">3</div><div class="tx"><div class="n">Use it</div><div class="s">Tap a device on the plan to see it and control it. Rooms glow when their lights are on.</div></div></div></div>
        <p class="muted small" style="margin:0">The building editor also opens from the Plan page: Edit, then Building. Pictures are kept in this dashboard's settings in Home Assistant, which only signed-in people can see.</p></div>`;
  },

  // ---------------------------------------------------------------- guides
  _step_guides() {
    const open = this._ui.guide;
    return `<div><h1 id="ghs-h" tabindex="-1">Connection guides</h1><p class="lead">Step by step help for connections that need an account, a key or an app. Keys and passwords always go into Home Assistant's own setup, never into Glass Home.</p></div>
      <div class="stack">${GHS_GUIDES.map((g) => this._guideHtml(g, open === g.id)).join("")}</div>`;
  },

  // In Settings the Features step points to the dedicated tab; in the first-run wizard the controls are inline
  _moreHere(tab, label, html) {
    return this._mode === "wizard" ? html : `<div class="row"><button type="button" class="btn sm" data-act="tab" data-tab="${tab}"><ha-icon icon="mdi:arrow-right"></ha-icon>${esc(label)}</button></div>`;
  },

  // ---------------------------------------------------------------- actions
  async _moreAct(a, el, ds) {
    const d = this._d, B = d.choices.bins, E = d.choices.energy;
    switch (a) {
      case "guide":
        if (this._mode === "wizard") { this._ui.guideInline = this._ui.guideInline === ds.guide ? "" : ds.guide; this._render(); return; }
        this._ui.guide = ds.guide; this._tab = "guides"; this._anim = true; this._render();
        requestAnimationFrame(() => { const n = this.shadowRoot.getElementById(`guide-${ds.guide}`); if (n) n.scrollIntoView({ block: "start" }); });
        return;
      case "binSource": B.source = ds.v; this._ui.binErr = ""; this._persist(); this._render(); return;
      case "binFile": return this._binFile(el);
      case "binMonthFirst": this._ui.binMonthFirst = !this._ui.binMonthFirst; this._render(); return;
      case "binDateSet": this._ui.binDate = el.value; this._render(); return;
      case "binPaste": {
        this._ui.binPasteOpen = true;
        const r = ghsParseCsv(this._ui.binPaste || "", { tz: d.household.timezone || GH_TZ, monthFirst: !!this._ui.binMonthFirst });
        if (!r.events.length) { this._ui.binErr = "No upcoming dates were found. Put one collection on each line, with its date."; this._render(); return; }
        Object.assign(B, { source: "file", events: r.events, file: "Pasted dates", map: {} });
        d.features.bins = true; this._ui.binErr = "";
        ghToast(`${r.events.length} collections found`);
        this._persist(); this._render(); return;
      }
      case "binMap": {
        const key = ds.key, ev = this._binEvents().find((e) => ghsBinKey(e.summary) === key);
        const cur = B.map[key] || (ev ? ghsBinGuess(ev.summary) : []);
        B.map = { ...B.map, [key]: cur.includes(ds.c) ? cur.filter((c) => c !== ds.c) : [...cur, ds.c] };
        this._persist(); this._render(); return;
      }
      case "binCalRead": return this._binCalRead();
      case "binDateCol": { const c = this._ui.binDateCols || []; this._ui.binDateCols = c.includes(ds.c) ? c.filter((x) => x !== ds.c) : [...c, ds.c]; this._render(); return; }
      case "binAddDate": {
        const date = this._ui.binDate, ids = this._ui.binDateCols || [];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !ids.length) return;
        const summary = ids.join(" + ");
        B.events = [...(B.source === "dates" ? B.events || [] : []).filter((e) => e.date !== date), { date, summary }];
        B.map = { ...(B.source === "dates" ? B.map : {}), [ghsBinKey(summary)]: ids };
        B.source = "dates"; d.features.bins = true;
        this._ui.binDate = ""; this._ui.binDateCols = [];
        this._persist(); this._render(); return;
      }
      case "binDelDate": B.events = B.events.filter((e, i) => i !== +ds.i); this._persist(); this._render(); return;
      case "enSupplier": {
        E.supplier = el.value;
        const s = GHS_SUPPLIERS.find(([id]) => id === el.value);
        if (s && (!E.method || E.method === "keep")) E.method = s[2];
        this._persist(); this._render(); return;
      }
      case "enMethod": E.method = ds.v; this._ui.enErr = ""; this._persist(); this._render(); return;
      case "enSuggest": return this._enSuggest();
      case "enPrefs": return this._enPrefs();
      case "spRefresh": this._render(); return;
      case "musicService": {
        const v = GHS_MUSIC[ds.v] ? ds.v : "";
        d.choices.music_service = v;
        d.features.spotify = v === "spotify";
        d.features.music = !!v && v !== "spotify";
        if (v !== "spotify" && d.choices.music_player && !this._musicPlayers(v).includes(d.choices.music_player)) d.choices.music_player = "";
        this._persist(); this._render(); return;
      }
      case "planEdit": {
        const own = ghsNormArch(GH_CFG.floorplan && GH_CFG.floorplan.arch);
        ghOpenPlanEditor(this._hass, own ? Object.keys(own)[0] : "ground");
        return;
      }
      default:
    }
  },
});

// Styles for the pieces above
const GHS_CSS_MORE = `
  .bindot { display: inline-block; width: 14px; height: 16px; border-radius: 3px 3px 4px 4px; background: linear-gradient(var(--l) 0 4px, var(--c) 4px); vertical-align: -3px; margin-right: 5px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.25); }
  .chip { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; padding: 0 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: #e9e5f5; font: inherit; font-size: 13px; cursor: pointer; }
  .chip.sm { min-height: 36px; min-width: 36px; padding: 0 6px; justify-content: center; }
  .chip.sm .bindot { margin: 0; }
  .chip[aria-pressed=true] { background: rgba(var(--acc),0.32); border-color: rgba(var(--acc),0.7); }
  .binmap { flex-direction: column; align-items: stretch; gap: 10px; }
  .binmap .tx { width: 100%; }
  .binmap .n, .binmap .s { white-space: normal; overflow: visible; }
  .binmap .row { flex-wrap: wrap; gap: 6px; }
  .vh { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
  .opt.left { justify-content: flex-start; text-align: left; }
  details.guide { padding: 12px 16px; border-radius: 18px; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.07); }
  details.guide summary { display: flex; align-items: center; gap: 10px; cursor: pointer; min-height: 32px; list-style: none; }
  details.guide summary::-webkit-details-marker { display: none; }
  details.guide ol { margin: 0; padding-left: 22px; display: grid; gap: 6px; line-height: 1.45; }
  details summary { cursor: pointer; }
`;


// ================================================================== live data from Home Assistant
// Readings Glass Home works out in the browser from what Home Assistant already has: bin days from a
// Home Assistant calendar, and "used today" for an energy meter that only counts up. Nothing here is sent
// anywhere but your own Home Assistant, over the signed-in connection. Not used in demo mode.
const ghWithHass = (cb) => {
  const t = () => { const h = window.GlassHomeHassRoot; if (h && h.connection) cb(h); else setTimeout(t, 1000); };
  t();
};

// ------------------------------------------------------------------ bins
// Colours the settings use that the dashboard has no drawing for yet (food caddy, purple, ...)
const ghBinFill = () => {
  for (const [d, ids] of Object.entries(BIN_SCHEDULE)) {
    for (const id of ids) if (!BIN_TYPES[id] && GHS_BIN_COLOURS[id]) BIN_TYPES[id] = { ...GHS_BIN_COLOURS[id] };
    const ok = ids.filter((id) => BIN_TYPES[id]);
    if (ok.length) BIN_SCHEDULE[d] = ok; else delete BIN_SCHEDULE[d];
  }
  BIN_DATES.splice(0, BIN_DATES.length, ...Object.keys(BIN_SCHEDULE).sort());
};
ghBinFill();

// The bin cards on screen, so a calendar update reaches them straight away
const GH_BIN_CARDS = new Set();
for (const C of [GlassHomeBinBannerCard, GlassHomeBinCard]) {
  const d = Object.getOwnPropertyDescriptor(C.prototype, "hass");
  if (d && d.set) Object.defineProperty(C.prototype, "hass", { configurable: true, get: d.get, set(h) { GH_BIN_CARDS.add(this); d.set.call(this, h); } });
}
const ghBinRefresh = () => {
  for (const c of GH_BIN_CARDS) {
    if (!c.isConnected) { GH_BIN_CARDS.delete(c); continue; }
    c._key = undefined;
    c._shown = undefined;
    if (typeof c._update === "function") c._update();
  }
};

// bins.calendar: { entity: calendar.x, map: { "entry text": ["blue"] } }. A council calendar in Home
// Assistant (for example from the Waste Collection Schedule integration, or a calendar subscribed to the
// council's address) is read for the next 120 days, every 6 hours, and replaces the dates from today on.
const GH_BINCAL = !GH_DEMO && GH_CFG.bins && GH_CFG.bins.calendar && /^calendar\.[a-z0-9_]+$/.test(GH_CFG.bins.calendar.entity || "") ? GH_CFG.bins.calendar : null;
const GH_BINCAL_STATE = { at: 0, error: "", count: 0 };
window.GlassHomeBinCalendar = GH_BINCAL_STATE; // shown in diagnostics
if (GH_BINCAL) {
  const fixed = { ...BIN_SCHEDULE };
  const load = async (h) => {
    const today = localNow(new Date()).date, end = isoAddDays(today, 120);
    try {
      const evs = await h.callApi("GET", `calendars/${GH_BINCAL.entity}?start=${encodeURIComponent(`${today}T00:00:00`)}&end=${encodeURIComponent(`${end}T23:59:59`)}`);
      const list = (Array.isArray(evs) ? evs : []).map((e) => ({ date: String((e.start && (e.start.date || e.start.dateTime)) || e.start || "").slice(0, 10), summary: e.summary || e.message || "" }))
        .filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date));
      const sch = ghsBinsSchedule(list, GH_BINCAL.map || {});
      for (const k of Object.keys(BIN_SCHEDULE)) delete BIN_SCHEDULE[k];
      for (const [d, ids] of Object.entries(fixed)) if (d < today) BIN_SCHEDULE[d] = ids;
      Object.assign(BIN_SCHEDULE, sch);
      ghBinFill();
      Object.assign(GH_BINCAL_STATE, { at: Date.now(), error: "", count: Object.keys(sch).length });
      ghBinRefresh();
    } catch (e) {
      GH_BINCAL_STATE.error = String((e && (e.body && e.body.message || e.message)) || e);
      console.warn("Glass Home: the bin calendar could not be read", e);
    }
  };
  ghWithHass((h) => {
    load(h);
    setInterval(() => load(window.GlassHomeHassRoot || h), 6 * 3600e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - GH_BINCAL_STATE.at > 3600e3) load(window.GlassHomeHassRoot || h); });
  });
}

// ------------------------------------------------------------------ energy: "used today" from a meter
// energy.electricity.today_from (or gas): a meter that only counts up. Today's use is the change in its
// Home Assistant statistics since midnight (5-minute statistics, so at most about 5 minutes behind),
// shown as sensor.glasshome_electricity_today / sensor.glasshome_gas_today.
const GH_EN_TODAY = !GH_DEMO && GH_CFG.energy ? ["electricity", "gas"].map((k) => [k, GH_CFG.energy[k]])
  .filter(([, s]) => s && /^sensor\.[a-z0-9_]+$/.test(s.today_from || "") && /^sensor\.glasshome_[a-z]+_today$/.test(s.today_kwh || "")) : [];
if (GH_EN_TODAY.length) {
  const iso = () => new Date().toISOString();
  const put = (id, state, extra = {}) => ghSetVirtual(id, { entity_id: id, state, attributes: { friendly_name: id.includes("gas") ? "Gas used today" : "Electricity used today",
    unit_of_measurement: "kWh", device_class: "energy", icon: id.includes("gas") ? "mdi:fire" : "mdi:lightning-bolt", glasshome_provider: "statistics", ...extra },
    last_changed: iso(), last_updated: iso(), context: { id: "glasshome" } });
  for (const [, s] of GH_EN_TODAY) put(s.today_kwh, "unknown", { source: s.today_from });
  const load = async (h) => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    try {
      const r = await h.callWS({ type: "recorder/statistics_during_period", start_time: midnight.toISOString(), period: "5minute", types: ["change"],
        statistic_ids: GH_EN_TODAY.map(([, s]) => s.today_from), units: { energy: "kWh" } });
      for (const [, s] of GH_EN_TODAY) {
        const rows = (r && r[s.today_from]) || [];
        const kwh = rows.reduce((a, x) => a + (Number(x.change) || 0), 0);
        put(s.today_kwh, rows.length ? (Math.round(kwh * 100) / 100).toFixed(2) : "0.00", { source: s.today_from });
      }
    } catch (e) {
      console.warn("Glass Home: today's energy could not be worked out", e);
      for (const [, s] of GH_EN_TODAY) put(s.today_kwh, "unavailable", { source: s.today_from, glasshome_error: String((e && e.message) || e) });
    }
  };
  ghWithHass((h) => {
    load(h);
    setInterval(() => { if (!document.hidden) load(window.GlassHomeHassRoot || h); }, 5 * 60e3);
  });
}


// ================================================================== your own floor plan
// The Plan page draws floorplan.arch (walls, rooms, doors, windows) and, under it, an optional picture of
// your plan (floorplan.images.<floor>). The building editor below changes both: open it from the Plan
// page (Edit, then Building) or from Settings, Floor plan. Devices and furniture are still placed on the
// Plan page itself (Edit, then Devices / Furniture).
function ghPlanImg(fid) {
  const im = GH_CFG.floorplan && GH_CFG.floorplan.images && GH_CFG.floorplan.images[fid];
  return ghsSafeImage(im) ? im : null;
}
// Floors, room fills, stairs and the picture (under the furniture)
function ghArchFloorSvg(A, img) {
  const out = [];
  if (img) {
    out.push(`<rect x="${img.x}" y="${img.y}" width="${img.w}" height="${img.h}" fill="#fbf8f3"/>`
      + `<image href="${esc(img.src)}" x="${img.x}" y="${img.y}" width="${img.w}" height="${img.h}" preserveAspectRatio="none" opacity="${Math.max(0.2, Math.min(1, Number(img.opacity) || 1))}"/>`);
  } else if (A.outline && A.outline.length >= 3) out.push(`<polygon points="${pts(A.outline)}" fill="#cdb89c"/>`);
  for (const r of A.rooms || []) out.push(`<polygon points="${pts(r.poly)}" fill="${FLOOR_FILL[r.floor] || "#d8cbb8"}"${img ? ' fill-opacity="0.28"' : ""}/>`);
  const s = A.stairs;
  if (s && s.box) {
    const [bx0, by0, bx1, by1] = s.box;
    out.push(`<rect x="${bx0}" y="${by0}" width="${bx1 - bx0}" height="${by1 - by0}" fill="#c9a77e" stroke="#5c4a3a" stroke-width="1.2"/>`);
    const st = [`M${s.centre[0]} ${s.centre[1]}V${s.centre[3]}`, ...s.treads.map((y) => `M${bx0} ${y}H${bx1}`), `M${pts(s.arrow).replace(/ /g, " L")}`];
    out.push(`<path d="${st.join("")}" stroke="#5c4a3a" stroke-width="1.1" fill="none" stroke-linejoin="round"/>`);
    if (s.brk) out.push(`<polyline points="${pts(s.brk)}" stroke="#5c4a3a" stroke-width="1.1" fill="none"/>`);
    if (s.edge) out.push(`<rect x="${s.edge[0]}" y="${s.edge[1]}" width="${s.edge[2] - s.edge[0]}" height="${s.edge[3] - s.edge[1]}" fill="#5c4a3a"/>`);
  }
  return out.join("");
}
function archFloor(fid) { return ghArchFloorSvg(ARCH[fid], ghPlanImg(fid)); }
// The Plan page's own drawing of walls, doors, windows and labels, for any floor (the editor's too)
const ghArchWith = (A, fn) => { ARCH.__ghedit = A; try { return fn("__ghedit"); } finally { delete ARCH.__ghedit; } };

// A picture from the phone or computer, re-drawn by the browser: any hidden data in the file (camera,
// location) is left behind, and it is made small enough to keep in the dashboard settings.
async function ghShrinkImage(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error("Choose a picture (PNG, JPEG or WebP). For a PDF plan, take a screenshot of it first.");
  if (file.size > 30e6) throw new Error("That picture is very large. Choose one under 30 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("That picture couldn't be opened.")); img.src = url; });
    let max = 1800, q = 0.82, out = "", w = 0, h = 0;
    for (let i = 0; i < 5; i++) {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      w = Math.max(1, Math.round(img.naturalWidth * s)); h = Math.max(1, Math.round(img.naturalHeight * s));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = "#ffffff"; x.fillRect(0, 0, w, h);
      x.drawImage(img, 0, 0, w, h);
      out = c.toDataURL("image/webp", q);
      if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", q);
      if (out.length < 650e3) break;
      max = Math.round(max * 0.78); q = Math.max(0.6, q - 0.06);
    }
    return { src: out, width: w, height: h };
  } finally { URL.revokeObjectURL(url); }
}

// Save the dashboard's glasshome: settings after changing them (administrators, UI dashboards), then
// read them back to make sure Home Assistant kept them
async function ghSaveSettings(hass, change) {
  const url_path = GH_LOADED.path === "lovelace" ? null : GH_LOADED.path;
  const dash = await hass.callWS({ type: "lovelace/config", url_path, force: true });
  if (!dash || !Array.isArray(dash.views) || !dash.views.length) throw new Error("the dashboard came back without its views, so nothing was changed");
  const cur = dash.glasshome && typeof dash.glasshome === "object" ? JSON.parse(JSON.stringify(dash.glasshome)) : {};
  const next = change(cur);
  try { await hass.callWS({ type: "lovelace/config/save", url_path, config: { ...dash, glasshome: next } }); }
  catch (e) {
    const m = String((e && (e.message || e.code)) || e);
    const err = new Error(/storage|yaml|not supported|config_not_in_storage/i.test(m) ? "This dashboard is in YAML mode, so Glass Home can't save it from here."
      : /unauthorized|admin/i.test(m) ? "Saving needs a Home Assistant administrator account." : m);
    err.yaml = true;
    throw err;
  }
  const back = await hass.callWS({ type: "lovelace/config", url_path, force: true });
  if (!back || JSON.stringify(back.glasshome) !== JSON.stringify(next)) throw new Error("Home Assistant did not keep the new settings");
  return next;
}

const GHP_TOOLS = [
  ["select", "Move", "mdi:cursor-default-outline", "Tap a wall, window, door or room to choose it, then drag it or change it in the panel. Arrow keys nudge it."],
  ["wall", "Wall", "mdi:wall", "Drag to draw a straight wall. It snaps across or down the page."],
  ["window", "Window", "mdi:window-closed-variant", "Drag along a wall. The window cuts its own gap in the wall."],
  ["door", "Door", "mdi:door", "Drag across the doorway from the hinge side. Then choose which way it opens on the right."],
  ["room", "Room", "mdi:vector-square", "Drag a box for a rectangular room."],
  ["shape", "Shape", "mdi:vector-polygon", "Tap each corner of an L-shaped or odd room. Tap the first corner again (or Finish) to close it."],
  ["picture", "Picture", "mdi:image-outline", "Drag the picture of your plan to line it up. Change its size and strength on the right."],
  ["erase", "Erase", "mdi:eraser", "Tap anything to remove it."],
];
const GHP_FINISH = [["oak", "Wood"], ["stone", "Stone"], ["tile", "Tile"], ["carpet", "Carpet"]];
const GHP_CSS = `
  :host { position: fixed; inset: 0; z-index: 100; display: block; background: rgba(10,7,22,0.82); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
  :host([embedded]) { position: static; background: none; backdrop-filter: none; -webkit-backdrop-filter: none; }
  .pe { box-sizing: border-box; height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 10px; padding: 12px; max-width: 1400px; margin: 0 auto; }
  header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-radius: 20px; }
  header h2 { margin: 0; font-size: 19px; }
  .floors { display: flex; gap: 6px; flex-wrap: wrap; }
  .body { display: grid; grid-template-columns: 96px minmax(0, 1fr) 300px; gap: 10px; min-height: 0; }
  .tools { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 20px; overflow-y: auto; }
  .tools button { flex-direction: column; gap: 3px; min-height: 58px; padding: 6px 4px; font-size: 12px; border-radius: 14px; }
  .tools button[aria-pressed=true] { background: rgba(var(--acc),0.4); color: #fff; }
  .stage { position: relative; border-radius: 20px; overflow: hidden; min-height: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.25); }
  .stage svg { width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; display: block; }
  .side { padding: 14px; border-radius: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .side h3 { margin: 0; font-size: 15px; }
  .side .muted { font-size: 13px; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  input[type=range] { width: 100%; accent-color: rgb(var(--acc)); }
  .start { max-width: 760px; margin: auto; padding: 24px; border-radius: 24px; display: grid; gap: 14px; }
  .start .opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
  .start .opts button { flex-direction: column; align-items: flex-start; text-align: left; min-height: 120px; padding: 16px; gap: 6px; border-radius: 18px; }
  .start .opts button b { font-size: 15px; }
  .start .opts button span { font-weight: 400; color: #cfc9e6; font-size: 13px; line-height: 1.35; }
  .hidden { display: none; }
  .pe { position: relative; }
  .ask { position: absolute; z-index: 2; left: 50%; top: 70px; transform: translateX(-50%); width: min(560px, calc(100% - 24px)); box-sizing: border-box; padding: 14px 16px; border-radius: 18px;
    display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; background: rgba(40,20,40,0.96); border: 1px solid rgba(255,120,120,0.45); }
  @media (max-width: 900px) {
    .pe { height: auto; min-height: 100%; }
    :host { overflow-y: auto; }
    .body { grid-template-columns: minmax(0, 1fr); }
    .tools { flex-direction: row; overflow-x: auto; scrollbar-width: none; }
    .tools button { min-width: 64px; }
    .stage { height: 62vh; }
  }
`;

class GlassHomePlanEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tool = "select";
    this._sel = null;
    this._undo = [];
    this._thick = 12;
    this._snap = true;
    this._msg = "";
    this._dirty = false;
  }
  set hass(h) { this._hass = h; }
  // Open on a floor. Your own plan if there is one, otherwise the start choices.
  open(floor) {
    const own = ghsNormArch(GH_CFG.floorplan && GH_CFG.floorplan.arch);
    this._arch = own ? JSON.parse(JSON.stringify(own)) : null;
    this._imgs = JSON.parse(JSON.stringify((GH_CFG.floorplan && GH_CFG.floorplan.images) || {}));
    for (const k of Object.keys(this._imgs)) if (!ghsSafeImage(this._imgs[k])) delete this._imgs[k];
    this._floor = this._arch && this._arch[floor] ? floor : this._arch ? Object.keys(this._arch)[0] : "ground";
    this._render();
  }
  connectedCallback() {
    if (this._wired) return;
    this._wired = true;
    const r = this.shadowRoot;
    r.addEventListener("click", (e) => this._click(e));
    r.addEventListener("change", (e) => this._change(e));
    r.addEventListener("input", (e) => this._input(e));
    this._key = (e) => this._keydown(e);
    window.addEventListener("keydown", this._key);
  }
  disconnectedCallback() { if (this._key) window.removeEventListener("keydown", this._key); this._wired = false; }

  get _A() { return this._arch && this._arch[this._floor]; }
  _snapV(v) { return this._snap ? Math.round(v / 5) * 5 : Math.round(v); }
  _push() {
    this._undo.push(JSON.stringify({ arch: this._arch, imgs: this._imgs, floor: this._floor }));
    if (this._undo.length > 60) this._undo.shift();
    this._dirty = true;
  }
  _say(m) { this._msg = m; const n = this.shadowRoot.getElementById("msg"); if (n) n.textContent = m; }

  // ---------------------------------------------------------------- drawing
  _render() {
    const css = `<style>${GHS_CSS}${GHP_CSS}</style>`;
    if (!this._arch) { this.shadowRoot.innerHTML = `${css}${this._startHtml()}`; return; }
    const floors = Object.keys(this._arch).map((f) => `<button type="button" class="btn sm${f === this._floor ? " primary" : ""}" data-act="floor" data-f="${esc(f)}">${esc(this._arch[f].name)}</button>`).join("");
    const tools = GHP_TOOLS.map(([id, label, icon]) => `<button type="button" class="btn" data-act="tool" data-tool="${id}" aria-pressed="${this._tool === id}"><ha-icon icon="${icon}"></ha-icon>${label}</button>`).join("");
    this.shadowRoot.innerHTML = `${css}<div class="pe">${this._askHtml()}
      <header class="glass"><h2>Building editor</h2><div class="floors" role="group" aria-label="Floors">${floors}<button type="button" class="btn sm" data-act="addFloor"><ha-icon icon="mdi:plus"></ha-icon>Floor</button></div>
        <div class="row"><button type="button" class="btn sm" data-act="undo"${this._undo.length ? "" : " disabled"}><ha-icon icon="mdi:undo"></ha-icon>Undo</button>
        <button type="button" class="btn sm" data-act="close">${this._dirty ? "Cancel" : "Close"}</button>
        <button type="button" class="btn sm primary" data-act="save"${this._saving ? " disabled" : ""}>${this._saving ? '<span class="spin"></span>Saving…' : '<ha-icon icon="mdi:content-save-outline"></ha-icon>Save'}</button></div></header>
      <div class="body"><nav class="tools glass" aria-label="Tools">${tools}</nav>
        <div class="stage glass"><svg id="svg" viewBox="-6 -6 684 430" xmlns="http://www.w3.org/2000/svg" font-family="Inter,-apple-system,Roboto,Segoe UI,sans-serif" text-anchor="middle" role="img" aria-label="Floor plan being edited">
          <defs><pattern id="grid" width="34.55" height="34.55" patternUnits="userSpaceOnUse"><path d="M34.55 0H0V34.55" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="0.6"/></pattern></defs>
          <rect x="-6" y="-6" width="684" height="430" fill="url(#grid)"/><g id="floor"></g><g id="struct"></g><g id="labels"></g><g id="over"></g></svg></div>
        <aside class="side glass" id="side"></aside></div></div>`;
    const svg = this.shadowRoot.getElementById("svg");
    svg.addEventListener("pointerdown", (e) => this._down(e));
    svg.addEventListener("pointermove", (e) => this._move(e));
    svg.addEventListener("pointerup", (e) => this._up(e));
    svg.addEventListener("pointercancel", () => { this._drag = null; this._draw(); });
    this._draw();
  }
  _draw() {
    const r = this.shadowRoot, A = this._A;
    if (!A || !r.getElementById("floor")) return;
    r.getElementById("floor").innerHTML = ghArchFloorSvg(A, ghsSafeImage(this._imgs[this._floor]) ? this._imgs[this._floor] : null);
    r.getElementById("struct").innerHTML = ghArchWith(A, archStructure);
    r.getElementById("labels").innerHTML = ghArchWith(A, archLabels);
    r.getElementById("over").innerHTML = this._overSvg();
    r.getElementById("side").innerHTML = this._sideHtml();
  }
  _overSvg() {
    const A = this._A, out = [], d = this._drag, hi = 'fill="rgba(167,139,250,0.28)" stroke="#a78bfa" stroke-width="2" stroke-dasharray="5 3"';
    const s = this._sel;
    if (s && s.kind === "room" && A.rooms[s.i]) out.push(`<polygon points="${pts(A.rooms[s.i].poly)}" ${hi}/>`);
    if (s && (s.kind === "wall" || s.kind === "window")) { const w = A[s.kind === "wall" ? "walls" : "windows"][s.i]; if (w) out.push(`<rect x="${w[0] - 3}" y="${w[1] - 3}" width="${w[2] - w[0] + 6}" height="${w[3] - w[1] + 6}" ${hi}/>`); }
    if (s && s.kind === "door" && A.doors[s.i]) { const o = A.doors[s.i]; out.push(`<circle cx="${o.h[0]}" cy="${o.h[1]}" r="${o.r + 4}" ${hi}/>`); }
    if (d && d.b && ["wall", "window", "door"].includes(d.tool)) out.push(`<line x1="${d.a[0]}" y1="${d.a[1]}" x2="${d.b[0]}" y2="${d.b[1]}" stroke="#a78bfa" stroke-width="${d.tool === "door" ? 3 : this._thick}" stroke-opacity="0.6" stroke-linecap="square"/>`);
    if (d && d.b && d.tool === "room") out.push(`<rect x="${Math.min(d.a[0], d.b[0])}" y="${Math.min(d.a[1], d.b[1])}" width="${Math.abs(d.b[0] - d.a[0])}" height="${Math.abs(d.b[1] - d.a[1])}" ${hi}/>`);
    if (this._shape && this._shape.length) {
      const p = this._shape, h = this._hover;
      out.push(`<polyline points="${pts(h ? [...p, h] : p)}" fill="rgba(167,139,250,0.18)" stroke="#a78bfa" stroke-width="2"/>`);
      out.push(...p.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 0 ? 6 : 3.5}" fill="${i === 0 ? "#fff" : "#a78bfa"}" stroke="#a78bfa" stroke-width="1.5"/>`));
    }
    return out.join("");
  }
  _startHtml() {
    return `<div class="pe"><div class="start glass" role="dialog" aria-labelledby="ghp-h">
      <h2 id="ghp-h" style="margin:0">Your floor plan</h2>
      <p class="lead" style="margin:0">Start with a picture of your plan (an estate agent's floor plan works well), draw your home yourself, or begin from the sample plan and change it.</p>
      <div class="opts">
        <button type="button" class="btn" data-act="pickStart"><ha-icon icon="mdi:image-plus"></ha-icon><b>Upload a picture</b><span>A photo or screenshot of your floor plan. You can draw walls over it, or just use the picture.</span></button>
        <button type="button" class="btn" data-act="blank"><ha-icon icon="mdi:pencil-ruler"></ha-icon><b>Draw it myself</b><span>Start with an empty page and draw rooms, walls, doors and windows.</span></button>
        <button type="button" class="btn" data-act="sample"><ha-icon icon="mdi:home-floor-0"></ha-icon><b>Change the sample</b><span>Copy the two-storey sample plan and move its walls and rooms to match your home.</span></button>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-k="startfile" aria-label="Floor plan picture">
      <p class="muted small" style="margin:0">The picture is kept in this dashboard's settings in Home Assistant, which only people who can sign in can see. It's redrawn by your browser first, so it carries no location or camera details.</p>
      <div class="note bad${this._msg ? "" : " hidden"}" id="msg" role="alert">${esc(this._msg)}</div>
      <div class="row"><button type="button" class="btn" data-act="close">Close</button></div></div></div>`;
  }
  _sideHtml() {
    const A = this._A, s = this._sel, tool = GHP_TOOLS.find((t) => t[0] === this._tool);
    const img = this._imgs[this._floor];
    let sel = "";
    if (s && s.kind === "room" && A.rooms[s.i]) {
      const r = A.rooms[s.i];
      sel = `<h3>Room</h3><label class="f">Name<input type="text" data-k="roomName" value="${esc(r.name)}" maxlength="40"></label>
        <label class="f">Size (optional, shown under the name)<input type="text" data-k="roomDims" value="${esc(r.dims || "")}" maxlength="24" placeholder="For example 4.1 × 3.5 m"></label>
        <label class="f">Floor<select data-k="roomFloor">${GHP_FINISH.map(([v, l]) => `<option value="${v}"${r.floor === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="row"><input type="checkbox" data-k="roomSmall"${r.small ? " checked" : ""}> Smaller name</label>`;
    } else if (s && s.kind === "wall") {
      sel = `<h3>Wall</h3><label class="f">Thickness<select data-k="wallThick">${[[7, "Thin (partition)"], [12, "Inside wall"], [15, "Outside wall"], [20, "Thick"]].map(([v, l]) => `<option value="${v}"${this._wallThick(A.walls[s.i]) === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
    } else if (s && s.kind === "door" && A.doors[s.i]) {
      sel = `<h3>Door</h3><label class="f">Width<input type="range" min="20" max="90" step="1" data-k="doorR" value="${A.doors[s.i].r}"></label>
        <div class="row"><button type="button" class="btn sm" data-act="doorFlip"><ha-icon icon="mdi:swap-horizontal"></ha-icon>Open the other way</button></div>`;
    } else if (s && s.kind === "window") sel = `<h3>Window</h3>`;
    if (sel) sel += `<div class="row"><button type="button" class="btn sm danger" data-act="delSel"><ha-icon icon="mdi:delete-outline"></ha-icon>Remove</button><button type="button" class="btn sm" data-act="desel">Done</button></div>`;
    const shape = this._tool === "shape" && this._shape && this._shape.length >= 3 ? `<div class="row"><button type="button" class="btn sm primary" data-act="finishShape">Finish room</button><button type="button" class="btn sm" data-act="cancelShape">Cancel</button></div>` : "";
    const floors = Object.keys(this._arch).length;
    return `${sel ? `<div class="stack">${sel}</div>` : `<div><h3>${esc(tool[1])}</h3><p class="muted" style="margin:4px 0 0">${esc(tool[3])}</p>${shape}</div>`}
      ${["wall", "window"].includes(this._tool) ? `<label class="f">New ${this._tool === "wall" ? "walls" : "windows"}<select data-k="thick">${[[7, "Thin"], [12, "Inside wall"], [15, "Outside wall"], [20, "Thick"]].map(([v, l]) => `<option value="${v}"${this._thick === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
      <label class="row"><input type="checkbox" data-k="snap"${this._snap ? " checked" : ""}> Snap to a 7 cm grid</label>
      <div class="stack" style="gap:8px"><h3>Picture of this floor</h3>
        ${img ? `<label class="f">Strength<input type="range" min="0.2" max="1" step="0.05" data-k="imgOpacity" value="${img.opacity || 1}"></label>
          <label class="f">Size<input type="range" min="0.3" max="2" step="0.02" data-k="imgScale" value="${(img.w / (img.fitW || img.w)).toFixed(2)}"></label>
          <div class="row"><button type="button" class="btn sm" data-act="imgFit">Fit to page</button><button type="button" class="btn sm" data-act="pickImg">Replace</button><button type="button" class="btn sm danger" data-act="imgDel">Remove</button></div>`
        : `<p class="muted" style="margin:0">Add a photo or screenshot of this floor's plan to trace over, or to use as the plan itself.</p><div class="row"><button type="button" class="btn sm" data-act="pickImg"><ha-icon icon="mdi:image-plus"></ha-icon>Add a picture</button></div>`}
        <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" data-k="imgfile" aria-label="Picture of this floor"></div>
      <div class="stack" style="gap:8px"><h3>This floor</h3><label class="f">Name<input type="text" data-k="floorName" value="${esc(this._A.name)}" maxlength="24"></label>
        <div class="row"><button type="button" class="btn sm" data-act="clearFloor">Empty this floor</button>${floors > 1 ? '<button type="button" class="btn sm danger" data-act="delFloor">Delete floor</button>' : ""}</div></div>
      <p class="muted small" style="margin:0">Place devices and furniture on the Plan page: Edit, then Devices or Furniture.</p>
      <div class="note bad${this._msg ? "" : " hidden"}" id="msg" role="alert">${esc(this._msg)}</div>
      ${this._yaml ? `<div class="stack" style="gap:6px"><p class="muted small" style="margin:0">Copy this into the dashboard's settings by hand, replacing its <code>floorplan:</code> section:</p><textarea readonly data-k="yaml">${esc(this._yaml)}</textarea></div>` : ""}`;
  }
  _confirm(text, yes, fn) {
    this._ask = { text, yes, fn };
    this._render();
    const b = this.shadowRoot.querySelector("[data-act=askNo]");
    if (b) b.focus();
  }
  _askHtml() {
    return this._ask ? `<div class="ask glass" role="alertdialog" aria-label="${esc(this._ask.text)}"><span>${esc(this._ask.text)}</span><span class="row"><button type="button" class="btn sm" data-act="askNo">Keep editing</button><button type="button" class="btn sm danger" data-act="askYes">${esc(this._ask.yes)}</button></span></div>` : "";
  }
  _wallThick(w) { const t = w ? Math.min(w[2] - w[0], w[3] - w[1]) : 12; return [7, 12, 15, 20].reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a)); }

  // ---------------------------------------------------------------- pointer
  _pt(e) {
    const svg = this.shadowRoot.getElementById("svg"), p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return [q.x, q.y];
  }
  // Snap to the grid, then to a wall corner nearby, so walls meet cleanly
  _snapPt([x, y]) {
    let p = [this._snapV(x), this._snapV(y)], best = 9;
    for (const w of this._A.walls) for (const c of [[w[0], w[1]], [w[2], w[1]], [w[0], w[3]], [w[2], w[3]], [(w[0] + w[2]) / 2, (w[1] + w[3]) / 2]]) {
      const dd = Math.hypot(c[0] - x, c[1] - y);
      if (dd < best) { best = dd; p = [Math.round(c[0]), Math.round(c[1])]; }
    }
    return p;
  }
  _hit([x, y]) {
    const A = this._A, inR = (r, pad = 4) => x >= r[0] - pad && x <= r[2] + pad && y >= r[1] - pad && y <= r[3] + pad;
    for (let i = A.doors.length - 1; i >= 0; i--) { const d = A.doors[i]; if (Math.hypot(d.h[0] - x, d.h[1] - y) <= d.r) { const a = (Math.atan2(y - d.h[1], x - d.h[0]) * 180) / Math.PI; if (Math.hypot(d.h[0] - x, d.h[1] - y) < 10 || this._angBetween(a, d.a0, d.a1)) return { kind: "door", i }; } }
    for (let i = A.windows.length - 1; i >= 0; i--) if (inR(A.windows[i])) return { kind: "window", i };
    for (let i = A.walls.length - 1; i >= 0; i--) if (inR(A.walls[i])) return { kind: "wall", i };
    for (let i = A.rooms.length - 1; i >= 0; i--) if (inPoly(x, y, A.rooms[i].poly)) return { kind: "room", i };
    return null;
  }
  _angBetween(a, a0, a1) {
    const n = (v) => ((v % 360) + 360) % 360, s = n(a0), e = n(a1), t = n(a);
    const span = n(e - s);
    return span <= 180 ? n(t - s) <= span : n(s - t) <= 360 - span;
  }
  _down(e) {
    if (e.button > 0) return;
    const raw = this._pt(e), p = this._snapPt(raw), t = this._tool;
    this.shadowRoot.getElementById("svg").setPointerCapture(e.pointerId);
    if (t === "select") {
      const h = this._hit(raw);
      this._sel = h;
      if (h) { this._push(); this._drag = { tool: "move", a: p, last: p, moved: false }; }
      this._draw();
    } else if (t === "erase") {
      const h = this._hit(raw);
      if (h) { this._push(); this._remove(h); this._draw(); }
    } else if (t === "picture") {
      if (this._imgs[this._floor]) { this._push(); this._drag = { tool: "picture", a: raw, last: raw }; }
      else this._say("Add a picture on the right first.");
    } else if (t === "shape") {
      this._shape = this._shape || [];
      if (this._shape.length >= 3 && Math.hypot(this._shape[0][0] - p[0], this._shape[0][1] - p[1]) < 10) this._finishShape();
      else { this._shape.push(p); this._draw(); }
    } else this._drag = { tool: t, a: p, b: null };
  }
  _move(e) {
    const raw = this._pt(e), d = this._drag;
    if (this._tool === "shape" && this._shape && this._shape.length) { this._hover = this._snapPt(raw); this.shadowRoot.getElementById("over").innerHTML = this._overSvg(); }
    if (!d) return;
    if (d.tool === "move") {
      const p = this._snapPt(raw), dx = p[0] - d.last[0], dy = p[1] - d.last[1];
      if (dx || dy) { this._shift(this._sel, dx, dy); d.last = p; d.moved = true; this._draw(); }
    } else if (d.tool === "picture") {
      const im = this._imgs[this._floor], dx = raw[0] - d.last[0], dy = raw[1] - d.last[1];
      im.x = Math.round(im.x + dx); im.y = Math.round(im.y + dy); d.last = raw;
      this.shadowRoot.getElementById("floor").innerHTML = ghArchFloorSvg(this._A, im);
    } else {
      let b = this._snapPt(raw);
      if (d.tool !== "room") { if (Math.abs(b[0] - d.a[0]) >= Math.abs(b[1] - d.a[1])) b = [b[0], d.a[1]]; else b = [d.a[0], b[1]]; }
      d.b = b;
      this.shadowRoot.getElementById("over").innerHTML = this._overSvg();
    }
  }
  _up() {
    const d = this._drag;
    this._drag = null;
    if (!d) return;
    if (d.tool === "move") { if (!d.moved) this._undo.pop(); this._draw(); return; }
    if (d.tool === "picture") { this._draw(); return; }
    if (!d.b) { this._draw(); return; }
    const [ax, ay] = d.a, [bx, by] = d.b, len = Math.hypot(bx - ax, by - ay), A = this._A, t = this._thick / 2;
    const horiz = Math.abs(bx - ax) >= Math.abs(by - ay);
    const rect = horiz ? [Math.min(ax, bx), ay - t, Math.max(ax, bx), ay + t] : [ax - t, Math.min(ay, by), ax + t, Math.max(ay, by)];
    if (d.tool === "room") {
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      if (x1 - x0 >= 15 && y1 - y0 >= 15) { this._push(); this._addRoom([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]); }
    } else if (len >= 8) {
      this._push();
      if (d.tool === "wall") { A.walls.push(rect.map(Math.round)); this._sel = { kind: "wall", i: A.walls.length - 1 }; }
      if (d.tool === "window") { this._cut(rect); A.windows.push(rect.map(Math.round)); this._sel = { kind: "window", i: A.windows.length - 1 }; }
      if (d.tool === "door" && len >= 18) {
        const a1 = Math.round((Math.atan2(by - ay, bx - ax) * 180) / Math.PI / 90) * 90;
        const r = Math.round(Math.min(90, len));
        const n = (v) => ((v % 360) + 360) % 360;
        this._cut(horiz ? [Math.min(ax, bx), ay - 11, Math.max(ax, bx), ay + 11] : [ax - 11, Math.min(ay, by), ax + 11, Math.max(ay, by)]);
        A.doors.push({ h: [ax, ay], r, a0: n(a1 + 90), a1: n(a1) });
        this._sel = { kind: "door", i: A.doors.length - 1 };
      }
    }
    this._draw();
  }
  // A window or door cuts its gap out of any wall it sits in
  _cut(g) {
    const A = this._A, out = [];
    for (const w of A.walls) {
      const ov = !(g[2] <= w[0] || g[0] >= w[2] || g[3] <= w[1] || g[1] >= w[3]);
      if (!ov) { out.push(w); continue; }
      const horiz = w[2] - w[0] >= w[3] - w[1];
      if (horiz) { if (g[0] > w[0]) out.push([w[0], w[1], g[0], w[3]]); if (g[2] < w[2]) out.push([g[2], w[1], w[2], w[3]]); }
      else { if (g[1] > w[1]) out.push([w[0], w[1], w[2], g[1]]); if (g[3] < w[3]) out.push([w[0], g[3], w[2], w[3]]); }
    }
    A.walls = out.filter((w) => w[2] - w[0] >= 1 && w[3] - w[1] >= 1);
    if (this._sel && this._sel.kind === "wall") this._sel = null;
  }
  _addRoom(poly) {
    const A = this._A;
    A.rooms.push({ id: `room${Date.now().toString(36)}`, name: `Room ${A.rooms.length + 1}`, floor: "oak", poly, label: ghsCentroid(poly) });
    this._sel = { kind: "room", i: A.rooms.length - 1 };
    this._tool = "select";
    this._render();
    const n = this.shadowRoot.querySelector("[data-k=roomName]");
    if (n) { n.focus(); n.select(); }
  }
  _finishShape() {
    const p = this._shape || [];
    this._shape = null; this._hover = null;
    if (p.length >= 3) { this._push(); this._addRoom(p); } else this._draw();
  }
  _shift(s, dx, dy) {
    const A = this._A;
    if (!s) return;
    if (s.kind === "room") { const r = A.rooms[s.i]; r.poly = r.poly.map(([x, y]) => [x + dx, y + dy]); r.label = [r.label[0] + dx, r.label[1] + dy]; }
    if (s.kind === "wall" || s.kind === "window") { const w = A[s.kind === "wall" ? "walls" : "windows"][s.i]; w[0] += dx; w[2] += dx; w[1] += dy; w[3] += dy; }
    if (s.kind === "door") { const d = A.doors[s.i]; d.h = [d.h[0] + dx, d.h[1] + dy]; }
  }
  _remove(s) {
    const key = { room: "rooms", wall: "walls", window: "windows", door: "doors" }[s.kind];
    this._A[key].splice(s.i, 1);
    this._sel = null;
  }

  // ---------------------------------------------------------------- controls
  async _click(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act, A = this._A;
    switch (act) {
      case "tool": this._tool = b.dataset.tool; this._sel = null; this._shape = null; this._msg = ""; this._render(); return;
      case "floor": this._floor = b.dataset.f; this._sel = null; this._shape = null; this._render(); return;
      case "addFloor": {
        this._push();
        const n = Object.keys(this._arch).length, names = ["GROUND FLOOR", "FIRST FLOOR", "SECOND FLOOR", "THIRD FLOOR", "LOFT", "BASEMENT"];
        let id = ["ground", "first", "second", "third", "loft", "basement"][n] || `floor${n + 1}`;
        while (this._arch[id]) id = `${id}_${n}`;
        this._arch[id] = { name: names[n] || `FLOOR ${n + 1}`, rooms: [], walls: [], windows: [], sliders: [], doors: [], stairs: null };
        this._floor = id; this._render(); return;
      }
      case "delFloor":
        this._confirm(`Delete ${A.name} and everything drawn on it?`, "Delete floor", () => { this._push(); delete this._arch[this._floor]; delete this._imgs[this._floor]; this._floor = Object.keys(this._arch)[0]; });
        return;
      case "clearFloor":
        this._confirm(`Remove every wall, room, door and window on ${A.name}? The picture stays.`, "Empty floor", () => { this._push(); Object.assign(A, { rooms: [], walls: [], windows: [], sliders: [], doors: [], stairs: null }); this._sel = null; });
        return;
      case "undo": {
        const last = this._undo.pop();
        if (!last) return;
        const u = JSON.parse(last);
        this._arch = u.arch; this._imgs = u.imgs; this._floor = this._arch[u.floor] ? u.floor : Object.keys(this._arch)[0]; this._sel = null; this._render(); return;
      }
      case "desel": this._sel = null; this._draw(); return;
      case "delSel": if (this._sel) { this._push(); this._remove(this._sel); this._draw(); } return;
      case "doorFlip": { const d = A.doors[this._sel.i]; this._push(); const n = (v) => ((v % 360) + 360) % 360; d.a0 = n(d.a0 - d.a1 === 90 || d.a0 - d.a1 === -270 ? d.a1 - 90 : d.a1 + 90); this._draw(); return; }
      case "finishShape": this._finishShape(); return;
      case "cancelShape": this._shape = null; this._hover = null; this._draw(); return;
      case "pickImg": this.shadowRoot.querySelector("[data-k=imgfile]").click(); return;
      case "pickStart": this.shadowRoot.querySelector("[data-k=startfile]").click(); return;
      case "imgFit": { const im = this._imgs[this._floor]; this._push(); Object.assign(im, ghsImageFit(im.pw || im.w, im.ph || im.h)); im.fitW = im.w; this._draw(); return; }
      case "imgDel": this._push(); delete this._imgs[this._floor]; this._draw(); return;
      case "blank": this._arch = { ground: { name: "GROUND FLOOR", rooms: [], walls: [], windows: [], sliders: [], doors: [], stairs: null } }; this._floor = "ground"; this._dirty = true; this._tool = "room"; this._render(); return;
      case "sample": this._arch = ghsNormArch(JSON.parse(JSON.stringify(SAMPLE_ARCH))); this._floor = Object.keys(this._arch)[0]; this._dirty = true; this._render(); return;
      case "close":
        if (this._dirty) { this._confirm("Close without saving your changes to the building?", "Close without saving", () => this.remove()); return; }
        this.remove(); return;
      case "askYes": { const fn = this._ask && this._ask.fn; this._ask = null; if (fn) fn(); if (this.isConnected) this._render(); return; }
      case "askNo": this._ask = null; this._render(); return;
      case "save": return this._save();
    }
  }
  _input(e) {
    const k = e.target.dataset.k, A = this._A, s = this._sel;
    if (!k || !A) return;
    const v = e.target.value;
    if (k === "roomName" && s) { A.rooms[s.i].name = v.slice(0, 40); this._dirty = true; this.shadowRoot.getElementById("labels").innerHTML = ghArchWith(A, archLabels); }
    if (k === "roomDims" && s) { A.rooms[s.i].dims = v.slice(0, 24); this._dirty = true; this.shadowRoot.getElementById("labels").innerHTML = ghArchWith(A, archLabels); }
    if (k === "floorName") { A.name = v.slice(0, 24); this._dirty = true; const f = this.shadowRoot.querySelector(`[data-act=floor][data-f="${this._floor}"]`); if (f) f.textContent = A.name; }
    if (k === "doorR" && s) { A.doors[s.i].r = Number(v); this._dirty = true; this.shadowRoot.getElementById("struct").innerHTML = ghArchWith(A, archStructure); }
    if (k === "imgOpacity" || k === "imgScale") {
      const im = this._imgs[this._floor];
      if (k === "imgOpacity") im.opacity = Number(v);
      else { const cx = im.x + im.w / 2, cy = im.y + im.h / 2, f = Number(v), fw = im.fitW || im.w, fh = (fw * im.h) / im.w; im.w = Math.round(fw * f); im.h = Math.round(fh * f); im.x = Math.round(cx - im.w / 2); im.y = Math.round(cy - im.h / 2); }
      this._dirty = true;
      this.shadowRoot.getElementById("floor").innerHTML = ghArchFloorSvg(A, im);
    }
  }
  async _change(e) {
    const k = e.target.dataset.k, A = this._A, s = this._sel;
    if (k === "startfile" || k === "imgfile") {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        this._say("Preparing the picture…");
        const pic = await ghShrinkImage(f);
        if (!this._arch) { this._arch = { ground: { name: "GROUND FLOOR", rooms: [], walls: [], windows: [], sliders: [], doors: [], stairs: null } }; this._floor = "ground"; this._tool = "select"; }
        else this._push();
        const fit = ghsImageFit(pic.width, pic.height);
        this._imgs[this._floor] = { src: pic.src, ...fit, opacity: 1, fitW: fit.w, pw: pic.width, ph: pic.height };
        this._dirty = true; this._msg = "";
        this._render();
      } catch (err) { this._say(err.message); }
      return;
    }
    if (!A) return;
    if (k === "roomFloor" && s) { this._push(); A.rooms[s.i].floor = e.target.value; this._draw(); }
    if (k === "roomSmall" && s) { this._push(); A.rooms[s.i].small = e.target.checked || undefined; this._draw(); }
    if (k === "wallThick" && s) {
      this._push();
      const w = A.walls[s.i], t = Number(e.target.value) / 2, horiz = w[2] - w[0] >= w[3] - w[1];
      if (horiz) { const m = (w[1] + w[3]) / 2; w[1] = Math.round(m - t); w[3] = Math.round(m + t); } else { const m = (w[0] + w[2]) / 2; w[0] = Math.round(m - t); w[2] = Math.round(m + t); }
      this._draw();
    }
    if (k === "thick") this._thick = Number(e.target.value);
    if (k === "snap") this._snap = e.target.checked;
    if (k === "roomName" || k === "roomDims" || k === "floorName") this._push();
  }
  _keydown(e) {
    if (!this.isConnected || !this._arch) return;
    const tag = (e.composedPath()[0] || {}).tagName;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(tag)) return;
    if (e.key === "Escape") { if (this._shape) { this._shape = null; this._draw(); } else if (this._sel) { this._sel = null; this._draw(); } e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); this.shadowRoot.querySelector("[data-act=undo]").click(); return; }
    if (!this._sel) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); this._push(); this._remove(this._sel); this._draw(); return; }
    const step = e.shiftKey ? 1 : 5, mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { e.preventDefault(); this._push(); this._shift(this._sel, mv[0], mv[1]); this._draw(); }
  }

  // ---------------------------------------------------------------- saving
  _plan() {
    const arch = {}, images = {};
    for (const [fid, A] of Object.entries(this._arch)) {
      const { fitW, pw, ph, ...a } = A;
      arch[fid] = { ...a, outline: ghsOutlineFor(A.rooms, A.walls) };
      if (!a.stairs) delete arch[fid].stairs;
      const im = this._imgs[fid];
      if (ghsSafeImage(im)) images[fid] = { src: im.src, x: im.x, y: im.y, w: im.w, h: im.h, opacity: Math.round((Number(im.opacity) || 1) * 100) / 100 };
    }
    return { arch, images };
  }
  async _save() {
    if (GH_DEMO && ghExploring) { this._say("You're exploring the demo. Set up your own home to save a plan."); return; }
    const { arch, images } = this._plan();
    const size = JSON.stringify({ arch, images }).length;
    if (size > 3.2e6) { this._say("The pictures are too big to keep in the dashboard together. Remove one, or use a smaller picture."); return; }
    this._saving = true; this._yaml = ""; this._render();
    try {
      await ghSaveSettings(this._hass, (cfg) => {
        const fp = { ...(cfg.floorplan || {}), arch };
        if (Object.keys(images).length) fp.images = images; else delete fp.images;
        // the sample's starting furniture belongs to the sample plan
        if (!(cfg.floorplan && cfg.floorplan.arch)) fp.fittings = fp.fittings || {};
        return { ...cfg, floorplan: fp, features: { ...(cfg.features || {}), floorplan: true } };
      });
      this._dirty = false;
      ghToast("Floor plan saved. Reloading…");
      setTimeout(() => location.reload(), 700);
    } catch (e) {
      this._saving = false;
      this._msg = `Not saved: ${e.message}`;
      if (e.yaml) this._yaml = `floorplan:${ghsToYaml({ arch, ...(Object.keys(images).length ? { images } : {}) }, "  ")}\n`;
      this._render();
    }
  }
}
if (!customElements.get("glasshome-plan-editor")) customElements.define("glasshome-plan-editor", GlassHomePlanEditor);
// Open the editor over the page (from the Plan page's Edit bar, or Settings)
function ghOpenPlanEditor(hass, floor) {
  if (!(hass && hass.user && hass.user.is_admin) && !GH_DEMO) ghToast("Only an administrator can save a floor plan. You can still try the editor.", "warn");
  const old = document.querySelector("glasshome-plan-editor");
  if (old) old.remove();
  const ed = document.createElement("glasshome-plan-editor");
  ed.hass = hass;
  document.body.appendChild(ed);
  ed.open(floor);
  return ed;
}
window.GlassHomeOpenPlanEditor = ghOpenPlanEditor;

// ================================================================== music card (Apple Music, Music Assistant, any player)
/*
 * Glass Home music card: what's playing and your playlists for any Home Assistant media player, for music
 * services other than Spotify (Spotify has its own card). Works with Music Assistant (Apple Music, YouTube
 * Music, Tidal, Deezer...), Apple TV and HomePod, Sonos, Plex, Jellyfin and other players.
 *
 *   type: custom:glasshome-music-card
 *   entity: media_player.kitchen_speaker   # the player music comes from
 *   service: apple_music                   # apple_music | music_assistant | other (name and icon only)
 *   rows: 2                                # rows of six covers per page (default 1)
 *
 * The library is whatever the player's integration lets Home Assistant browse: the top level becomes the
 * category chips (Playlists first when there is one), folders open in place, and a cover plays on the player.
 * Players that cannot be browsed still show what's playing and the controls.
 */
const MU_SERVICES = {
  apple_music: { name: "Apple Music", icon: "apple" },
  music_assistant: { name: "Music", icon: "music-box-multiple-outline" },
  other: { name: "Music", icon: "music" },
};
const MU_FRESH = 1800000, MU_RETRY = 300000;

class GlassHomeMusicCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    this._config = { rows: 1, ...config };
    this._svc = MU_SERVICES[config.service] || MU_SERVICES.other;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._click(e));
      this.shadowRoot.addEventListener("change", (e) => this._change(e));
    }
    this._cats = null;     // [{ title, id, type }] from the top level
    this._cat = 0;         // chosen chip
    this._path = [];       // folders opened inside the chip: [{ title, id, type }]
    this._lib = {};        // "id|type" -> { at, items, failed }
    this._page = 0;
    this._key = null;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first || !this._cats) this._loadRoot();
    if (!this._hidden) this._update();
  }

  getCardSize() { return 9; }

  connectedCallback() {
    if (!this._io && "IntersectionObserver" in window) {
      this._io = new IntersectionObserver((es) => es.forEach((e) => {
        this._hidden = !e.isIntersecting;
        if (!this._hidden && this._hass) { this._key = null; this._update(); }
        this._timer();
      }));
      this._io.observe(this);
    }
  }

  disconnectedCallback() {
    if (this._io) { this._io.disconnect(); this._io = null; }
    this._hidden = true;
    this._timer();
  }

  _st() { return this._hass && this._hass.states[this._config.entity]; }
  _has(f) { const s = this._st(); return !!s && ((s.attributes.supported_features || 0) & f) === f; }
  _name() { const s = this._st(); return (s && s.attributes.friendly_name) || this._config.entity; }

  _timer() {
    const on = !this._hidden && this.isConnected && this._st() && this._st().state === "playing";
    if (on && !this._t) this._t = setInterval(() => this._tick(), 1000);
    if (!on && this._t) { clearInterval(this._t); this._t = null; }
  }

  _pos() {
    const s = this._st(), a = s.attributes;
    if (a.media_position == null) return null;
    let p = a.media_position;
    if (s.state === "playing" && a.media_position_updated_at) p += (Date.now() - new Date(a.media_position_updated_at)) / 1000;
    return Math.min(p, a.media_duration || p);
  }

  _tick() {
    const r = this.shadowRoot, cur = r && r.getElementById("cur"), seek = r && r.getElementById("seek");
    if (!cur || !seek || this._seeking) return;
    const p = this._pos() || 0;
    cur.textContent = spTime(p);
    seek.value = p;
    seek.style.setProperty("--p", `${((p / (Number(seek.max) || 1)) * 100).toFixed(2)}%`);
  }

  // ---------------------------------------------------------------- library
  async _browse(id, type) {
    const msg = { type: "media_player/browse_media", entity_id: this._config.entity };
    if (id) { msg.media_content_id = id; msg.media_content_type = type; }
    return this._hass.callWS(msg);
  }

  async _loadRoot() {
    if (this._rootLoading || !this._hass || !this._has(SP_F.browse)) return;
    if (this._rootFailedAt && Date.now() - this._rootFailedAt < MU_RETRY) return;
    this._rootLoading = true;
    try {
      const r = await this._browse();
      const kids = (r && r.children) || [];
      const folders = kids.filter((x) => x.can_expand && x.title);
      if (folders.length) {
        this._cats = folders.slice(0, 8).map((x) => ({ title: x.title, id: x.media_content_id, type: x.media_content_type }));
        const pl = this._cats.findIndex((c) => /playlist/i.test(c.title));
        this._cat = pl >= 0 ? pl : 0;
      } else {
        // a flat library: the top level is the only page
        this._cats = [{ title: (r && r.title) || "Library", id: r && r.media_content_id, type: r && r.media_content_type, items: kids }];
        this._cat = 0;
      }
      this._rootFailedAt = 0;
    } catch (e) {
      this._rootFailedAt = Date.now();
      this._err = `Your library couldn't be loaded (${spError(e)}). It tries again in a few minutes.`;
    }
    this._rootLoading = false;
    this._key = null;
    this._update();
    this._loadItems();
  }

  _here() {
    if (!this._cats || !this._cats[this._cat]) return null;
    return this._path.length ? this._path[this._path.length - 1] : this._cats[this._cat];
  }

  async _loadItems() {
    const f = this._here();
    if (!f || this._itemsLoading) return;
    const k = `${f.id}|${f.type}`, have = this._lib[k];
    if (f.items && !have) { this._lib[k] = { at: Date.now(), items: this._map(f.items) }; this._key = null; this._update(); return; }
    if (have && Date.now() - have.at < (have.failed ? MU_RETRY : MU_FRESH)) return;
    this._itemsLoading = true;
    try {
      const r = await this._browse(f.id, f.type);
      this._lib[k] = { at: Date.now(), items: this._map((r && r.children) || []) };
    } catch (e) {
      this._lib[k] = { at: Date.now(), items: [], failed: true };
    }
    this._itemsLoading = false;
    this._key = null;
    this._update();
  }

  _map(kids) {
    const pic = (u) => (u && u.startsWith("/") ? this._hass.hassUrl(u) : u || "");
    return kids.filter((x) => x.title && (x.can_play || x.can_expand))
      .map((x) => ({ t: x.title, id: x.media_content_id, type: x.media_content_type, img: pic(x.thumbnail), play: !!x.can_play, open: !!x.can_expand }));
  }

  // ---------------------------------------------------------------- actions
  _call(service, data = {}) {
    return this._hass.callService("media_player", service, { entity_id: this._config.entity, ...data });
  }

  _run(p) {
    this._err = "";
    return Promise.resolve(p).catch((e) => { this._err = `That didn't work: ${spError(e)}`; this._key = null; this._update(); });
  }

  _click(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const s = this._st(), a = (s && s.attributes) || {}, v = b.dataset.v;
    switch (b.dataset.act) {
      case "play": return this._run(this._call(s.state === "playing" ? "media_pause" : this._has(SP_F.play) ? "media_play" : "media_play_pause"));
      case "prev": return this._run(this._call("media_previous_track"));
      case "next": return this._run(this._call("media_next_track"));
      case "shuffle": return this._run(this._call("shuffle_set", { shuffle: !a.shuffle }));
      case "repeat": return this._run(this._call("repeat_set", { repeat: a.repeat === "off" || !a.repeat ? "all" : a.repeat === "all" ? "one" : "off" }));
      case "mute": return this._run(this._call("volume_mute", { is_volume_muted: !a.is_volume_muted }));
      case "vol": {
        const now = a.volume_level != null ? a.volume_level : 0.3;
        return this._run(this._call("volume_set", { volume_level: Math.max(0, Math.min(1, Math.round((now + Number(v) * 0.05) * 100) / 100)) }));
      }
      case "cat": this._cat = Number(v); this._path = []; this._page = 0; this._key = null; this._update(); return this._loadItems();
      case "up": this._path.pop(); this._page = 0; this._key = null; this._update(); return this._loadItems();
      case "page": this._page = Math.max(0, this._page + Number(v)); this._key = null; this._update(); return;
      case "dismiss": this._err = ""; this._key = null; this._update(); return;
      case "item": {
        const f = this._here(), it = f && ((this._lib[`${f.id}|${f.type}`] || {}).items || [])[Number(v)];
        if (!it) return;
        if (it.play) return this._run(this._call("play_media", { media_content_id: it.id, media_content_type: it.type }));
        this._path.push({ title: it.t, id: it.id, type: it.type });
        this._page = 0; this._key = null; this._update();
        return this._loadItems();
      }
      case "retry": this._rootFailedAt = 0; this._err = ""; return this._loadRoot();
      default:
    }
  }

  _change(e) {
    if (e.target.id !== "seek") return;
    this._run(this._call("media_seek", { seek_position: Number(e.target.value) }));
  }

  // ---------------------------------------------------------------- drawing
  _update() {
    if (!this._hass || !this.shadowRoot) return;
    const s = this._st();
    if (!s) {
      this.shadowRoot.innerHTML = `<ha-card style="padding:20px;color:#fff;border-radius:26px">${esc(this._svc.name)}: the player ${esc(this._config.entity)} was not found in Home Assistant. Choose it again in Settings, Media and music.</ha-card>`;
      return;
    }
    const a = s.attributes, f = this._here(), lib = f ? this._lib[`${f.id}|${f.type}`] : null;
    const key = JSON.stringify([s.state, a.media_title, a.media_artist, a.entity_picture, a.volume_level, a.is_volume_muted, a.shuffle, a.repeat, a.media_duration,
      a.media_position_updated_at, a.supported_features, this._cat, this._path.length, this._page, lib && lib.at, !!this._cats, this._err]);
    if (key === this._key) return;
    this._key = key;
    this._render();
    this._timer();
  }

  _render() {
    const c = this._config, s = this._st(), a = s.attributes, svc = this._svc, here = this._here();
    const lib = here ? this._lib[`${here.id}|${here.type}`] : null;
    const on =s.state === "playing", active = ["playing", "paused"].includes(s.state), off = ["off", "unavailable", "unknown"].includes(s.state);
    const pic = a.entity_picture ? (a.entity_picture.startsWith("/") ? this._hass.hassUrl(a.entity_picture) : a.entity_picture) : "";
    const dur = a.media_duration || 0, pos = this._pos() || 0;
    const vol = a.volume_level != null ? Math.round(a.volume_level * 100) : null, muted = !!a.is_volume_muted;
    const volOk = !off && (this._has(SP_F.volume) || this._has(8));
    const tone = active ? (on ? STATUS.green : STATUS.purple) : off ? STATUS.grey : STATUS.grey;
    const status = s.state === "unavailable" ? `${this._name()} is unavailable` : off ? `${this._name()} is off` : active ? `${on ? "Playing" : "Paused"} on ${this._name()}` : `Ready · ${this._name()}`;
    const dis = (fl) => (this._has(fl) && !off ? "" : "disabled");
    // library
    const rows = Number(c.rows) || 1, per = SP_PER_PAGE * rows;
    const items = (lib && lib.items) || [], pages = Math.max(1, Math.ceil(items.length / per));
    if (this._page >= pages) this._page = pages - 1;
    const shown = items.slice(this._page * per, this._page * per + per);
    const canBrowse = this._has(SP_F.browse);
    const empty = !canBrowse ? `${esc(this._name())} can't list its music in Home Assistant, so only what's playing is shown. Music Assistant players can.`
      : this._rootFailedAt ? `Your library couldn't be loaded. <button class="lk" data-act="retry">Try again</button>`
      : !this._cats || !lib ? "Loading your library…" : lib.failed ? "This part of your library couldn't be loaded. It tries again in a few minutes."
      : "Nothing here yet.";
    const tiles = shown.length ? shown.map((x, i) => `<button class="tile" data-act="item" data-v="${this._page * per + i}" aria-label="${esc(x.play ? `Play ${x.t}` : `Open ${x.t}`)}">
        <span class="ti" style="${x.img ? `background-image:url('${esc(x.img)}')` : ""}">${x.img ? "" : hcIcon(x.play ? "music" : "folder-music-outline")}<i>${hcIcon(x.play ? "play" : "chevron-right")}</i></span><span class="tn">${esc(x.t)}</span></button>`).join("")
      : `<div class="empty">${empty}</div>`;
    const chips = this._cats && this._cats.length > 1 ? this._cats.map((k, i) => `<button class="${this._cat === i && !this._path.length ? "on" : ""}" data-act="cat" data-v="${i}">${esc(k.title)}</button>`).join("") : "";
    const crumb = this._path.length ? `<button class="on" data-act="up" aria-label="Back">${hcIcon("arrow-left")} ${esc(this._path[this._path.length - 1].title)}</button>` : "";
    this.shadowRoot.innerHTML = `<style>
        :host { display: block; }
        ha-card { position: relative; box-sizing: border-box; padding: 16px; border-radius: 26px; color: #fff; overflow: hidden;
          background: radial-gradient(80% 120% at 0% 0%, rgba(139,92,246,0.22) 0%, transparent 60%), ${GLASS_BG}; border: ${GLASS_BORDER};
          box-shadow: ${GLASS_EDGE}; -webkit-tap-highlight-color: transparent; user-select: none; -webkit-user-select: none; }
        button { font: inherit; color: #e9e5f5; border: 0; cursor: pointer; background: rgba(255,255,255,0.07); border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center; touch-action: manipulation; -webkit-tap-highlight-color: transparent; padding: 0; }
        button:disabled { opacity: 0.35; cursor: default; }
        button:active:not(:disabled) { transform: scale(0.95); }
        .top { display: grid; grid-template-columns: 158px minmax(0, 1fr); gap: 18px; align-items: start; }
        .art { width: 158px; height: 158px; border-radius: 20px; background: #1d1636 center / cover no-repeat; box-shadow: 0 10px 30px rgba(0,0,0,0.45), 0 0 26px rgba(139,92,246,0.18);
          display: flex; align-items: center; justify-content: center; color: #6b5f99; --mdc-icon-size: 64px; }
        .st { display: flex; align-items: center; gap: 7px; font-size: 13px; color: rgb(${tone}); font-weight: 600; min-width: 0; }
        .st i { width: 8px; height: 8px; border-radius: 4px; background: rgb(${tone}); flex: none; }
        .st span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .t { font-size: 21px; font-weight: 700; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s { font-size: 15px; color: #c9c4dc; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .svc { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: #c4b5fd; background: rgba(139,92,246,0.16); border-radius: 10px; padding: 3px 9px; margin-top: 8px; --mdc-icon-size: 15px; }
        .hd { display: grid; grid-template-columns: minmax(0, 1fr); }
        .pr { margin-top: 8px; display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px; gap: 8px; align-items: center; }
        .tm { font-size: 12px; color: #a29db8; font-variant-numeric: tabular-nums; } .tm.r { text-align: right; }
        input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 26px; margin: 0; background: transparent; touch-action: none; }
        input[type=range]::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #a78bfa var(--p, 0%), rgba(255,255,255,0.14) var(--p, 0%)); }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; margin-top: -6px; background: #fff; box-shadow: 0 0 10px rgba(139,92,246,0.6); }
        input[type=range]:disabled { opacity: 0.4; }
        .cr { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 2px; flex-wrap: wrap; }
        .ctl { display: flex; align-items: center; justify-content: center; gap: 10px; }
        .ctl button { width: 50px; height: 50px; --mdc-icon-size: 26px; background: transparent; }
        .ctl button.sm { width: 46px; height: 46px; --mdc-icon-size: 22px; color: #a29db8; }
        .ctl button.sm.on { color: #c4b5fd; background: rgba(139,92,246,0.18); }
        .ctl .pp { width: 58px; height: 58px; --mdc-icon-size: 36px; background: linear-gradient(160deg, #8b5cf6, #6d28d9); box-shadow: 0 6px 20px rgba(109,40,217,0.45); }
        .vol { display: flex; align-items: center; gap: 6px; flex: none; }
        .vol button { width: 46px; height: 46px; --mdc-icon-size: 22px; flex: none; } .vol button.on { color: #fbbf24; background: rgba(251,191,36,0.15); }
        .vv { width: 44px; text-align: center; font-variant-numeric: tabular-nums; } .vv b { display: block; font-size: 17px; } .vv small { display: block; font-size: 10.5px; color: #a29db8; margin-top: -2px; }
        .err { margin-top: 10px; padding: 10px 12px; border-radius: 14px; background: rgba(255,107,107,0.14); color: #ffb4b4; font-size: 13.5px; display: flex; gap: 10px; align-items: center; }
        .err span { flex: 1; } .err button { border-radius: 10px; padding: 6px 10px; font-size: 13px; }
        .lib { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.07); }
        .lh { display: flex; align-items: center; gap: 6px; }
        .lt { font-size: 15px; font-weight: 700; margin-right: 6px; flex: none; }
        .chips { display: flex; gap: 6px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
        .chips::-webkit-scrollbar { display: none; }
        .chips button { border-radius: 14px; height: 40px; padding: 0 12px; font-size: 13.5px; font-weight: 600; color: #c9c4dc; white-space: nowrap; flex: none; gap: 4px; --mdc-icon-size: 18px; }
        .chips button.on { color: #fff; background: linear-gradient(160deg, rgba(139,92,246,0.75), rgba(109,40,217,0.55)); }
        .pg { width: 40px; height: 40px; --mdc-icon-size: 22px; flex: none; }
        .tiles { display: grid; grid-template-columns: repeat(${SP_PER_PAGE}, minmax(0, 1fr)); gap: 10px; margin-top: 8px; min-height: ${128 * rows + 10 * (rows - 1)}px; }
        .tile { border-radius: 16px; background: transparent; display: block; text-align: left; padding: 0; }
        .ti { position: relative; display: flex; align-items: center; justify-content: center; aspect-ratio: 1; border-radius: 14px; background: #1d1636 center / cover no-repeat;
          box-shadow: 0 6px 16px rgba(0,0,0,0.35); color: #6b5f99; --mdc-icon-size: 34px; }
        .ti i { position: absolute; right: 6px; bottom: 6px; width: 34px; height: 34px; border-radius: 50%; background: rgba(109,40,217,0.9); color: #fff;
          display: flex; align-items: center; justify-content: center; --mdc-icon-size: 20px; }
        .tn { display: block; font-size: 12.5px; font-weight: 600; margin-top: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e9e5f5; }
        .ln { display: flex; justify-content: space-between; font-size: 12px; color: #8e8aa0; margin-top: 4px; }
        .empty { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; gap: 8px; color: #a29db8; font-size: 14px; text-align: center; padding: 0 12px; }
        .lk { border-radius: 10px; padding: 6px 10px; font-size: 13px; }
        ${NARROW_CSS_SPOTIFY}
      </style>
      <ha-card>
        <div class="top">
          <div class="art" style="${pic && active ? `background-image:url('${esc(pic)}')` : ""}">${pic && active ? "" : hcIcon(svc.icon)}</div>
          <div style="min-width:0">
            <div class="hd"><div style="min-width:0"><div class="st"><i></i><span>${esc(status)}</span></div>
            <div class="t">${esc(active && a.media_title ? a.media_title : svc.name === "Music" ? "Nothing playing" : svc.name)}</div>
            <div class="s">${active ? esc([a.media_artist, a.media_album_name].filter(Boolean).join(" · ")) : canBrowse ? "Choose music below or press Play" : "Start music on the player and it shows here"}</div>
            <div class="svc">${hcIcon(svc.icon)}${esc(svc.name === "Music" ? (c.service === "music_assistant" ? "Music Assistant" : "Music") : svc.name)} · ${esc(this._name())}</div></div></div>
            <div class="pr"><span class="tm" id="cur">${active ? spTime(pos) : "–:––"}</span><input id="seek" class="noswipe" type="range" min="0" max="${dur || 1}" step="1" value="${pos}" style="--p:${dur ? ((pos / dur) * 100).toFixed(2) : 0}%" ${active ? dis(SP_F.seek) : "disabled"} aria-label="Position">
              <span class="tm r">${active && dur ? spTime(dur) : "–:––"}</span></div>
            <div class="cr"><div class="ctl">
              <button class="sm ${a.shuffle ? "on" : ""}" data-act="shuffle" ${dis(SP_F.shuffle)} aria-label="Shuffle">${hcIcon(a.shuffle ? "shuffle" : "shuffle-disabled")}</button>
              <button data-act="prev" ${dis(SP_F.prev)} aria-label="Previous track">${hcIcon("skip-previous")}</button>
              <button class="pp" data-act="play" ${off && s.state === "unavailable" ? "disabled" : ""} aria-label="${on ? "Pause" : "Play"}">${hcIcon(on ? "pause" : "play")}</button>
              <button data-act="next" ${dis(SP_F.next)} aria-label="Next track">${hcIcon("skip-next")}</button>
              <button class="sm ${a.repeat && a.repeat !== "off" ? "on" : ""}" data-act="repeat" ${dis(SP_F.repeat)} aria-label="Repeat">${hcIcon(a.repeat === "one" ? "repeat-once" : a.repeat === "all" ? "repeat" : "repeat-off")}</button>
            </div>
            <div class="vol"><button class="${muted ? "on" : ""}" data-act="mute" ${volOk ? "" : "disabled"} aria-label="Mute or unmute">${hcIcon(muted ? "volume-off" : "volume-high")}</button>
              <button data-act="vol" data-v="-1" ${volOk ? "" : "disabled"} aria-label="Volume down">${hcIcon("minus")}</button>
              <span class="vv"><b>${volOk && vol != null ? vol : "–"}</b><small>volume</small></span>
              <button data-act="vol" data-v="1" ${volOk ? "" : "disabled"} aria-label="Volume up">${hcIcon("plus")}</button></div></div>
          </div>
        </div>
        ${this._err ? `<div class="err">${hcIcon("alert-circle-outline")}<span>${esc(this._err)}</span><button data-act="dismiss">OK</button></div>` : ""}
        <div class="lib">
          <div class="lh">${chips || crumb ? `<div class="chips">${crumb}${crumb ? "" : chips}</div>` : `<span class="lt">${esc((this._cats && this._cats[0] && this._cats[0].title) || "Your music")}</span><span style="flex:1"></span>`}
            <button class="pg" data-act="page" data-v="-1" ${this._page > 0 ? "" : "disabled"} aria-label="Previous page">${hcIcon("chevron-left")}</button>
            <button class="pg" data-act="page" data-v="1" ${this._page < pages - 1 ? "" : "disabled"} aria-label="Next page">${hcIcon("chevron-right")}</button></div>
          <div class="tiles">${tiles}</div>
          <div class="ln"><span>${canBrowse ? `Tap to play on ${esc(this._name())}` : ""}</span><span>${items.length > per ? `${this._page + 1} of ${pages}` : ""}</span></div>
        </div>
      </ha-card>`;
  }
}
if (!customElements.get("glasshome-music-card")) customElements.define("glasshome-music-card", GlassHomeMusicCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "glasshome-music-card", name: "Glass Home music", description: "What's playing and your playlists for Apple Music (through Music Assistant or Apple TV), Music Assistant and other players." });
