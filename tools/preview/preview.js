// Glass Home preview: a small stand-in for the Home Assistant frontend so the cards can be seen and
// tested with fictional data. Only what the cards use is imitated; standard Home Assistant cards
// (tile, button, markdown, ...) are drawn as simple look-alikes. Not used in a real installation.
import { parse } from "https://cdn.jsdelivr.net/npm/yaml@2.5.1/browser/index.js";
import * as MDI from "https://cdn.jsdelivr.net/npm/@mdi/js@7.4.47/mdi.js";

// ------------------------------------------------------------------ settings and entities
// The fictional home comes from the cards' own demo mode (glasshome: { demo: true }), exactly as in a real
// Home Assistant. Cookie ghcfg=none previews a fresh install: no glasshome: section, so the setup wizard
// opens, with a small fictional "real" home (below) for it to discover. Saving in the wizard keeps the
// settings in this browser (localStorage); open /glass-home/home?reset to start again. ghcfg=example uses
// config/glasshome-config.example.yaml, whose entity ids mostly match that fictional home.
const now = Date.now(), iso = (ms) => new Date(ms).toISOString();
const mode = (/(?:^|;\s*)ghcfg=(\w+)/.exec(document.cookie) || [])[1] || "demo";
const SAVED_KEY = "glasshome.preview.saved";
if (new URLSearchParams(location.search).has("reset")) {
  for (const k of Object.keys(localStorage)) if (k.startsWith("glasshome.preview.")) localStorage.removeItem(k);
  try { sessionStorage.clear(); } catch (e) { /* nothing kept */ }
}
const saved = (() => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "null"); } catch (e) { return null; } })();
const GLASSHOME = mode === "none" ? saved : mode === "example"
  ? parse(await (await fetch("/config/glasshome-config.example.yaml", { cache: "no-store" })).text())
  : { demo: true };
const states = {};

