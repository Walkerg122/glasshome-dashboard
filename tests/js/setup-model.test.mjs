// Tests for the setup wizard's model: discovery, settings building and the built-in weather parser.
// Run with: node --test tests/js
// The model is the plain-function section of the shipped bundle between // @@MODEL-START and // @@MODEL-END,
// so these tests check exactly the code Home Assistant loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bundle = readFileSync(new URL("../../www/glasshome/glasshome-cards.js", import.meta.url), "utf8");
const start = bundle.indexOf("// @@MODEL-START"), end = bundle.indexOf("// @@MODEL-END");
assert.ok(start > 0 && end > start, "the bundle has a model section");
const NAMES = ["GHS_STEPS", "GHS_OM_ENTITY", "ghsKind", "ghsDiscover", "ghsRoomsFromAreas", "ghsNewDraft", "ghsSlug", "ghsUniqueKey", "ghsBuildConfig",
  "ghsDraftFromConfig", "ghsProblems", "ghsToYaml", "ghsWmo", "ghsOpenMeteoParse", "ghsOpenMeteoUrl", "ghsGeocodeUrl", "ghsDetectEnergy", "ghsDetectLaundry", "ghsSceneMatch", "ghsCurrencySymbol"];
const ctx = vm.createContext({ URLSearchParams });
vm.runInContext(`${bundle.slice(start, end)}\nthis.M = { ${NAMES.join(", ")} };`, ctx);
const M = ctx.M;
// objects made inside the vm have their own prototypes; compare as plain JSON
const plain = (x) => JSON.parse(JSON.stringify(x));

// A small fictional home, shaped like Home Assistant's hass object
const st = (state, attributes = {}) => ({ state, attributes });
const HASS = {
  states: {
    "light.lounge": st("on", { friendly_name: "Lounge light", supported_color_modes: ["hs", "color_temp"] }),
    "light.hall": st("off", { friendly_name: "Hall light", supported_color_modes: ["onoff"] }),
    "switch.kettle": st("off", { friendly_name: "Kettle", device_class: "outlet" }),
    "sensor.lounge_temperature": st("20.5", { friendly_name: "Lounge temperature", device_class: "temperature" }),
    "sensor.uptime": st("5", { friendly_name: "Uptime" }),
    "climate.house": st("heat", { friendly_name: "Thermostat" }),
    "camera.door": st("unavailable", { friendly_name: "Door camera" }),
    "weather.home": st("sunny", { friendly_name: "Home" }),
    "light.hidden": st("off", { friendly_name: "Hidden light" }),
    "switch.diag": st("off", { friendly_name: "Diagnostics switch" }),
  },
  entities: {
    "light.lounge": { device_id: "d1", platform: "hue" },
    "light.hall": { device_id: "d2", area_id: "hall", platform: "hue" },
    "light.hidden": { hidden: true },
    "switch.diag": { entity_category: "diagnostic" },
  },
  devices: { d1: { name: "Bulb", name_by_user: "Big bulb", area_id: "lounge" }, d2: { name: "Hall bulb", area_id: null } },
  areas: { lounge: { area_id: "lounge", name: "Living Room", icon: null }, hall: { area_id: "hall", name: "Hallway", icon: "mdi:door" } },
};

test("ghsKind describes devices and ignores things that are not devices", () => {
  const light = M.ghsKind("light.x", { supported_color_modes: ["hs", "color_temp"] });
  assert.equal(light.type, "Light");
  assert.deepEqual(plain(light.controls), ["On / off", "Brightness", "Colour", "Warmth"]);
  assert.deepEqual(plain(M.ghsKind("light.x", { supported_color_modes: ["onoff"] }).controls), ["On / off"]);
  assert.equal(M.ghsKind("switch.x", { device_class: "outlet" }).type, "Smart plug");
  assert.equal(M.ghsKind("cover.x", { device_class: "blind", supported_features: 15 }).type, "Blinds");
  assert.ok(M.ghsKind("cover.x", { device_class: "blind", supported_features: 15 }).controls.includes("Position"));
  assert.equal(M.ghsKind("media_player.x", { device_class: "tv" }).type, "TV");
  assert.equal(M.ghsKind("sensor.x", {}), null, "a sensor without a known class is not offered");
  assert.equal(M.ghsKind("automation.x", {}), null);
});

