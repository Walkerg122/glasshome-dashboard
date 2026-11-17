// Tests for the connection settings: council bin calendars, energy meters, Spotify and own floor plans.
// Run with: node tests/run-js-tests.mjs   (or: npm test)
// Like setup-model.test.mjs, this checks the model section of the shipped bundle. All data is fictional.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const bundle = readFileSync(new URL("../../www/glasshome/glasshome-cards.js", import.meta.url), "utf8");
const start = bundle.indexOf("// @@MODEL-START"), end = bundle.indexOf("// @@MODEL-END");
const NAMES = ["ghsNewDraft", "ghsBuildConfig", "ghsDraftFromConfig", "ghsParseIcs", "ghsParseCsv", "ghsBinGuess", "ghsBinKey", "ghsBinsSchedule",
  "ghsBinSummaries", "ghsBinTypes", "ghsEnergyFromMap", "ghsEnergyFromPrefs", "ghsNormArch", "ghsImageFit", "ghsSafeImage", "GHS_BIN_COLOURS", "GHS_SUPPLIERS"];
const ctx = vm.createContext({ URLSearchParams });
vm.runInContext(`${bundle.slice(start, end)}\nthis.M = { ${NAMES.join(", ")} };`, ctx);
const M = ctx.M;
const plain = (x) => JSON.parse(JSON.stringify(x));
const FROM = { from: "2026-11-16", tz: "Europe/London" };

// ------------------------------------------------------------------ council calendar files
const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261120", "SUMMARY:Recycling collection", "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4", "EXDATE;VALUE=DATE:20261204", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261126T230000Z", "SUMMARY:General waste\\, black bin", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261127", "SUMMARY:Garden waste and food", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261130", "SUMMARY:Cancelled collection", "STATUS:CANCELLED", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20250101", "SUMMARY:Long ago", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

test("an iCalendar file gives each collection day, with repeats, exceptions and cancellations", () => {
  const r = plain(M.ghsParseIcs(ICS, FROM));
  const dates = r.events.map((e) => `${e.date} ${e.summary}`);
  assert.deepEqual(dates, [
    "2026-11-20 Recycling collection",
    "2026-11-26 General waste, black bin", // 23:00 UTC on the 26th is still the 26th in London in winter
    "2026-11-27 Garden waste and food",
    "2026-12-18 Recycling collection", // 4 December is an exception; COUNT=4 covers 20 Nov to 1 Jan
    "2027-01-01 Recycling collection",
  ]);
});

test("a UTC collection time is moved to the local date", () => {
  const ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260701T230000Z\nSUMMARY:Refuse\nEND:VEVENT\nEND:VCALENDAR";
  assert.equal(M.ghsParseIcs(ics, { from: "2026-06-01", tz: "Europe/London" }).events[0].date, "2026-07-02"); // summer time: midnight on the 2nd
});

test("a spreadsheet or pasted list gives dates in day-first or month-first order", () => {
  const csv = "Date,Collection\n20/11/2026,Recycling\nFriday 27 November 2026 - Green waste\n\"4 Dec 2026\",\"Refuse, Food\"\nnonsense";
  const r = plain(M.ghsParseCsv(csv, FROM));
  assert.deepEqual(r.events.map((e) => [e.date, e.summary]), [["2026-11-20", "Recycling"], ["2026-11-27", "Green waste"], ["2026-12-04", "Refuse, Food"]]);
  assert.ok(r.ignored >= 1);
  assert.equal(M.ghsParseCsv("11/20/2026 Recycling", { ...FROM, monthFirst: true }).events[0].date, "2026-11-20");
});

test("bins are guessed from the words councils use", () => {
  assert.deepEqual(plain(M.ghsBinGuess("Recycling")), ["blue"]);
  assert.deepEqual(plain(M.ghsBinGuess("Green waste")), ["brown"]);
  assert.deepEqual(plain(M.ghsBinGuess("Refuse, Food")), ["grey", "orange"]);
  assert.deepEqual(plain(M.ghsBinGuess("Black bin")), ["black"]);
  assert.deepEqual(plain(M.ghsBinGuess("Something unusual")), []);
});