// ------------------------------------------------------------------ a fictional "real" home (fresh install and example modes)
// What Home Assistant's registries would say about a small home: rooms (areas), devices and entities.
const AREAS = { living_room: "Living Room", kitchen: "Kitchen", bedroom: "Bedroom", hallway: "Hallway", garden: "Garden" };
const HOME = [
  // [entity id, state, attributes, area, integration]
  ["light.living_room", "on", { friendly_name: "Living room ceiling", brightness: 200, supported_color_modes: ["color_temp", "hs"], color_mode: "hs" }, "living_room", "hue"],
  ["light.floor_lamp", "off", { friendly_name: "Floor lamp", supported_color_modes: ["brightness"] }, "living_room", "hue"],
  ["switch.tv_led_strip", "on", { friendly_name: "TV LED strip" }, "living_room", "tplink"],
  ["sensor.tv_led_strip_power", "4.2", { friendly_name: "TV LED strip power", device_class: "power", unit_of_measurement: "W" }, "living_room", "tplink"],
  ["media_player.living_room_tv", "playing", { friendly_name: "Living room TV", device_class: "tv", media_title: "Nature documentary", volume_level: 0.3 }, "living_room", "cast"],
  ["remote.living_room_tv", "on", { friendly_name: "Living room TV remote" }, "living_room", "androidtv_remote"],
  ["sensor.living_room_temperature", "20.6", { friendly_name: "Living room temperature", device_class: "temperature", unit_of_measurement: "°C" }, "living_room", "shelly"],
  ["climate.living_room", "heat", { friendly_name: "Thermostat", current_temperature: 20.4, temperature: 21, hvac_action: "heating", hvac_modes: ["off", "heat"], min_temp: 7, max_temp: 30 }, "hallway", "generic_thermostat"],
  ["sensor.hallway_temperature", "19.8", { friendly_name: "Hallway temperature", device_class: "temperature", unit_of_measurement: "°C" }, "hallway", "shelly"],
  ["light.hallway", "off", { friendly_name: "Hallway light", supported_color_modes: ["onoff"] }, "hallway", "tplink"],
  ["binary_sensor.front_door", "off", { friendly_name: "Front door", device_class: "door" }, "hallway", "shelly"],
  ["light.kitchen_ceiling", "off", { friendly_name: "Kitchen ceiling", supported_color_modes: ["brightness"] }, "kitchen", "hue"],
  ["switch.kitchen_led_strip", "off", { friendly_name: "Kitchen LED strip" }, "kitchen", "tplink"],
  ["sensor.kitchen_led_strip_power", "0", { friendly_name: "Kitchen LED strip power", device_class: "power", unit_of_measurement: "W" }, "kitchen", "tplink"],
  ["light.bedroom", "off", { friendly_name: "Bedroom light", supported_color_modes: ["color_temp"] }, "bedroom", "hue"],
  ["cover.bedroom_blinds", "open", { friendly_name: "Bedroom blinds", device_class: "blind", supported_features: 15, current_position: 100 }, "bedroom", "shelly"],
  ["camera.front_door", "idle", { friendly_name: "Front door camera" }, null, "generic"],
  ["camera.garden", "idle", { friendly_name: "Garden camera" }, "garden", "generic"],
  ["sensor.garden_temperature", "unavailable", { friendly_name: "Garden temperature", device_class: "temperature", unit_of_measurement: "°C" }, null, "shelly"],
  ["weather.forecast_home", "partlycloudy", { friendly_name: "Forecast Home", temperature: 13, temperature_unit: "°C", humidity: 76, wind_speed: 14, wind_speed_unit: "km/h", supported_features: 3 }, null, "met"],
  ["person.alex", "home", { friendly_name: "Alex" }, null, "person"],
  ["scene.relax", "unknown", { friendly_name: "Relax" }, null, "homeassistant"],
  ["scene.bright", "unknown", { friendly_name: "Bright" }, null, "homeassistant"],
  ["todo.shopping", "2", { friendly_name: "Shopping list" }, null, "local_todo"],
  ["calendar.bin_collections", "off", { friendly_name: "Bin collections", message: "Recycling" }, null, "remote_calendar"],
  ["sensor.home_power", "412", { friendly_name: "Home power", device_class: "power", unit_of_measurement: "W", state_class: "measurement" }, null, "shelly"],
  ["sensor.home_energy", "18342.6", { friendly_name: "Home energy", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }, null, "shelly"],
  ["sensor.gas_meter", "40211.3", { friendly_name: "Gas meter", device_class: "energy", unit_of_measurement: "kWh", state_class: "total_increasing" }, null, "hildebrand_glow_dcc"],
  ["media_player.spotify_alex", "paused", { friendly_name: "Spotify Alex", media_title: "Morning mix", media_artist: "Various artists", volume_level: 0.4,
    source_list: ["Living room speaker", "Living room TV", "Alex's laptop"], source: "Living room speaker", shuffle: false, repeat: "off", supported_features: 444983 }, null, "spotify"],
  ["media_player.kitchen_speaker", "paused", { friendly_name: "Kitchen speaker", media_title: "Sunday morning", media_artist: "The Fictional Trio", media_album_name: "Made-up songs",
    media_duration: 214, media_position: 63, media_position_updated_at: iso(now), volume_level: 0.35, is_volume_muted: false, shuffle: false, repeat: "off", supported_features: 4127295 }, null, "music_assistant"],
  ["sun.sun", "above_horizon", { friendly_name: "Sun", next_rising: iso(now + 14 * 3600e3), next_setting: iso(now + 3 * 3600e3), elevation: 12 }, null, "sun"],
];
const REG = { entities: {}, devices: {}, areas: Object.fromEntries(Object.entries(AREAS).map(([area_id, name]) => [area_id, { area_id, name, icon: null }])) };
if (mode !== "demo") {
  for (const [id, state, attributes, area, platform] of HOME) {
    states[id] = { entity_id: id, state, attributes, last_changed: iso(now - 3600e3), last_updated: iso(now - 600e3), context: { id: "preview" } };
    const dev = `dev_${id.replace(".", "_")}`;
    REG.devices[dev] = { id: dev, name: attributes.friendly_name, name_by_user: null, area_id: area };
    REG.entities[id] = { entity_id: id, device_id: dev, area_id: null, platform, hidden: false, entity_category: null };
  }
}
const ENTRIES = [["hue", "Hue Bridge", "loaded"], ["tplink", "TP-Link plugs", "loaded"], ["cast", "Google Cast", "loaded"], ["met", "Home", "loaded"],
  ["androidtv_remote", "Living room TV", "loaded"], ["spotify", "Alex", "loaded"], ["remote_calendar", "Bin collections", "loaded"], ["music_assistant", "Music Assistant", "loaded"], ["shelly", "Shelly garden sensor", "setup_retry"]]
  .map(([domain, title, state], i) => ({ entry_id: `e${i}`, domain, title, state, reason: state === "setup_retry" ? "Device did not answer" : null }));
