// Demo isolation: demo mode must not send ANY state-changing request to the real Home Assistant.
// Run with: node --test tests/js
//
// This runs the shipped bundle's own adapter and guard code (the section between @@DEMO-GUARD-START and
// @@DEMO-GUARD-END in www/glasshome/glasshome-cards.js) against a mocked Home Assistant: a WebSocket
// connection shaped like home-assistant-js-websocket's (sendMessagePromise -> sendMessage), a hass object
// whose callApi goes through window.fetch like Home Assistant's frontend, and a recording fetch. Nothing here
// talks to a real Home Assistant. Every test checks what actually reached the mock "server", not just the UI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bundle = readFileSync(new URL("../../www/glasshome/glasshome-cards.js", import.meta.url), "utf8");
const start = bundle.indexOf("// @@DEMO-GUARD-START"), end = bundle.indexOf("// @@DEMO-GUARD-END");
assert.ok(start > 0 && end > start, "the demo guard section markers are in the bundle");
const SECTION = bundle.slice(start, end);

const DEMO_LAMP = "light.demo_lounge_lamp";
const READ_TYPES = new Set(["get_states", "get_config", "get_services", "lovelace/config", "frontend/get_user_data", "frontend/get_system_data",
  "config/entity_registry/list_for_display", "config/device_registry/list", "config/area_registry/list", "config_entries/get",
  "config_entries/flow/progress", "history/history_during_period", "recorder/statistics_during_period", "schedule/list", "energy/get_prefs",
  "media_player/browse_media", "weather/subscribe_forecast", "subscribe_entities", "auth/sign_path", "render_template", "ping"]);