test("collection entries are grouped and can be corrected by hand", () => {
  const events = [{ date: "2026-11-20", summary: "Recycling" }, { date: "2026-12-04", summary: "Recycling" }, { date: "2026-11-27", summary: "Mystery" }];
  const sums = plain(M.ghsBinSummaries(events));
  assert.deepEqual(sums.map((s) => [s.label, s.count, s.bins]), [["Recycling", 2, ["blue"]], ["Mystery", 1, []]]);
  // an entry with no bins is left out until a bin is chosen
  assert.deepEqual(plain(M.ghsBinsSchedule(events, {})), { "2026-11-20": ["blue"], "2026-12-04": ["blue"] });
  assert.deepEqual(plain(M.ghsBinsSchedule(events, { [M.ghsBinKey("Mystery")]: ["purple"] }))["2026-11-27"], ["purple"]);
  // two entries on the same day are combined
  assert.deepEqual(plain(M.ghsBinsSchedule([{ date: "2026-11-20", summary: "Refuse" }, { date: "2026-11-20", summary: "Food" }], {})), { "2026-11-20": ["grey", "orange"] });
});

test("only renamed or new bin colours are written to the settings", () => {
  assert.deepEqual(plain(M.ghsBinTypes(["blue", "grey"], {})), {});
  const t = plain(M.ghsBinTypes(["grey", "orange"], { grey: { name: "Black wheelie bin" } }));
  assert.equal(t.grey.name, "Black wheelie bin");
  assert.equal(t.grey.short, "Black wheelie");
  assert.equal(t.orange.name, M.GHS_BIN_COLOURS.orange.name);
});

// ------------------------------------------------------------------ saving and reopening the settings
const draft = () => {
  const d = M.ghsNewDraft("Europe/London");
  d.features.bins = true;
  d.features.energy = true;
  return d;
};

test("bin dates from a file are saved as a schedule and read back the same", () => {
  const d = draft();
  const events = plain(M.ghsParseCsv("20/11/2026,Recycling\n27/11/2026,Refuse and food", FROM)).events;
  Object.assign(d.choices.bins, { source: "file", events, file: "bins.csv", labels: { orange: { name: "Food caddy", waste: "Food" } } });
  const cfg = plain(M.ghsBuildConfig(d, {}, { now: "2026-11-16T00:00:00.000Z" }));
  assert.deepEqual(cfg.bins.schedule, { "2026-11-20": ["blue"], "2026-11-27": ["grey", "orange"] });
  assert.equal(cfg.bins.source, "file");
  assert.equal(cfg.bins.file, "bins.csv");
  assert.equal(cfg.features.bins, true);
  const again = plain(M.ghsBuildConfig(M.ghsDraftFromConfig(cfg, "Europe/London"), cfg, { now: "2026-11-17T00:00:00.000Z" }));
  assert.deepEqual(again.bins, cfg.bins);
});

test("a Home Assistant calendar is saved with what each entry means", () => {
  const d = draft();
  Object.assign(d.choices.bins, { source: "calendar", calendar: "calendar.bin_days", map: { "general waste": ["grey"] }, reminder_hour: 19 });
  const cfg = plain(M.ghsBuildConfig(d, {}, {}));
  assert.deepEqual(cfg.bins.calendar, { entity: "calendar.bin_days", map: { "general waste": ["grey"] } });
  assert.equal(cfg.bins.reminder_hour, 19);
  assert.equal(cfg.bins.schedule, undefined);
  assert.deepEqual(plain(M.ghsBuildConfig(M.ghsDraftFromConfig(cfg, "Europe/London"), cfg, {})).bins, cfg.bins);
});

test("bin reminders stay off without any dates", () => {
  const d = draft();
  d.choices.bins.source = "file";
  const cfg = plain(M.ghsBuildConfig(d, {}, {}));
  assert.equal(cfg.features.bins, false);
});

// ------------------------------------------------------------------ energy
test("chosen meters become the energy card's settings, counting today from a meter", () => {
  const en = plain(M.ghsEnergyFromMap({ electricity: { demand: "sensor.home_power", meter: "sensor.home_energy" }, gas: {} }));
  assert.deepEqual(en, { electricity: { demand: "sensor.home_power", stat_kwh: "sensor.home_energy", today_kwh: "sensor.glasshome_electricity_today", today_from: "sensor.home_energy" } });
  const both = plain(M.ghsEnergyFromMap({ electricity: { today_kwh: "sensor.elec_today", today_cost: "sensor.elec_cost" }, gas: { meter: "sensor.gas_meter" } }));
  assert.equal(both.electricity.stat_kwh, "sensor.elec_today");
  assert.equal(both.electricity.stat_cost, "sensor.elec_cost");
  assert.equal(both.gas.today_from, "sensor.gas_meter");
  assert.equal(M.ghsEnergyFromMap({ electricity: {}, gas: { meter: "sensor.gas_meter" } }), null);
});