const FLOWS = [{ flow_id: "f1", handler: "esphome", context: { source: "zeroconf", title_placeholders: { name: "Garage sensor" } } }];
const services = { media_player: { play_media: {}, select_source: {}, media_play_pause: {} }, light: { turn_on: {}, turn_off: {}, toggle: {} }, switch: { turn_on: {}, turn_off: {}, toggle: {} }, homeassistant: { turn_on: {}, turn_off: {}, toggle: {} },
  scene: { turn_on: {} }, script: { turn_on: {} }, glasshome_news: { fetch: {} }, todo: { get_items: {}, add_item: {} } };

// fictional news feed so the reader can be seen without fetching anything
const RSS = (cat) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Demo</title>${Array.from({ length: 8 }, (_, i) => `<item>
  <title>Placeholder ${cat} headline ${i + 1}: an example story for the preview</title><link>https://example.com/${cat}/${i + 1}</link>
  <description>This is fictional placeholder text standing in for a real news summary.</description><pubDate>${new Date(now - i * 47 * 60e3).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;

// ------------------------------------------------------------------ Home Assistant stand-ins
const pascal = (n) => `mdi${n.replace(/(^|-)([a-z0-9])/g, (m, a, b) => b.toUpperCase())}`;
customElements.define("ha-icon", class extends HTMLElement {
  static get observedAttributes() { return ["icon"]; }
  set icon(v) { this.setAttribute("icon", v); }
  get icon() { return this.getAttribute("icon"); }
  connectedCallback() { this._draw(); }
  attributeChangedCallback() { this._draw(); }
  _draw() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const name = (this.getAttribute("icon") || "").replace(/^mdi:/, "");
    const d = MDI[pascal(name)] || MDI.mdiHelpCircleOutline;
    this.shadowRoot.innerHTML = `<style>:host{display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;fill:currentColor;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px)}svg{width:100%;height:100%}</style><svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  }
});
customElements.define("ha-card", class extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML = `<style>:host{display:block;box-sizing:border-box;background:var(--ha-card-background);border-radius:var(--ha-card-border-radius);border:1px solid var(--ha-card-border-color);box-shadow:var(--ha-card-box-shadow);color:var(--primary-text-color)}</style><slot></slot>`;
  }
});

const DOMAIN_ICON = { light: "lightbulb", switch: "toggle-switch-outline", sensor: "eye", climate: "thermostat", camera: "cctv", scene: "palette-outline",
  media_player: "television", person: "account", weather: "weather-partly-cloudy", input_number: "ray-vertex", schedule: "calendar-clock", automation: "robot" };