test("ghsDiscover finds devices with their rooms and skips hidden and diagnostic entities", () => {
  const found = M.ghsDiscover(HASS);
  const ids = plain(found.map((d) => d.id));
  assert.ok(!ids.includes("light.hidden") && !ids.includes("switch.diag") && !ids.includes("sensor.uptime"));
  const lounge = found.find((d) => d.id === "light.lounge");
  assert.equal(lounge.area, "lounge", "the room comes from the device when the entity has none");
  assert.equal(lounge.areaName, "Living Room");
  assert.equal(lounge.device, "Big bulb", "the user's own device name wins");
  assert.equal(found.find((d) => d.id === "light.hall").area, "hall", "the entity's own room wins");
  assert.equal(found.find((d) => d.id === "camera.door").online, false);
  assert.deepEqual(ids, [...ids].sort((a, b) => found.find((d) => d.id === a).name.localeCompare(found.find((d) => d.id === b).name)), "sorted by name");
  assert.deepEqual(plain(M.ghsDiscover(undefined)), []);
});

test("ghsRoomsFromAreas makes a room per area with its devices", () => {
  const rooms = M.ghsRoomsFromAreas(HASS, M.ghsDiscover(HASS));
  assert.deepEqual(plain(rooms.map((r) => r.name)), ["Living Room", "Hallway"]);
  assert.deepEqual(plain(rooms[0].entities), ["light.lounge"]);
  assert.equal(rooms[1].icon, "mdi:door");
});

test("room keys are unique", () => {
  assert.equal(M.ghsSlug("Kitchen & Diner"), "kitchen_diner");
  assert.equal(M.ghsSlug("!!!"), "room");
  assert.equal(M.ghsUniqueKey([{ key: "office" }, { key: "office_2" }], "Office"), "office_3");
});

function sampleDraft() {
  const d = M.ghsNewDraft("Europe/London");
  Object.assign(d.household, { greeting: "Sam", name: "Test House", clock: "12", temperature_unit: "C" });
  d.weather = { source: "open_meteo", entity: "", place: { name: "Testville", latitude: 12.3456, longitude: -45.6789 } }; // fictional, mid-Atlantic  glasshome-validate: allow
  d.rooms = [{ key: "lounge", name: "Lounge", icon: "mdi:sofa-outline", visible: true, entities: ["light.lounge", "switch.kettle"] },
    { key: "hall", name: "Hall", icon: "mdi:door", visible: false, entities: ["light.hall"] }];
  d.devices = { "light.lounge": { favourite: true, name: "Big light" }, "switch.kettle": { as_light: true } };
  return d;
}

test("ghsBuildConfig turns a draft into settings and keeps what the wizard does not manage", () => {
  const prev = { floorplan: { arch: { walls: [1, 2] } }, demo: true };
  const cfg = M.ghsBuildConfig(sampleDraft(), prev, { states: HASS.states, entities: HASS.entities, now: "2026-01-01T00:00:00.000Z" });
  assert.equal(cfg.demo, undefined, "a saved setup is never a demo");
  assert.deepEqual(plain(cfg.floorplan), { arch: { walls: [1, 2] } });
  assert.equal(cfg.setup.complete, true);
  assert.equal(cfg.setup.completed, "2026-01-01T00:00:00.000Z");
  assert.equal(cfg.household.greeting, "Sam");
  assert.equal(cfg.household.clock, 12);
  assert.equal(cfg.weather.provider, "open_meteo");
  assert.ok(cfg.favourites.includes("light.lounge"));
});

test("ghsBuildConfig keeps the first completion time when settings are saved again", () => {
  const first = M.ghsBuildConfig(sampleDraft(), {}, { now: "2026-01-01T00:00:00.000Z" });
  const again = M.ghsBuildConfig(sampleDraft(), first, { now: "2026-06-01T00:00:00.000Z" });
  assert.equal(again.setup.completed, "2026-01-01T00:00:00.000Z");
});

test("news is only switched on when its integration is installed", () => {
  const d = sampleDraft();
  d.features.news = true;
  const without = M.ghsBuildConfig(d, {}, { states: {}, services: { todo: {} } });
  assert.notEqual(without.features && without.features.news, true);
  const withIt = M.ghsBuildConfig(d, {}, { states: {}, services: { glasshome_news: { fetch: {} } } });
  assert.equal(withIt.features.news, true);
});