test("meters are read from Home Assistant's Energy dashboard", () => {
  const prefs = { energy_sources: [{ type: "grid", flow_from: [{ stat_energy_from: "sensor.grid_import", stat_cost: "sensor.grid_cost", entity_energy_price: null }] }, { type: "gas", stat_energy_from: "sensor.gas_meter" }, { type: "solar", stat_energy_from: "sensor.solar" }] };
  const p = plain(M.ghsEnergyFromPrefs(prefs));
  assert.equal(p.electricity.meter, "sensor.grid_import");
  assert.equal(p.electricity.cost_meter, "sensor.grid_cost");
  assert.equal(p.gas.meter, "sensor.gas_meter");
  assert.deepEqual(plain(M.ghsEnergyFromPrefs(null)).electricity, { meter: "", cost_meter: "", rate: "" });
});

test("an energy connection is saved with its supplier and method, and read back", () => {
  const d = draft();
  d.choices.energy = { supplier: "british_gas", method: "glow", electricity: { demand: "sensor.home_power", meter: "sensor.home_energy" }, gas: { meter: "sensor.gas_meter" } };
  const cfg = plain(M.ghsBuildConfig(d, {}, {}));
  assert.equal(cfg.energy.method, "glow");
  assert.equal(cfg.energy.supplier, "british_gas");
  assert.equal(cfg.energy.gas.today_kwh, "sensor.glasshome_gas_today");
  assert.equal(cfg.features.energy, true);
  assert.deepEqual(plain(M.ghsBuildConfig(M.ghsDraftFromConfig(cfg, "Europe/London"), cfg, {})).energy, cfg.energy);
  assert.ok(M.GHS_SUPPLIERS.every(([id, name, method]) => id && name && ["octopus", "glow", "ha_energy", "other"].includes(method)));
});

// ------------------------------------------------------------------ Spotify
test("Spotify needs both the account and the speaker", () => {
  const d = draft();
  d.features.spotify = true;
  d.choices.spotify = "media_player.spotify_someone"; // glasshome-validate: allow (fictional entity)
  assert.equal(plain(M.ghsBuildConfig(d, {}, {})).features.spotify, false);
  d.choices.spotify_device = "Kitchen speaker";
  const cfg = plain(M.ghsBuildConfig(d, {}, {}));
  assert.equal(cfg.features.spotify, true);
  assert.equal(cfg.media.spotify_device, "Kitchen speaker");
  assert.equal(M.ghsDraftFromConfig(cfg, "Europe/London").choices.spotify_device, "Kitchen speaker");
});

// ------------------------------------------------------------------ floor plans
test("a drawn plan is completed so it always draws, and bad floors are dropped", () => {
  const A = plain(M.ghsNormArch({ ground: { rooms: [{ id: "r1", name: "Lounge", poly: [[10, 10], [200, 10], [200, 150], [10, 150]] }] }, "bad floor!": {} }));
  assert.deepEqual(Object.keys(A), ["ground"]);
  for (const k of ["walls", "windows", "doors", "sliders"]) assert.deepEqual(A.ground[k], []);
  assert.equal(A.ground.stairs, null);
  assert.ok(A.ground.rooms[0].label);
  assert.ok(Array.isArray(A.ground.outline));
  assert.equal(M.ghsNormArch(null), null);
});

test("an uploaded picture is fitted to the plan without stretching", () => {
  const f = plain(M.ghsImageFit(1200, 800));
  assert.deepEqual(f, { x: 29, y: 4, w: 615, h: 410 });
  assert.ok(Math.abs(f.w / f.h - 1.5) < 0.01);
});

test("only re-encoded pictures are accepted", () => {
  const ok = { src: "data:image/webp;base64,UklGRg==", x: 1, y: 2, w: 3, h: 4 };
  assert.equal(M.ghsSafeImage(ok), true);
  assert.equal(M.ghsSafeImage({ ...ok, src: "data:image/svg+xml;base64,PHN2Zz4=" }), false);
  assert.equal(M.ghsSafeImage({ ...ok, src: "https://example.com/plan.png" }), false);
  assert.equal(M.ghsSafeImage({ ...ok, src: "data:image/png;base64,abc\"onload=x" }), false);
  assert.equal(M.ghsSafeImage({ ...ok, w: "wide" }), false);
});
