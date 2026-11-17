// Release safety checks: demo mode only knows fictional devices and never sends an action to a real
// one, and the files people install carry no network addresses, hardware ids or credentials.
// Run with: node --test tests/js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const bundle = read("www/glasshome/glasshome-cards.js");
const block = (start, end) => { const a = bundle.indexOf(start), b = bundle.indexOf(end, a); assert.ok(a > 0 && b > a, `found ${start}`); return bundle.slice(a, b); };
const ENTITY = /["'`]([a-z_]+\.[a-z0-9_]+)["'`]/g;
const DOMAINS = /^(light|switch|sensor|binary_sensor|climate|camera|media_player|person|scene|script|weather|input_[a-z]+|number|select|todo|calendar|remote|counter|schedule|automation|alarm_control_panel|lock|cover|fan|device_tracker)\./;

test("the demo's settings and devices use only demo entities", () => {
  for (const [start, end] of [["const GH_DEMO_CONFIG = {", "\n};"], ["function ghDemoStates() {", "\n}\n"]]) {
    const ids = [...block(start, end).matchAll(ENTITY)].map((m) => m[1]).filter((id) => DOMAINS.test(id));
    assert.ok(ids.length > 10, `${start} names its entities`);
    const real = ids.filter((id) => !/^[a-z_]+\.demo_/.test(id));
    assert.deepEqual(real, [], `${start} must only use *.demo_* entities`);
  }
});

test("demo mode stops every action that is not on a demo device", () => {
  // the cards' Home Assistant object, its websocket calls and the shared connection all refuse
  assert.equal((bundle.match(/ghDemoBlocked\(/g) || []).length, 4, "the block is in all three places");
  assert.match(bundle, /if \(GH_DEMO\) \{ ghDemoBlocked\(domain, service\); return Promise\.resolve/);
  assert.match(bundle, /if \(GH_DEMO && m && \(m\.type === "call_service" \|\| m\.type === "execute_script"\)\)/);
  // the shared connection only lets reads through on the Glass Home dashboard (demo-isolation.test.mjs runs it)
  assert.match(bundle, /if \(ghDemoHere\(\)\) \{[\s\S]{0,400}const no = ghDemoGate\(m\);/);
});

test("a demo camera never asks the server for a picture", () => {
  assert.match(bundle, /if \(cam && ghIsDemo\(cam\[2\]\)\) return Promise\.resolve\(\{ path: new URL\(GH_ASSETS\)\.pathname \+ "bg\.svg\?demo=camera" \}\)/);
});

test("installed files carry no private addresses, hardware ids or credentials", () => {
  const files = [];
  const walk = (dir) => { for (const f of readdirSync(new URL(dir, root))) { const p = join(dir, f); if (statSync(new URL(p, root)).isDirectory()) walk(`${p}/`); else if (/\.(js|ya?ml|json|py|md|html|css|svg)$/.test(f)) files.push(p.replace(/\\/g, "/")); } };
  for (const d of ["www/", "dashboards/", "config/", "examples/", "packages/", "themes/", "custom_components/", "docs/"]) walk(d);
  assert.ok(files.length > 15);
  const bad = [];
  for (const f of files) {
    const t = read(f);
    for (const m of t.matchAll(/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g)) bad.push(`${f}: private address`);
    for (const m of t.matchAll(/\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/g)) if (!/^(AA:BB:CC:DD:EE:FF|00:00:00:00:00:00)$/i.test(m[0])) bad.push(`${f}: MAC address`);
    for (const m of t.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./g)) bad.push(`${f}: token`);
    for (const m of t.matchAll(/\b(?:rtsp|rtmp)s?:\/\/(?!camera-address)[^\s"'`<>)]+/gi)) bad.push(`${f}: camera stream address`);
    for (const m of t.matchAll(/\b[a-z0-9-]+\.ui\.nabu\.casa\b/gi)) bad.push(`${f}: remote access address`);
    for (const m of t.matchAll(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g)) bad.push(`${f}: private key`);
  }
  assert.deepEqual(bad, []);
});

test("nothing preloads a home location: the weather place comes from setup", () => {
  for (const f of ["config/glasshome-config.example.yaml", "examples/glasshome-config.minimal.yaml", "dashboards/glasshome.yaml"]) {
    // only the marked fictional example ("Testville", in the Atlantic) may give coordinates
    const lines = read(f).split("\n").filter((l) => !/glasshome-validate: allow/.test(l));
    assert.ok(!lines.some((l) => /latitude:\s*-?\d|longitude:\s*-?\d/.test(l)), `${f} has no coordinates`);
  }
});