test("settings -> draft -> settings round trip keeps the user's choices", () => {
  const ctx = { states: HASS.states, entities: HASS.entities, now: "2026-01-01T00:00:00.000Z" };
  const cfg = M.ghsBuildConfig(sampleDraft(), {}, ctx);
  const d2 = M.ghsDraftFromConfig(cfg, "Europe/London");
  assert.equal(d2.household.greeting, "Sam");
  assert.equal(d2.household.clock, "12");
  assert.equal(d2.weather.source, "open_meteo");
  assert.equal(d2.weather.place.name, "Testville");
  assert.ok(d2.rooms.some((r) => r.name === "Lounge" && r.entities.includes("light.lounge")));
  assert.equal(d2.devices["light.lounge"].favourite, true);
  assert.equal(d2.devices["switch.kettle"].favourite, undefined, "homepage lights are not all favourites");
  const hall = d2.rooms.find((r) => r.name === "Hall");
  assert.ok(hall && hall.visible === false && hall.entities.includes("light.hall"), "a hidden room comes back hidden, with its devices");
  assert.ok(!cfg.rooms.some((r) => r.name === "Hall"), "a hidden room is not on the dashboard");
  const cfg2 = M.ghsBuildConfig(d2, cfg, ctx);
  assert.deepEqual(plain(cfg2), plain(cfg));
});

test("scene buttons are matched to scenes by name, keeping choices already made", () => {
  const states = {
    "scene.movie_night": st("2026-01-01", { friendly_name: "Movie night" }),
    "scene.bright_lights": st("2026-01-01", { friendly_name: "Bright" }),
    "scene.goodnight": st("2026-01-01", { friendly_name: "Goodnight" }),
    "scene.wind_down": st("2026-01-01", { friendly_name: "Relax" }),
    "light.lounge": st("on", {}),
  };
  const m = plain(M.ghsSceneMatch(states, { relax: "scene.goodnight" }));
  assert.equal(m.film, "scene.movie_night");
  assert.equal(m.bright, "scene.bright_lights");
  assert.equal(m.relax, "scene.goodnight", "a button you already set is left alone");
  assert.equal(m.night, undefined, '"Goodnight" is not matched to night by part of a word');
  assert.ok(!Object.values(m).includes("light.lounge"));
});

test("music service, page names and currency are saved and read back", () => {
  const ctx = { states: { ...HASS.states, "media_player.kitchen": st("idle", { friendly_name: "Kitchen speaker" }) }, entities: HASS.entities, now: "2026-01-01T00:00:00.000Z" };
  const d = sampleDraft();
  d.features.music = true;
  d.choices.music_service = "apple_music";
  d.choices.music_player = "media_player.kitchen";
  d.appearance.titles = { lights: "Lamps", home: "Home", media: "  <b>Tunes</b>  " };
  d.household.currency = "EUR";
  const cfg = M.ghsBuildConfig(d, {}, ctx);
  assert.deepEqual(plain(cfg.media.music), { service: "apple_music", player: "media_player.kitchen" });
  assert.equal(cfg.features.music, true);
  assert.notEqual(cfg.features.spotify, true, "Apple Music replaces Spotify");
  assert.deepEqual(plain(cfg.navigation.titles), { lights: "Lamps", media: "bTunes/b" }, "unchanged names are not stored; tags are stripped");
  assert.equal(cfg.household.currency, "EUR");
  const d2 = M.ghsDraftFromConfig(cfg, "Europe/London");
  assert.equal(d2.choices.music_service, "apple_music");
  assert.equal(d2.choices.music_player, "media_player.kitchen");
  assert.equal(d2.appearance.titles.lights, "Lamps");
  assert.equal(d2.household.currency, "EUR");
  assert.deepEqual(plain(M.ghsBuildConfig(d2, cfg, ctx)), plain(cfg));
  const none = M.ghsBuildConfig({ ...d, choices: { ...d.choices, music_player: "" } }, {}, ctx);
  assert.notEqual(none.features.music, true, "music needs a player");
  d.household.currency = "euros";
  assert.equal(M.ghsBuildConfig(d, {}, ctx).household.currency, undefined, "only three-letter codes are kept");
  assert.equal(M.ghsCurrencySymbol("EUR", "en-GB"), "€");
});

test("a room with no devices yet is kept for Settings but not put on the dashboard", () => {
  const ctx = { states: HASS.states, entities: HASS.entities, now: "2026-01-01T00:00:00.000Z" };
  const d = sampleDraft();
  d.rooms.push({ key: "study", name: "Study", icon: "mdi:desk", visible: true, entities: [] });
  const cfg = M.ghsBuildConfig(d, {}, ctx);
  assert.ok(!cfg.rooms.some((r) => r.name === "Study"), "an empty room is not drawn on the dashboard");
  assert.deepEqual(plain(cfg.setup.empty_rooms), [{ name: "Study", icon: "mdi:desk" }]);
  const d2 = M.ghsDraftFromConfig(cfg, "Europe/London");
  assert.ok(d2.rooms.some((r) => r.name === "Study" && r.visible && !r.entities.length), "it comes back in Settings");
  assert.deepEqual(plain(M.ghsBuildConfig(d2, cfg, ctx)), plain(cfg));
});