// A fresh page: the guard code, a mocked Home Assistant and a log of everything that reached it.
function page({ demo = true, path = "/glasshome/home", guardRoot = true } = {}) {
  const sent = [], toasts = [];
  let n = 0;
  // shaped like home-assistant-js-websocket: sendMessagePromise and subscribeMessage both go through this.sendMessage
  const conn = {
    commands: new Map(),
    sendMessage(m, id) { sent.push({ via: "ws", type: m.type, m }); if (id != null) queueMicrotask(() => { const c = this.commands.get(id); if (c) { this.commands.delete(id); c.resolve({ ok: true }); } }); },
    sendMessagePromise(m) { const id = ++n; return new Promise((resolve, reject) => { this.commands.set(id, { resolve, reject }); this.sendMessage(m, id); }); },
    subscribeMessage(cb, m) { return this.sendMessagePromise(m).then(() => () => {}); },
  };
  const realFetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    sent.push({ via: "fetch", method: String(init.method || (input && input.method) || "GET").toUpperCase(), url });
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const ctx = vm.createContext({
    URL, Request, console: { info() {}, log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, queueMicrotask, Promise, JSON, Date, Math,
    location: { pathname: path, href: `http://ha.test${path}` },
    customElements: { get: () => undefined, whenDefined: () => new Promise(() => {}) },
    addEventListener() {},
    fetch: realFetch,
    __env: { demo, toasts },
  });
  ctx.window = ctx;
  // Home Assistant's frontend: hass.callApi -> fetchWithAuth -> window.fetch (looked up when called)
  const hass = {
    states: { "light.kitchen": { entity_id: "light.kitchen", state: "off", attributes: {} } },
    user: { is_admin: true },
    connection: conn,
    callWS: (m) => conn.sendMessagePromise(m),
    callService: (domain, service, service_data, target) => conn.sendMessagePromise({ type: "call_service", domain, service, service_data, target }),
    callApi: (method, p, body) => ctx.window.fetch(`/api/${p}`, { method, body: body && JSON.stringify(body) }).then((r) => r.json()),
    callApiRaw: (method, p) => ctx.window.fetch(`/api/${p}`, { method }),
    fetchWithAuth: (p, init) => ctx.window.fetch(p, init),
  };
  ctx.document = { querySelector: (s) => (s === "home-assistant" ? { hass } : null) };
  vm.runInContext(`
    const GH_DEMO = __env.demo, ghExploring = false, GH_LOADED = { path: "glasshome", cfg: {} }, GH_ASSETS = "http://ha.test/local/glasshome/";
    let GH_CFG = {};
    const ghDashPath = () => location.pathname.split("/")[1] || "lovelace";
    const ghToast = (t) => __env.toasts.push(t);
    const GH_DEMO_STATES = GH_DEMO ? { "${DEMO_LAMP}": { entity_id: "${DEMO_LAMP}", state: "off", attributes: { brightness: 0 } } } : {};
    const GH_DEMO_TODO = [];
    let GH_DEMO_VER = 0;
    const GH_LIVE = new Set();
    const ghIsDemo = (id) => typeof id === "string" && id in GH_DEMO_STATES;
    ${SECTION}
    this.G = { ghHass, ghDemoGuardRoot, ghDemoReadOnly, GH_DEMO_STATES };
  `, ctx);
  if (guardRoot) ctx.G.ghDemoGuardRoot();
  const writes = () => sent.filter((x) => (x.via === "fetch" ? !/^(GET|HEAD)$/.test(x.method) : !READ_TYPES.has(x.type)));
  return { G: ctx.G, hass, conn, ctx, sent, toasts, writes, cards: ctx.G.ghHass(hass) };
}
const settle = (p) => Promise.resolve(p).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
const tick = () => new Promise((r) => setTimeout(r, 5));

// Every way a card, the setup wizard, Settings or Home Assistant's own cards could send an action
const SERVICES = [
  ["lighting", "light", "turn_on", { entity_id: "light.kitchen", brightness_pct: 80 }],
  ["lighting", "light", "toggle", { entity_id: "light.kitchen" }],
  ["heating", "climate", "set_temperature", { entity_id: "climate.hall", temperature: 25 }],
  ["heating", "climate", "set_hvac_mode", { entity_id: "climate.hall", hvac_mode: "heat" }],
  ["heating boost", "hive", "boost_heating_on", { entity_id: "climate.hall", time_period: "01:00:00", temperature: 22 }],
  ["camera", "camera", "turn_off", { entity_id: "camera.front_door" }],
  ["camera", "camera", "snapshot", { entity_id: "camera.front_door", filename: "/config/www/x.jpg" }],
  ["camera", "camera", "enable_motion_detection", { entity_id: "camera.front_door" }],
  ["lock", "lock", "unlock", { entity_id: "lock.front_door" }],
  ["lock", "lock", "lock", { entity_id: "lock.front_door" }],
  ["alarm", "alarm_control_panel", "alarm_disarm", { entity_id: "alarm_control_panel.house", code: "1234" }],
  ["alarm", "alarm_control_panel", "alarm_arm_away", { entity_id: "alarm_control_panel.house" }],
  ["script", "script", "turn_on", { entity_id: "script.goodnight" }],
  ["script", "script", "goodnight", {}],
  ["automation", "automation", "trigger", { entity_id: "automation.morning" }],
  ["automation", "automation", "turn_off", { entity_id: "automation.morning" }],
  ["automation", "automation", "reload", {}],
  ["notification", "notify", "mobile_app_phone", { message: "hello" }],
  ["notification", "persistent_notification", "create", { message: "hello" }],
  ["scene", "scene", "turn_on", { entity_id: "scene.reading_nook" }],
  ["media", "media_player", "volume_set", { entity_id: "media_player.lounge", volume_level: 1 }],
  ["no target", "homeassistant", "restart", {}],
  ["integration", "homeassistant", "reload_config_entry", { entry_id: "abc123" }],
];
// privileged WebSocket commands (device configuration, entities, integrations, dashboards, storage)
const WS_WRITES = [
  { type: "execute_script", sequence: [{ service: "light.turn_on", target: { entity_id: "light.kitchen" } }] },
  { type: "fire_event", event_type: "glasshome_test" },
  { type: "config/entity_registry/update", entity_id: "light.kitchen", name: "Renamed" },
  { type: "config/entity_registry/remove", entity_id: "light.kitchen" },
  { type: "config/device_registry/update", device_id: "d1", name_by_user: "Renamed" },
  { type: "config/area_registry/create", name: "New room" },
  { type: "config_entries/update", entry_id: "abc123", pref_disable_polling: true },
  { type: "config_entries/disable", entry_id: "abc123", disabled_by: "user" },
  { type: "lovelace/config/save", url_path: "glasshome", config: { views: [] } },
  { type: "lovelace/config/delete", url_path: "glasshome" },
  { type: "frontend/set_user_data", key: "glasshome_setup_glasshome", value: {} },
  { type: "frontend/set_system_data", key: "glasshome_layout", value: {} },
  { type: "schedule/update", schedule_id: "heating", name: "Heating" },
  { type: "conversation/process", text: "unlock the front door" },
  { type: "assist_pipeline/run", start_stage: "intent", end_stage: "intent", input: { text: "turn on the lights" } },
  { type: "auth/long_lived_access_token", client_name: "x", lifespan: 10 },
  { type: "todo/item/move", entity_id: "todo.shopping", uid: "1" },
];
// privileged REST calls (how Settings > Connect your devices > Retry reloads an integration)
const REST_WRITES = [
  ["POST", "config/config_entries/entry/abc123/reload"],
  ["DELETE", "config/config_entries/entry/abc123"],
  ["POST", "config/config_entries/flow"],
  ["POST", "services/light/turn_on"],
  ["POST", "states/light.kitchen"],
  ["POST", "events/glasshome_test"],
  ["POST", "config/core/check_config"],
  ["PUT", "config/automation/config/morning"],
];

test("integration Retry: the reload request never reaches Home Assistant in demo mode", async () => {
  // the setup wizard and Settings use Home Assistant's own hass object, so this is caught at the fetch layer
  const P = page();
  const r = await settle(P.hass.callApi("POST", "config/config_entries/entry/abc123/reload"));
  assert.equal(r.ok, false);
  assert.equal(r.e.code, "glasshome_demo");
  // and through the cards' adapted hass object
  const r2 = await settle(P.cards.callApi("POST", "config/config_entries/entry/abc123/reload"));
  assert.equal(r2.ok, false);
  assert.deepEqual(P.sent, [], "nothing at all was sent");
  assert.ok(P.toasts.some((t) => /Demo mode/.test(t)), "the user is told why");
});

test("integration Retry handler refuses in demo mode before calling Home Assistant", () => {
  const i = bundle.indexOf('case "retry": {');
  assert.ok(i > 0);
  const body = bundle.slice(i, bundle.indexOf("return;", bundle.indexOf("callApi", i)));
  assert.ok(body.indexOf("if (GH_DEMO)") > 0 && body.indexOf("if (GH_DEMO)") < body.indexOf("callApi("), "GH_DEMO is checked before the reload call");
});

test("saving settings and the setup wizard refuse in demo mode before reading or writing the dashboard", () => {
  assert.match(bundle, /async function ghSaveSettings\(hass, change\) \{\n  if \(GH_DEMO\) throw ghDemoSaveError\(\);/);
  assert.match(bundle, /async _writeConfig\(cfg\) \{\n    if \(GH_DEMO\) throw ghDemoSaveError\(\);/);
});

for (const [kind, domain, service, data] of SERVICES) {
  test(`demo: ${kind} action ${domain}.${service} is never sent, by any route`, async () => {
    const P = page();
    const m = { type: "call_service", domain, service, service_data: data };
    await settle(P.cards.callService(domain, service, data)); // a Glass Home card
    await settle(P.cards.callWS(m)); // a card using callWS
    await settle(P.cards.connection.sendMessagePromise(m)); // a card using the connection
    await settle(P.hass.callService(domain, service, data)); // Home Assistant's own cards and the wizard (raw hass)
    await settle(P.conn.sendMessagePromise(m)); // the shared connection itself
    await settle(P.cards.callApi("POST", `services/${domain}/${service}`, data)); // REST
    await settle(P.hass.callApi("POST", `services/${domain}/${service}`, data));
    await tick();
    assert.deepEqual(P.writes(), []);
    assert.deepEqual(P.sent, []);
  });
}

for (const m of WS_WRITES) {
  test(`demo: privileged command ${m.type} is refused at every layer`, async () => {
    const P = page();
    for (const send of [(x) => P.cards.callWS(x), (x) => P.cards.connection.sendMessagePromise(x), (x) => P.hass.callWS(x),
      (x) => P.conn.sendMessagePromise(x), (x) => P.conn.subscribeMessage(() => {}, x), (x) => P.cards.connection.subscribeMessage(() => {}, x)]) {
      const r = await settle(send({ ...m }));
      // a script is answered like a blocked action (as before); everything else fails rather than pretending to succeed
      if (m.type === "execute_script") assert.ok(!r.ok || (r.v && r.v.context && r.v.context.id === "demo-blocked"));
      else assert.equal(r.ok, false, `${m.type} must fail, not pretend to succeed`);
    }
    // the lowest level: a raw send with a pending command is rejected, not left hanging
    const pending = new Promise((resolve, reject) => { P.conn.commands.set(999, { resolve, reject }); });
    P.conn.sendMessage({ ...m }, 999);
    assert.equal((await settle(pending)).ok, false);
    await tick();
    assert.deepEqual(P.sent, []);
  });
}

for (const [method, p] of REST_WRITES) {
  test(`demo: REST ${method} /api/${p} is refused (callApi, callApiRaw, fetchWithAuth, fetch)`, async () => {
    const P = page();
    for (const call of [() => P.cards.callApi(method, p), () => P.hass.callApi(method, p), () => P.cards.callApiRaw(method, p),
      () => P.cards.fetchWithAuth(`/api/${p}`, { method }), () => P.hass.fetchWithAuth(`http://ha.test/api/${p}`, { method }),
      () => P.ctx.window.fetch(new Request(`http://ha.test/api/${p}`, { method }))]) {
      assert.equal((await settle(call())).ok, false);
    }
    assert.deepEqual(P.sent, []);
  });
}

test("demo: the cards' own guard works even before the shared connection is patched", async () => {
  const P = page({ guardRoot: false });
  for (const m of WS_WRITES) await settle(P.cards.callWS({ ...m }));
  for (const [, domain, service, data] of SERVICES) await settle(P.cards.callService(domain, service, data));
  for (const [method, p] of REST_WRITES) await settle(P.cards.callApi(method, p));
  assert.deepEqual(P.sent, []);
});

test("demo: actions on demo devices are simulated in the browser only", async () => {
  const P = page();
  const r = await P.cards.callService("light", "turn_on", { entity_id: DEMO_LAMP, brightness_pct: 50 });
  assert.equal(r.context.id, "demo");
  assert.equal(P.G.GH_DEMO_STATES[DEMO_LAMP].state, "on");
  await P.conn.sendMessagePromise({ type: "call_service", domain: "light", service: "turn_off", service_data: { entity_id: DEMO_LAMP } });
  assert.equal(P.G.GH_DEMO_STATES[DEMO_LAMP].state, "off");
  assert.deepEqual(P.sent, []);
});

test("demo: reads still work, so the dashboard, history, charts and setup can load", async () => {
  const P = page();
  for (const type of READ_TYPES) assert.equal((await settle(P.conn.sendMessagePromise({ type }))).ok, true, type);
  assert.equal((await settle(P.cards.callWS({ type: "history/history_during_period" }))).ok, true);
  assert.equal((await settle(P.cards.callApi("GET", "calendars/calendar.bins?start=a&end=b"))).ok, true);
  // signing in again (token refresh) is not a change to the home and must keep working
  assert.equal((await settle(P.ctx.window.fetch("http://ha.test/auth/token", { method: "POST" }))).ok, true);
  await tick();
  assert.deepEqual(P.writes().filter((x) => x.url !== "http://ha.test/auth/token"), []);
});

test("every message type the bundle sends is either a recognised read or refused in demo mode", () => {
  const P = page();
  const types = new Set([...bundle.matchAll(/type: "([a-z_]+(?:\/[a-z_]+)*)"/g)].map((x) => x[1]).filter((t) => t.includes("/") || t.includes("_")));
  types.add("frontend/set_user_data").add("frontend/set_system_data"); // also built as frontend/set_${where}_data
  const writes = [...types].filter((t) => /(^|\/|_)(set|save|update|delete|remove|create|reload|run|process|execute|fire)(_|$)/.test(t));
  assert.ok(writes.length >= 4, `found the bundle's writes: ${writes.join(", ")}`);
  for (const t of writes) assert.equal(P.G.ghDemoReadOnly({ type: t }), false, `${t} must be refused in demo mode`);
  for (const t of types) if (!writes.includes(t) && t.includes("/")) assert.equal(P.G.ghDemoReadOnly({ type: t }), true, `${t} is a read`);
});

test("outside demo mode nothing is blocked: real actions and saves reach Home Assistant", async () => {
  const P = page({ demo: false });
  await P.cards.callService("light", "turn_on", { entity_id: "light.kitchen" });
  await P.hass.callWS({ type: "lovelace/config/save", url_path: "glasshome", config: { views: [{}] } });
  await P.hass.callApi("POST", "config/config_entries/entry/abc123/reload");
  await tick();
  assert.deepEqual(P.sent.map((x) => x.type || `${x.method} ${x.url}`), ["call_service", "lovelace/config/save", "POST /api/config/config_entries/entry/abc123/reload"]);
});

test("demo mode on one dashboard never affects another dashboard's connection or fetch", async () => {
  const P = page({ path: "/lovelace/0" });
  await P.conn.sendMessagePromise({ type: "lovelace/config/save", url_path: null, config: { views: [{}] } });
  await P.hass.callApi("POST", "config/config_entries/entry/abc123/reload");
  await tick();
  assert.equal(P.sent.length, 2);
});