const ON = (s) => ["on", "playing", "heat", "home", "open"].includes(s);
class MockCard extends HTMLElement {
  setConfig(c) { this._c = c; }
  set hass(h) { this._h = h; this._draw(); }
  getGridOptions() { return { columns: ["tile", "button"].includes(this._c.type) ? 6 : 12 }; }
  _draw() {
    const c = this._c, h = this._h, st = c.entity && h.states[c.entity];
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const name = c.name || (st && st.attributes.friendly_name) || c.heading || "";
    const icon = c.icon || (c.entity ? `mdi:${DOMAIN_ICON[c.entity.split(".")[0]] || "circle-outline"}` : "mdi:gesture-tap");
    const on = st && ON(st.state);
    const css = `<style>:host{display:block;height:100%}ha-card{height:100%;padding:12px 14px;display:flex;gap:12px;align-items:center;font-size:14px}
      .i{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(${on ? "139,92,246,0.35" : "255,255,255,0.08"});flex:none}
      .s{color:var(--secondary-text-color);font-size:12.5px}.md{display:block;padding:14px 16px}.md h1{margin:0;font-size:30px}.md p{margin:6px 0 0;color:#d6d1ea}
      .cam{aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#2a2347,#151026);color:#8e8aa0}
      .head{background:none;border:0;box-shadow:none;font-size:20px;font-weight:700;padding:14px 4px 0}.v{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}</style>`;
    let body;
    switch (c.type) {
      case "heading": body = `<ha-card class="head">${name}</ha-card>`; break;
      case "markdown": {
        const md = String(c.content || "").replace(/\{%-?[\s\S]*?-?%\}/g, "").replace(/\{\{[\s\S]*?\}\}/g, "…").replace(/<ha-icon[^>]*><\/ha-icon>/g, "")
          .split("\n").filter((l) => l.trim()).map((l) => (l.startsWith("# ") ? `<h1>${l.slice(2)}</h1>` : `<p>${l.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}</p>`)).join("");
        body = md ? `<ha-card class="md">${md}</ha-card>` : ""; break;
      }
      case "picture-entity": body = `<ha-card class="cam"><ha-icon icon="mdi:cctv"></ha-icon>&nbsp;${name} (live view)</ha-card>`; break;
      case "thermostat": body = `<ha-card class="v" style="min-height:220px"><div class="s">${name}</div><div style="font-size:54px;font-weight:700">${st ? st.attributes.current_temperature : "–"}°</div><div class="s">Target ${st ? st.attributes.temperature : "–"}° · ${st ? st.attributes.hvac_action : ""}</div></ha-card>`; break;
      case "media-control": body = `<ha-card><div class="i"><ha-icon icon="mdi:television-play"></ha-icon></div><div><b>${name}</b><div class="s">${st ? `${st.state} · ${st.attributes.media_title || ""}` : ""}</div></div></ha-card>`; break;
      case "button": body = `<ha-card class="v" style="min-height:92px;gap:6px"><div class="i"><ha-icon icon="${icon}"></ha-icon></div>${c.show_name === false ? "" : `<b>${name}</b>`}</ha-card>`; break;
      case "horizontal-stack": case "vertical-stack": case "grid": body = `<div style="display:grid;gap:8px;grid-auto-flow:${c.type === "horizontal-stack" ? "column" : "row"}"></div>`; break;
      default: body = `<ha-card${c.vertical ? ' class="v"' : ""}><div class="i"><ha-icon icon="${icon}"></ha-icon></div><div><b>${name || c.type}</b><div class="s">${st ? `${st.state}${st.attributes.unit_of_measurement ? ` ${st.attributes.unit_of_measurement}` : ""}` : c.entity ? "not found" : ""}</div></div></ha-card>`;
    }
    this.shadowRoot.innerHTML = css + body;
    if (c.cards) {
      const box = this.shadowRoot.querySelector("div");
      for (const sub of c.cards) { const el = createCardElement(sub); el.hass = h; box.append(el); }
    }
    const card = this.shadowRoot.querySelector("ha-card");
    if (card && c.entity && /^(light|switch)\./.test(c.entity)) card.onclick = () => h.callService("homeassistant", "toggle", { entity_id: c.entity });
    if (card && c.tap_action && c.tap_action.action === "navigate") card.onclick = () => go(c.tap_action.navigation_path);
  }
}
customElements.define("gh-mock-card", MockCard);
const errorCard = (msg) => { const el = document.createElement("gh-mock-card"); el.setConfig({ type: "error", name: `Error: ${msg}` }); return el; };
function createCardElement(cfg) {
  if (String(cfg.type).startsWith("custom:")) {
    const tag = cfg.type.slice(7), el = document.createElement(tag);
    const apply = () => { try { el.setConfig(cfg); } catch (e) { console.error(tag, e); } };
    if (customElements.get(tag)) apply(); else customElements.whenDefined(tag).then(apply);
    return el;
  }
  const el = document.createElement("gh-mock-card");
  el.setConfig(cfg);
  return el;
}
window.loadCardHelpers = async () => ({ createCardElement });