test("ghsProblems lists what stops the setup being saved", () => {
  const d = sampleDraft();
  assert.deepEqual(plain(M.ghsProblems(d)), []);
  d.weather = { source: "open_meteo", entity: "", place: null };
  d.rooms.push({ key: "x", name: "lounge", entities: [] }, { key: "y", name: " ", entities: [] });
  const steps = plain(M.ghsProblems(d).map((p) => p.step));
  assert.deepEqual(steps, ["weather", "rooms", "rooms"]);
  assert.deepEqual(plain(M.ghsProblems({ weather: { source: "entity", entity: "" } })).map((p) => p.step), ["weather"]);
});

test("the person is only saved when Home or away is switched on", () => {
  const d = sampleDraft();
  d.choices.person = "person.alex";
  d.features.presence = false;
  let cfg = plain(M.ghsBuildConfig(d));
  assert.equal(cfg.presence, undefined);
  assert.equal(cfg.features.presence, false);
  d.features.presence = true;
  cfg = plain(M.ghsBuildConfig(d));
  assert.deepEqual(cfg.presence, { person: "person.alex" });
  assert.equal(cfg.features.presence, true);
});

test("ghsProblems flags Home or away and Cameras switched on with nothing chosen", () => {
  const base = { weather: { source: "entity", entity: "weather.home" }, rooms: [] };
  const texts = (f, c) => plain(M.ghsProblems({ ...base, features: f, choices: c }).map((p) => p.step + ":" + p.text.split(" ")[0]));
  assert.deepEqual(texts({ presence: true, cctv: true }, { person: "", cameras: [] }), ["features:Home", "features:Cameras"]);
  assert.deepEqual(texts({ presence: true, cctv: true }, { person: "person.alex", cameras: ["camera.door"] }), []);
  assert.deepEqual(texts({ presence: false, cctv: false }, { person: "", cameras: [] }), []);
});

test("ghsDiscover treats a never-used scene as online, but an unavailable one as offline", () => {
  const states = {
    "scene.film": { state: "unknown", attributes: { friendly_name: "Film" } },
    "scene.gone": { state: "unavailable", attributes: { friendly_name: "Gone" } },
    "light.lamp": { state: "unknown", attributes: { friendly_name: "Lamp" } },
  };
  const on = Object.fromEntries(plain(M.ghsDiscover({ states })).map((d) => [d.id, d.online]));
  assert.deepEqual(on, { "scene.film": true, "scene.gone": false, "light.lamp": false });
});

test("ghsToYaml writes YAML that keeps types and quotes risky strings", () => {
  const y = M.ghsToYaml({ glasshome: { a: "plain", b: "yes", c: "12", d: 12, e: true, f: null, g: ["x", "y"], h: [{ name: "Room: 1", n: 2 }], i: {}, j: [] } });
  assert.match(y, /\n {2}a: plain/);
  assert.match(y, /\n {2}b: "yes"/);
  assert.match(y, /\n {2}c: "12"/);
  assert.match(y, /\n {2}d: 12/);
  assert.match(y, /\n {2}e: true/);
  assert.match(y, /\n {2}f: null/);
  assert.match(y, /\n {2}g: \[x, y\]/);
  assert.match(y, /\n {4}- name: "Room: 1"\n {6}n: 2/);
  assert.match(y, /\n {2}i: \{\}/);
  assert.match(y, /\n {2}j: \[\]/);
});

test("ghsWmo maps weather codes to Home Assistant conditions", () => {
  assert.equal(M.ghsWmo(0, true), "sunny");
  assert.equal(M.ghsWmo(0, false), "clear-night");
  assert.equal(M.ghsWmo(2), "partlycloudy");
  assert.equal(M.ghsWmo(45), "fog");
  assert.equal(M.ghsWmo(63), "rainy");
  assert.equal(M.ghsWmo(82), "pouring");
  assert.equal(M.ghsWmo(75), "snowy");
  assert.equal(M.ghsWmo(95), "lightning-rainy");
  assert.equal(M.ghsWmo(1234), "exceptional");
});

