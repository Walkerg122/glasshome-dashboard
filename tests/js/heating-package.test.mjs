// Safety checks for the optional heating package (packages/glasshome_heating.yaml), which controls a real
// thermostat once someone installs it. Reads the file as text; nothing here talks to Home Assistant.
// Run with: node tests/run-js-tests.mjs   (or: npm test)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const pkg = read("packages/glasshome_heating.yaml");
const code = pkg.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("the heating package says up front that it controls real heating", () => {
  assert.match(pkg.split("\n").slice(0, 8).join("\n"), /WARNING: THIS PACKAGE CONTROLS REAL HEATING/);
  assert.match(pkg, /docs\/install\.md/);
  const placeholders = (code.match(/climate\.thermostat\b/g) || []).length;
  assert.match(pkg, new RegExp(`climate\\.thermostat below \\(${placeholders} places\\)`), "the CHANGE ME note counts every place");
});

test("its automation only switches the thermostat to heat and sets a temperature", () => {
  const actions = [...code.matchAll(/action:\s*([a-z_]+\.[a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(actions)].sort(), ["climate.set_hvac_mode", "climate.set_temperature"]);
  assert.deepEqual([...code.matchAll(/hvac_mode:\s*(\S+)/g)].map((m) => m[1]), ["heat"]);
  assert.equal((code.match(/^\s+- id: /gm) || []).length, 1, "one automation");
});

test("automatic runs never turn a thermostat that is off back on", () => {
  const triggers = (code.match(/^\s+- trigger: /gm) || []).length;
  assert.ok(triggers >= 4);
  assert.equal((code.match(/^\s+id: automatic$/gm) || []).length, triggers, "every trigger is marked automatic");
  assert.match(code, /value_template: "\{\{ not is_state\('climate\.thermostat', 'off'\) or \(trigger is defined and trigger\.id \| default\(''\) != 'automatic'\) \}\}"/);
});

test("it waits until the schedule helper exists and the thermostat is available, and skips boosts", () => {
  assert.match(code, /states\('schedule\.heating_schedule'\) in \['on', 'off'\]/);
  assert.match(code, /states\('climate\.thermostat'\) not in \['unavailable', 'unknown'\]/);
  assert.match(code, /attribute: preset_mode\n\s+state: boost/);
});

test("nothing installs or turns on the heating package by default", () => {
  // the example settings keep the Hive heating centre off, and the docs explain the package before it is copied
  assert.match(read("config/glasshome-config.example.yaml"), /^\s*heating_hive: false\b/m);
  assert.match(read("docs/install.md"), /^## Heating package safety$/m);
  assert.match(read("README.md"), /docs\/install\.md#heating-package-safety/);
});