// ------------------------------------------------------------------ hass object
let hass;
const listeners = new Set();
const push = () => { hass = { ...hass, states: { ...states } }; listeners.forEach((f) => f(hass)); };
const forecast = Array.from({ length: 6 }, (_, i) => ({ datetime: iso(now + i * 86400e3), condition: ["partlycloudy", "rainy", "sunny", "cloudy", "sunny", "rainy"][i],
  temperature: [15, 12, 16, 13, 17, 11][i], templow: [8, 7, 9, 6, 10, 6][i], precipitation_probability: [10, 70, 0, 20, 5, 60][i] }));
const callWS = async (m) => {
  if (m.type === "frontend/get_system_data") { try { return { value: JSON.parse(localStorage.getItem(`glasshome.preview.sd.${mode}.${m.key}`) || "null") }; } catch (e) { return { value: null }; } }
  if (m.type === "frontend/set_system_data") { localStorage.setItem(`glasshome.preview.sd.${mode}.${m.key}`, JSON.stringify(m.value)); return {}; }
  if (m.type === "frontend/get_user_data") { try { return { value: JSON.parse(localStorage.getItem(`glasshome.preview.ud.${m.key}`) || "null") }; } catch (e) { return { value: null }; } }
  if (m.type === "frontend/set_user_data") { localStorage.setItem(`glasshome.preview.ud.${m.key}`, JSON.stringify(m.value)); return {}; }
  if (/^frontend\/get_/.test(m.type)) return { value: null };
  if (/^frontend\/set_/.test(m.type)) return {};
  if (m.type === "schedule/list") return [];
  if (m.type === "lovelace/config") {
    const own = mode === "none" ? JSON.parse(localStorage.getItem(SAVED_KEY) || "null") : GLASSHOME;
    return own ? { ...DASH, glasshome: own } : DASH;
  }
  if (m.type === "lovelace/config/save") {
    if (mode !== "none") throw Object.assign(new Error("The preview only saves in fresh-install mode (cookie ghcfg=none)"), { code: "home_assistant_error" });
    localStorage.setItem(SAVED_KEY, JSON.stringify(m.config.glasshome || null));
    return null;
  }
  if (m.type === "config_entries/get") return ENTRIES;
  if (m.type === "config_entries/flow/progress") return FLOWS;
  if (m.type === "call_service" && m.domain === "glasshome_news") return { response: { status: 200, content: RSS((/\/([a-z]+)[^/]*$/.exec(m.service_data.url) || [, "news"])[1]) } };
  if (m.type === "call_service" && m.domain === "todo") return { response: { [m.target ? m.target.entity_id : "todo.glasshome_news"]: { items: [] } } };
  if (m.type === "media_player/browse_media") {
    if (m.entity_id !== "media_player.kitchen_speaker") return { children: [] };
    // a small made-up Music Assistant library: categories, then playlists and albums
    const item = (title, id, type, play, expand) => ({ title, media_content_id: id, media_content_type: type, can_play: play, can_expand: expand, thumbnail: null });
    if (!m.media_content_id) return { title: "Music Assistant", children: [item("Playlists", "playlists", "playlists", false, true), item("Albums", "albums", "albums", false, true), item("Radio", "radios", "radios", false, true)] };
    if (m.media_content_id === "playlists") return { title: "Playlists", children: ["Sunday morning", "Kitchen disco", "Focus", "Rainy day", "Road trip", "Lullabies", "Workout", "Dinner party"].map((t, i) => item(t, `playlist/${i}`, "playlist", true, true)) };
    if (m.media_content_id === "albums") return { title: "Albums", children: ["Made-up songs", "Imaginary hits"].map((t, i) => item(t, `album/${i}`, "album", true, true)) };
    if (m.media_content_id === "radios") return { title: "Radio", children: [] };
    return { children: [] };
  }
  if (m.type === "energy/get_prefs") return { energy_sources: [{ type: "grid", flow_from: [{ stat_energy_from: "sensor.home_energy", stat_cost: null }], flow_to: [] }, { type: "gas", stat_energy_from: "sensor.gas_meter" }], device_consumption: [] };
  if (m.type === "recorder/statistics_during_period") {
    // 5-minute changes since the start time: a steady fictional use
    const out = {}, t0 = Date.parse(m.start_time), n = Math.max(1, Math.floor((Date.now() - t0) / 300e3));
    for (const id of m.statistic_ids || []) {
      const per = id.includes("gas") ? 0.06 : 0.035;
      out[id] = Array.from({ length: Math.min(n, 2000) }, (_, i) => ({ start: t0 + i * 300e3, end: t0 + (i + 1) * 300e3, change: per, sum: per * (i + 1) }));
    }
    return out;
  }
  return {};
};
hass = {
  states: { ...states }, services, user: { is_admin: true, name: mode === "demo" ? "Demo" : "Alex" }, language: "en", locale: { language: "en-GB" }, themes: {},
  config: { time_zone: "Europe/London", version: "2026.11.0", unit_system: { temperature: "°C" } },
  entities: REG.entities, devices: REG.devices, areas: REG.areas,
  callService: async (domain, service, data = {}) => {
    const ids = [].concat(data.entity_id || []);
    for (const id of ids) {
      const s = states[id];
      if (!s) continue;
      if (service === "toggle") s.state = s.state === "on" ? "off" : "on";
      if (service === "turn_on") s.state = "on";
      if (service === "turn_off") s.state = "off";
      if (domain === "media_player") {
        const a = s.attributes = { ...s.attributes };
        if (service === "media_play" || (service === "media_play_pause" && s.state !== "playing")) s.state = "playing";
        else if (service === "media_pause" || service === "media_play_pause") s.state = "paused";
        if (service === "play_media") { s.state = "playing"; a.media_title = String(data.media_content_id).startsWith("playlist/") ? "First song on the playlist" : "First song"; a.media_position = 0; a.media_position_updated_at = new Date().toISOString(); }
        if (service === "volume_set") a.volume_level = data.volume_level;
        if (service === "volume_mute") a.is_volume_muted = data.is_volume_muted;
        if (service === "shuffle_set") a.shuffle = data.shuffle;
        if (service === "repeat_set") a.repeat = data.repeat;
      }
    }
    push();
  },
  callWS, callApi: async (method, path) => {
    if (/config_entries\/entry\/e5\/reload/.test(path)) throw new Error("Device did not answer");
    if (/^calendars\/calendar\.bin_collections/.test(path)) {
      // fortnightly alternating collections from the coming Tuesday, as a council calendar would list them
      const d = new Date(); d.setDate(d.getDate() + ((9 - d.getDay()) % 7 || 7));
      return Array.from({ length: 8 }, (_, i) => { const x = new Date(d.getTime() + i * 7 * 86400e3), day = x.toISOString().slice(0, 10);
        return { summary: i % 2 ? "Recycling and garden waste" : "General waste and food", start: { date: day }, end: { date: day } }; });
    }
    return {};
  },
  connection: {
    sendMessagePromise: callWS,
    subscribeMessage: (cb, m) => { if (m.type === "weather/subscribe_forecast") setTimeout(() => cb({ forecast: m.forecast_type === "hourly" ? [] : forecast }), 50); return Promise.resolve(() => {}); },
  },
};