test("the weather request sends only a rounded location", () => {
  const u = new URL(M.ghsOpenMeteoUrl({ latitude: 12.34567, longitude: -45.67891 }, { temperature: "°F", distance: "mi" })); // fictional  glasshome-validate: allow
  assert.equal(u.hostname, "api.open-meteo.com");
  assert.equal(u.searchParams.get("latitude"), "12.35");
  assert.equal(u.searchParams.get("longitude"), "-45.68");
  assert.equal(u.searchParams.get("temperature_unit"), "fahrenheit");
  assert.equal(u.searchParams.get("wind_speed_unit"), "mph");
  assert.deepEqual([...u.searchParams.keys()].filter((k) => !["latitude", "longitude", "current", "hourly", "daily", "timezone", "forecast_days",
    "forecast_hours", "temperature_unit", "wind_speed_unit", "precipitation_unit", "timeformat"].includes(k)), []);
  const g = new URL(M.ghsGeocodeUrl("  Testville  "));
  assert.equal(g.searchParams.get("name"), "Testville");
});

test("ghsOpenMeteoParse makes a Home Assistant style weather entity", () => {
  const t0 = 1767225600; // 2026-01-01 00:00 UTC
  const hours = [t0, t0 + 3600, t0 + 7200];
  const j = {
    current: { time: t0 + 600, temperature_2m: 7.26, relative_humidity_2m: 80, apparent_temperature: 4.4, dew_point_2m: 4, precipitation: 0, weather_code: 3,
      cloud_cover: 90, pressure_msl: 1012.4, wind_speed_10m: 12.3, wind_direction_10m: 200, wind_gusts_10m: 30, is_day: 0 },
    hourly: { time: hours, temperature_2m: [7, 8, 9], relative_humidity_2m: [80, 81, 82], apparent_temperature: [4, 5, 6], dew_point_2m: [3, 3, 3],
      precipitation_probability: [10, 20, 30], precipitation: [0, 0.2, 1], weather_code: [3, 61, 0], cloud_cover: [90, 80, 10], wind_speed_10m: [12, 13, 14],
      wind_direction_10m: [200, 210, 220], wind_gusts_10m: [30, 31, 32], uv_index: [0, 0.5, 1], is_day: [0, 1, 1] },
    daily: { time: [t0], weather_code: [61], temperature_2m_max: [10.04], temperature_2m_min: [2.96], precipitation_sum: [3.2], precipitation_probability_max: [70],
      wind_speed_10m_max: [20], wind_direction_10m_dominant: [210], wind_gusts_10m_max: [40], uv_index_max: [1.2], sunrise: [t0 + 28800], sunset: [t0 + 57600] },
  };
  const r = M.ghsOpenMeteoParse(j, { name: "Testville" }, {});
  assert.equal(r.state, "cloudy");
  assert.equal(r.attributes.friendly_name, "Testville");
  assert.equal(r.attributes.temperature, 7.3);
  assert.equal(r.attributes.temperature_unit, "°C");
  assert.equal(r.attributes.precipitation_probability, 10);
  assert.equal(r.hourly.length, 3);
  assert.equal(r.hourly[1].condition, "rainy");
  assert.equal(r.daily[0].temperature, 10);
  assert.equal(r.daily[0].templow, 3);
  assert.equal(r.updated, (t0 + 600) * 1000);
  assert.throws(() => M.ghsOpenMeteoParse({ current: {} }, null), /incomplete/);
});

test("energy and laundry detection only report complete setups", () => {
  assert.equal(M.ghsDetectEnergy({}), null);
  const e = M.ghsDetectEnergy({ "sensor.octopus_energy_electricity_abc123_456_current_demand": {}, "sensor.octopus_energy_electricity_abc123_456_current_rate": {} });
  assert.equal(e.electricity.demand, "sensor.octopus_energy_electricity_abc123_456_current_demand");
  assert.equal(e.gas, undefined);
  assert.equal(M.ghsDetectLaundry({ "sensor.washer_machine_state": {} }), null, "needs the job state too");
  const l = M.ghsDetectLaundry({ "sensor.washer_machine_state": {}, "sensor.washer_job_state": {} });
  assert.equal(l.helpers, false);
  assert.equal(l.config.machine_state, "sensor.washer_machine_state");
});

test("the wizard steps start at welcome and end at done", () => {
  assert.equal(M.GHS_STEPS[0], "welcome");
  assert.equal(M.GHS_STEPS.at(-1), "done");
  assert.equal(M.GHS_OM_ENTITY, "weather.glasshome_forecast");
});