// ------------------------------------------------------------------ dashboard rendering
// (the !include line is a Home Assistant YAML tag; here the settings come from GLASSHOME above)
const DASH = parse((await (await fetch("/dashboards/glasshome.yaml", { cache: "no-store" })).text()).replace(/^glasshome: !include .*$/m, ""));
const haEl = document.createElement("home-assistant");
haEl.hass = hass;
haEl.hidden = true;
document.body.append(haEl);
listeners.add((h) => { haEl.hass = h; });
await import("/local/glasshome/glasshome-cards.js");
await import("/local/glasshome/glasshome-news.js");
await import("/tools/preview/layout-check.js");
await import("/tools/preview/responsive-check.js");

const root = document.getElementById("view");
let mounted = [];
listeners.add((h) => mounted.forEach((el) => { el.hass = h; }));
const go = (path) => { history.pushState(null, "", path); window.dispatchEvent(new CustomEvent("location-changed")); };
const spanOf = (cfg, el) => {
  const g = cfg.grid_options || (el.getGridOptions && el.getGridOptions()) || {};
  const c = g.columns === "full" ? 12 : Number(g.columns) || 12;
  return Math.max(1, Math.min(12, c > 12 ? Math.round(c / 2) : c));
};
function render() {
  const path = location.pathname.split("/")[2] || "home";
  const view = DASH.views.find((v) => v.path === path) || DASH.views[0];
  mounted = [];
  root.replaceChildren();
  root.className = view.type === "panel" ? "panel" : "sections";
  const add = (parent, cfg) => {
    const el = createCardElement(cfg);
    el.hass = hass;
    mounted.push(el);
    parent.append(el);
    requestAnimationFrame(() => { el.style.gridColumn = `span ${spanOf(cfg, el)}`; });
    el.addEventListener("card-visibility-changed", (e) => { if (e.detail && e.detail.value === false) el.style.display = "none"; });
    return el;
  };
  if (view.type === "panel") { add(root, view.cards[0]); return; }
  const cols = Math.max(1, Math.min(view.max_columns || 4, Math.floor(window.innerWidth / 420) || 1));
  root.style.setProperty("--cols", cols);
  for (const s of view.sections || []) {
    const sec = document.createElement("div");
    sec.className = "section";
    sec.style.gridColumn = `span ${Math.min(cols, s.column_span || 1)}`;
    root.append(sec);
    for (const c of s.cards || []) add(sec, c);
  }
}
let last = location.pathname;
window.addEventListener("location-changed", () => { if (location.pathname !== last) { last = location.pathname; render(); } });
window.addEventListener("popstate", () => { last = location.pathname; render(); });
document.addEventListener("hass-more-info", (e) => console.info("more-info", e.detail && e.detail.entityId));
// in demo mode the cards draw their own demo label; this one marks the other modes as a preview
if (new URLSearchParams(location.search).has("shot") || mode === "demo") document.querySelector(".demo-flag").remove();
render();
// ?page=<id> opens that homepage page (for screenshots)
{
  const want = new URLSearchParams(location.search).get("page");
  if (want) setTimeout(() => {
    const pager = document.querySelector("glasshome-pager-card");
    const i = pager && pager._config ? pager._config.pages.findIndex((p) => p.id === want) : -1;
    if (i >= 0) pager._go(i, false);
  }, 1500);
}
