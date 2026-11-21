// Unit tests for the pure logic of the card. Run with: npm test
// The card file is loaded in a sandbox with minimal DOM stubs, then its
// top-level functions are exercised directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

process.env.TZ = "UTC";

const src = readFileSync(new URL("../dist/blood-pressure-card.js", import.meta.url), "utf8");
const ctx = {
  console: { info() {}, warn() {}, log() {} },
  HTMLElement: class {},
  customElements: { get: () => undefined, define() {} },
  window: {},
  navigator: { language: "en-US" },
  document: {},
  Intl,
  setTimeout
};
vm.createContext(ctx);
vm.runInContext(
  src + "\n;globalThis.__api = { BPC_I18N, BPC_DEFAULTS, BPC_GUIDELINES, BPC_PALETTES, BPC_PAIR_MS," +
  " bpcLang, bpcLocale, bpcT, bpcEsc, bpcNumber, bpcClassify, bpcDefaultGuideline, bpcDayKey, bpcRelative," +
  " bpcDiscover, bpcResolve, bpcChanges, bpcReadings, bpcDaysFromReadings, bpcDaysFromStatistics," +
  " bpcMergeDays, bpcAverage, bpcEditorSchema, bpcCleanConfig, BPC_HELPERS, BPC_HELPER_KEYS, BPC_NEVER," +
  " bpcDaysFromHelpers, bpcHelperTime, bpcSlug, bpcTodayTemplate, bpcAutomationConfig, bpcCreateHelpers };",
  ctx
);
const api = ctx.__api;
const plain = (v) => JSON.parse(JSON.stringify(v));
const H = 3600000, DAY = 86400000;
const T0 = Date.UTC(2026, 2, 10, 7, 0, 0); // 10 March 2026, 07:00 UTC

/* A simulated instance: two monitors, a room barometer, a heart rate sensor elsewhere. */
function instance() {
  const states = {}, entities = {};
  const add = (id, unit, opts) => {
    opts = opts || {};
    states[id] = { state: opts.state || "100", attributes: { unit_of_measurement: unit, friendly_name: opts.name || id } };
    entities[id] = { entity_id: id, device_id: opts.device || null, platform: opts.platform || "x",
      translation_key: opts.key || null, hidden: !!opts.hidden, entity_category: opts.category || null };
  };
  add("sensor.withings_systolic_blood_pressure", "mmHg", { device: "w", key: "systolic_blood_pressure" });
  add("sensor.withings_diastolic_blood_pressure", "mmHg", { device: "w", key: "diastolic_blood_pressure" });
  add("sensor.withings_heart_pulse", "bpm", { device: "w", key: "heart_pulse" });
  add("sensor.withings_average_heart_rate", "bpm", { device: "w", key: "average_heart_rate" });
  add("sensor.a_pressione_sistolica", "mmHg", { device: "a", name: "Pressione sistolica" });
  add("sensor.room_pressure", "hPa", { device: "r" });
  add("sensor.watch_heart_rate", "bpm", { device: "watch" });
  return { states, entities };
}

test("the card registers itself in the card picker", () => {
  assert.equal(ctx.window.customCards.length, 1);
  assert.equal(ctx.window.customCards[0].type, "blood-pressure-card");
  assert.equal(ctx.window.customCards[0].preview, true);
});

test("source file is plain ASCII", () => {
  assert.ok(/^[\x00-\x7F]*$/.test(src));
});

test("every language has exactly the keys of the English dictionary", () => {
  const en = Object.keys(api.BPC_I18N.en).sort();
  assert.ok(Object.keys(api.BPC_I18N).includes("it"));
  for (const lang of Object.keys(api.BPC_I18N)) {
    assert.deepEqual(Object.keys(api.BPC_I18N[lang]).sort(), en, "keys of '" + lang + "' differ from 'en'");
    for (const k of en) {
      const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
      assert.equal(ph(api.BPC_I18N[lang][k]), ph(api.BPC_I18N.en[k]), "placeholders of '" + lang + "." + k + "'");
    }
  }
});

test("every guideline, category and editor field has a label and a palette", () => {
  const names = [];
  const walk = (list) => list.forEach((s) => (s.schema ? walk(s.schema) : names.push(s.name)));
  walk(api.bpcEditorSchema("en"));
  for (const lang of Object.keys(api.BPC_I18N)) {
    const t = api.BPC_I18N[lang];
    for (const n of names) assert.ok(t["ed_" + n], lang + ": ed_" + n);
    for (const [key, g] of Object.entries(api.BPC_GUIDELINES)) {
      assert.ok(t["g_" + key] && t["ed_" + key], lang + ": " + key);
      for (const c of g.categories) assert.ok(t["c_" + c], lang + ": c_" + c);
    }
  }
  for (const g of Object.values(api.BPC_GUIDELINES)) {
    assert.equal(g.systolic.length, g.categories.length - 1);
    assert.equal(g.diastolic.length, g.categories.length - 1);
    assert.deepEqual([...g.systolic], [...g.systolic].sort((a, b) => a - b));
    assert.deepEqual([...g.diastolic], [...g.diastolic].sort((a, b) => a - b));
    assert.equal(api.BPC_PALETTES[g.categories.length].length, g.categories.length);
  }
});

test("language follows Home Assistant, then the browser, then English", () => {
  assert.equal(api.bpcLang({ locale: { language: "it" } }), "it");
  assert.equal(api.bpcLang({ locale: { language: "it-IT" } }), "it");
  assert.equal(api.bpcLang({ language: "it_CH" }), "it");
  assert.equal(api.bpcLang({ locale: { language: "de" } }), "en");
  assert.equal(api.bpcLang(null), "en");
  assert.equal(api.bpcLocale({ language: "it_CH" }), "it-CH");
});

test("translation with placeholders and fallback", () => {
  assert.equal(api.bpcT("it", "reference", { label: "Ottimale", sys: 120, dia: 80 }), "Ottimale: sotto 120/80 mmHg");
  assert.equal(api.bpcT("xx", "systolic"), "Systolic");
  assert.equal(api.bpcT("it", "no_such_key"), "no_such_key");
  assert.equal(api.bpcEsc('<b a="1">&\''), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;");
});

test("ESH 2023 classification", () => {
  const g = api.BPC_GUIDELINES.esh_2023;
  const c = (s, d) => g.categories[api.bpcClassify(g, s, d)];
  assert.equal(c(119, 79), "optimal");
  assert.equal(c(120, 79), "normal");
  assert.equal(c(119, 80), "normal");
  assert.equal(c(130, 70), "high_normal");
  assert.equal(c(125, 89), "high_normal");
  assert.equal(c(140, 70), "grade_1_hypertension", "isolated systolic, graded by the systolic value");
  assert.equal(c(160, 85), "grade_2_hypertension");
  assert.equal(c(150, 105), "grade_2_hypertension");
  assert.equal(c(180, 90), "grade_3_hypertension");
  assert.equal(c(135, 110), "grade_3_hypertension");
  assert.equal(c(135, null), "high_normal", "a missing value does not count");
});

test("ESC 2024 and ACC/AHA 2025 classification", () => {
  const esc = api.BPC_GUIDELINES.esc_2024, aha = api.BPC_GUIDELINES.acc_aha_2025;
  const c = (g, s, d) => g.categories[api.bpcClassify(g, s, d)];
  assert.equal(c(esc, 119, 69), "non_elevated");
  assert.equal(c(esc, 119, 70), "elevated");
  assert.equal(c(esc, 139, 89), "elevated");
  assert.equal(c(esc, 110, 90), "hypertension");
  assert.equal(c(aha, 119, 79), "normal");
  assert.equal(c(aha, 125, 79), "elevated");
  assert.equal(c(aha, 125, 80), "stage_1_hypertension", "elevated needs a diastolic below 80");
  assert.equal(c(aha, 135, 70), "stage_1_hypertension");
  assert.equal(c(aha, 118, 90), "stage_2_hypertension");
});

test("the default guideline follows the country of Home Assistant", () => {
  assert.equal(api.bpcDefaultGuideline({ config: { country: "US" } }), "acc_aha_2025");
  assert.equal(api.bpcDefaultGuideline({ config: { country: "IT" } }), "esh_2023");
  assert.equal(api.bpcDefaultGuideline(null), "esh_2023");
});

test("the monitor is found without configuration", () => {
  const found = plain(api.bpcDiscover(instance()));
  assert.deepEqual(found, {
    systolic: "sensor.withings_systolic_blood_pressure",
    diastolic: "sensor.withings_diastolic_blood_pressure",
    pulse: "sensor.withings_heart_pulse"
  });
});

test("discovery prefers a pair on one device, skips hidden and diagnostic entities", () => {
  const hass = instance();
  hass.entities["sensor.withings_systolic_blood_pressure"].hidden = true;
  hass.states["sensor.a_pressione_diastolica"] = { state: "80", attributes: { unit_of_measurement: "mmHg" } };
  hass.entities["sensor.a_pressione_diastolica"] = { device_id: "a" };
  const found = plain(api.bpcDiscover(hass));
  assert.equal(found.systolic, "sensor.a_pressione_sistolica");
  assert.equal(found.diastolic, "sensor.a_pressione_diastolica");
  assert.equal(found.pulse, null, "the pulse is only taken from the same device");

  hass.entities["sensor.a_pressione_sistolica"].entity_category = "diagnostic";
  assert.equal(api.bpcDiscover(hass).systolic, null);
  assert.equal(api.bpcDiscover({ states: {} }).systolic, null);
  assert.equal(api.bpcDiscover(null).systolic, null);
});

test("configuration: overrides, options of earlier versions, defaults", () => {
  const hass = instance();
  let c = api.bpcResolve({}, hass);
  assert.equal(c.systolic_entity, "sensor.withings_systolic_blood_pressure");
  assert.equal(c.guideline, "esh_2023");
  assert.equal(c.history_days, 30);
  c = api.bpcResolve({ sys_entity: "sensor.s", dia_entity: "sensor.d", history_days: 900 }, hass);
  assert.equal(c.systolic_entity, "sensor.s");
  assert.equal(c.diastolic_entity, "sensor.d");
  assert.equal(c.pulse_entity, undefined, "no pulse is guessed for configured sensors");
  assert.equal(c.history_days, 365);
  c = api.bpcResolve({ guideline: "nope" }, Object.assign(hass, { config: { country: "US" } }));
  assert.equal(c.guideline, "acc_aha_2025");
});

test("the editor writes a clean configuration", () => {
  const out = plain(api.bpcCleanConfig({ sys_entity: "sensor.s", dia_entity: "sensor.d", title: "", history_days: 30,
    show_history: false, guideline: "esc_2024" }));
  assert.deepEqual(out, { systolic_entity: "sensor.s", diastolic_entity: "sensor.d", show_history: false,
    guideline: "esc_2024", type: "custom:blood-pressure-card" });
});

test("value changes ignore the baseline, restores and repeated values", () => {
  const rows = [
    { s: "131", lu: T0 / 1000 },
    { s: "unavailable", lu: (T0 + H) / 1000 },
    { s: "131", lu: (T0 + 2 * H) / 1000 },
    { s: "124", lu: (T0 + 3 * H) / 1000 },
    { state: "124", last_updated: new Date(T0 + 4 * H).toISOString() },
    { state: "128", last_updated: new Date(T0 + 5 * H).toISOString() }
  ];
  assert.deepEqual(plain(api.bpcChanges(rows)), [{ t: T0 + 3 * H, v: 124 }, { t: T0 + 5 * H, v: 128 }]);
});

test("readings pair systolic and diastolic changes", () => {
  const sys = [{ s: "130", lu: T0 / 1000 }, { s: "142", lu: (T0 + H) / 1000 }, { s: "126", lu: (T0 + 30 * H) / 1000 }];
  const dia = [{ s: "84", lu: T0 / 1000 }, { s: "91", lu: (T0 + H + 5000) / 1000 }, { s: "79", lu: (T0 + 40 * H) / 1000 }];
  const readings = plain(api.bpcReadings(sys, dia));
  assert.deepEqual(readings, [
    { t: T0 + H, systolic: 142, diastolic: 91 },
    { t: T0 + 30 * H, systolic: 126, diastolic: 91 },
    { t: T0 + 40 * H, systolic: 126, diastolic: 79 }
  ]);
  assert.deepEqual(plain(api.bpcReadings([], [])), []);
});

test("daily summaries of the readings", () => {
  const days = plain(api.bpcDaysFromReadings([
    { t: T0, systolic: 120, diastolic: 80 },
    { t: T0 + 60000, systolic: 130, diastolic: 84 },
    { t: T0 + DAY, systolic: 140, diastolic: 90 }
  ]));
  assert.deepEqual(Object.keys(days), ["2026-03-10", "2026-03-11"]);
  assert.deepEqual(days["2026-03-10"], {
    date: "2026-03-10", source: "readings", count: 2,
    systolic: { min: 120, max: 130, mean: 125 }, diastolic: { min: 80, max: 84, mean: 82 }
  });
});

test("days from statistics leave out flat days", () => {
  const d = (n) => Date.UTC(2026, 1, n);
  const sys = [{ start: d(1), min: 120, max: 131, mean: 127 }, { start: d(2), min: 131, max: 131, mean: 131 },
    { start: d(3) / 1000, min: 131, max: 131, mean: 131 }, { start: new Date(d(4)).toISOString(), min: null, max: 1, mean: 1 }];
  const dia = [{ start: d(1), min: 80, max: 85, mean: 83 }, { start: d(2), min: 85, max: 85, mean: 85 },
    { start: d(3) / 1000, min: 79, max: 85, mean: 81 }];
  const days = plain(api.bpcDaysFromStatistics(sys, dia));
  assert.deepEqual(Object.keys(days).sort(), ["2026-02-01", "2026-02-03"]);
  assert.equal(days["2026-02-01"].source, "statistics");
  assert.equal(days["2026-02-03"].systolic.mean, 131);
});

const mk = (source) => (...dates) => Object.fromEntries(dates.map((date) => [date, { date, source }]));
const stat = mk("statistics"), read = mk("readings"), help = mk("helpers");
const merged = (r, h, s, from) => plain(api.bpcMergeDays(r, h, s, from)).map((d) => d.date.slice(5) + ":" + d.source);

test("merge without helpers: exact days from the history, statistics before it", () => {
  const stats = stat("2026-03-01", "2026-03-05", "2026-03-08");
  const from = Date.UTC(2026, 2, 5, 12);
  assert.deepEqual(merged(read("2026-03-08"), {}, stats, from), ["03-01:statistics", "03-05:statistics", "03-08:readings"]);
  assert.deepEqual(merged(read("2026-03-05"), {}, stats, from), ["03-01:statistics", "03-05:readings"]);
  assert.equal(merged({}, {}, stats, null).length, 3);
  assert.equal(merged({}, null, stats, null).length, 3, "missing helper days are allowed");
});

test("merge with helpers: precedence before, on and after the start of the history", () => {
  const from = Date.UTC(2026, 2, 5, 12); // the raw history starts on 5 March
  const days = merged(
    read("2026-03-05", "2026-03-06", "2026-03-08"),
    help("2026-03-03", "2026-03-05", "2026-03-06", "2026-03-07"),
    stat("2026-03-01", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-09"),
    from);
  assert.deepEqual(days, [
    "03-01:statistics", // before the first helper day: statistics of the sources
    "03-03:helpers", // helpers before statistics
    // 03-04: a statistics day after the first helper day is the previous value carried over
    "03-05:helpers", // start day of the history, possibly partial: helpers first
    "03-06:readings", // after the start: exact readings first
    "03-07:helpers", // then helpers
    "03-08:readings"
    // 03-09: no statistics after the start of the history
  ]);
  assert.deepEqual(merged(read("2026-03-05"), {}, stat("2026-03-05"), from), ["03-05:readings"], "readings before statistics on the start day");
  assert.deepEqual(merged({}, {}, stat("2026-03-05"), from), ["03-05:statistics"]);
  assert.deepEqual(merged({}, help("2026-03-02"), stat("2026-03-01", "2026-03-02"), null), ["03-01:statistics", "03-02:helpers"]);
});

test("days from the helper sensors: every day with a value, flat days included", () => {
  const d = (n) => Date.UTC(2026, 1, n);
  const sys = [{ start: d(1), min: 120, max: 131, mean: 127 }, { start: d(2) / 1000, min: 131, max: 131, mean: 131 },
    { start: new Date(d(3)).toISOString(), min: null, max: null, mean: null }];
  const dia = [{ start: d(2), min: 85, max: 85, mean: 85 }, { start: d(4), min: 79, max: 79, mean: 79 }];
  const days = plain(api.bpcDaysFromHelpers(sys, dia));
  assert.deepEqual(Object.keys(days).sort(), ["2026-02-01", "2026-02-02", "2026-02-04"]);
  assert.deepEqual(days["2026-02-02"], { date: "2026-02-02", source: "helpers", count: null,
    systolic: { min: 131, max: 131, mean: 131 }, diastolic: { min: 85, max: 85, mean: 85 } });
  assert.equal(days["2026-02-01"].diastolic, null);
  assert.deepEqual(plain(api.bpcDaysFromHelpers(null, undefined)), {});
});

test("time of the last measurement from the input_datetime helper", () => {
  const hass = { states: {
    "input_datetime.a": { state: "2026-03-10 07:00:00", attributes: { timestamp: T0 / 1000 } },
    "input_datetime.never": { state: "2000-01-01 00:00:00", attributes: { timestamp: Date.UTC(2000, 0, 1) / 1000 } },
    "input_datetime.empty": { state: "unknown", attributes: {} }
  } };
  assert.equal(api.bpcHelperTime(hass, "input_datetime.a"), T0);
  assert.equal(api.bpcHelperTime(hass, "input_datetime.never"), null, "times before 2001 are ignored");
  assert.equal(api.bpcHelperTime(hass, "input_datetime.empty"), null);
  assert.equal(api.bpcHelperTime(hass, "input_datetime.missing"), null);
  assert.equal(api.bpcHelperTime(hass, undefined), null);
});

test("7-day average of the daily means", () => {
  const now = Date.UTC(2026, 2, 10, 12);
  const day = (date, s, d) => ({ date, systolic: { mean: s }, diastolic: { mean: d } });
  const avg = plain(api.bpcAverage([day("2026-03-02", 160, 100), day("2026-03-04", 120, 80), day("2026-03-10", 130, 84)], now));
  assert.deepEqual(avg, { systolic: 125, diastolic: 82, days: 2 });
  assert.equal(api.bpcAverage([day("2026-03-01", 120, 80)], now), null);
});

test("relative time", () => {
  const now = T0 + 5 * H;
  assert.equal(api.bpcRelative({ language: "en" }, now - 30000, now), "just now");
  assert.equal(api.bpcRelative({ language: "en" }, now - 2 * H, now), "2 hours ago");
  assert.equal(api.bpcRelative({ language: "it" }, now - DAY, now), "ieri");
});

/* ---------- one-click helpers ---------- */

const SYS = "sensor.withings_systolic_blood_pressure", DIA = "sensor.withings_diastolic_blood_pressure";

/* A simulated Home Assistant for helper creation: WebSocket commands, REST API and
   services are recorded; created entities go to a simulated entity registry. */
function helperHass(opts = {}) {
  const base = opts.noMonitor ? { states: {}, entities: {} } : instance();
  const log = { ws: [], api: [], services: [] };
  const registry = [];
  let entries = 0;
  return Object.assign(base, {
    log, registry, language: opts.lang || "en", locale: { language: opts.lang || "en" }, user: { is_admin: true },
    async callWS(msg) {
      log.ws.push(plain(msg));
      if (msg.type === "config/entity_registry/list") return registry;
      if (msg.type === "history/history_during_period") return opts.history || {};
      if (msg.type !== "input_datetime/create") throw new Error("unexpected " + msg.type);
      const id = api.bpcSlug(msg.name);
      /* the entity id may differ from domain.id (a name already used): resolved via the registry */
      registry.push({ entity_id: "input_datetime." + id + (opts.suffix || ""), platform: "input_datetime", unique_id: id });
      return Object.assign({ id }, msg);
    },
    async callApi(method, path, data) {
      log.api.push({ method, path, data: plain(data) });
      if (path.indexOf("config/automation/config/") === 0) return { result: "ok" };
      if (path === "config/config_entries/flow") return { type: "menu", flow_id: "f" + log.api.length, step_id: "user" };
      if (data.next_step_id === "sensor") return { type: "form", flow_id: path.split("/").pop(), step_id: "sensor" };
      if (opts.failTemplate) return { type: "form", errors: { state: "invalid_template" } };
      entries += 1;
      registry.push({ entity_id: "sensor." + api.bpcSlug(data.name), platform: "template", config_entry_id: "e" + entries });
      return { type: "create_entry", result: { entry_id: "e" + entries } };
    },
    async callService(domain, service, data) {
      log.services.push({ domain, service, data: plain(data) });
    }
  });
}
const autoCalls = (hass) => hass.log.api.filter((c) => c.path.indexOf("config/automation/config/") === 0);

test("helper names are fixed English strings with distinct object ids", () => {
  assert.equal(api.bpcSlug("Blood pressure systolic today"), "blood_pressure_systolic_today");
  assert.equal(api.bpcSlug("  A-B  c! "), "a_b_c");
  const names = [api.BPC_HELPERS.last.name, api.BPC_HELPERS.automation.name].concat(api.BPC_HELPERS.today.map((t) => t.name));
  for (const n of names) assert.ok(/^Blood pressure [a-z ]+$/.test(n), "plain English name: " + n);
  assert.equal(new Set(names.map((n) => api.bpcSlug(n))).size, names.length);
  assert.deepEqual([...api.BPC_HELPER_KEYS], [api.BPC_HELPERS.last.key].concat(api.BPC_HELPERS.today.map((t) => t.key)));
});

test("state template of the today sensors", () => {
  assert.equal(api.bpcTodayTemplate("sensor.s", "input_datetime.d"),
    "{% set v = states('sensor.s') %}{{ v | float if is_number(v) and states('input_datetime.d')[:10] == " +
    "now().strftime('%Y-%m-%d') else none }}");
});

test("automation that records the time of every measurement", () => {
  const a = plain(api.bpcAutomationConfig("sensor.s", "sensor.d", "input_datetime.d"));
  assert.equal(a.alias, "Blood pressure record measurement");
  assert.match(a.description, /Blood Pressure Card/);
  assert.equal(a.mode, "single");
  assert.equal(a.max_exceeded, "silent");
  assert.deepEqual(a.trigger, [{ platform: "state", entity_id: ["sensor.s", "sensor.d"], not_to: ["unknown", "unavailable"] }]);
  assert.deepEqual(a.condition, [{ condition: "template", value_template: "{{ trigger.from_state is not none and " +
    "trigger.from_state.state not in ['unknown','unavailable',''] and trigger.from_state.state != trigger.to_state.state }}" }]);
  assert.deepEqual(a.action, [{ action: "input_datetime.set_datetime", target: { entity_id: "input_datetime.d" },
    data: { timestamp: "{{ now().timestamp() }}" } }]);
});

test("create helpers: fresh install creates and links everything, English names in every language", async () => {
  const hass = helperHass({ lang: "it", suffix: "_2" });
  const r = await api.bpcCreateHelpers(hass, { type: "custom:blood-pressure-card", title: "X" }, 0);
  assert.equal(r.error, null);
  assert.equal(r.noSensors, false);
  assert.equal(r.created, 4);
  assert.equal(r.reused, 0);
  assert.equal(r.config.title, "X", "other options are kept");
  const last = "input_datetime.blood_pressure_last_measurement_2";
  assert.equal(r.config.last_entity, last, "entity id taken from the registry");
  assert.equal(r.config.systolic_today_entity, "sensor.blood_pressure_systolic_today");
  assert.equal(r.config.diastolic_today_entity, "sensor.blood_pressure_diastolic_today");
  assert.deepEqual(Object.keys(r.config).sort(),
    ["diastolic_today_entity", "last_entity", "systolic_today_entity", "title", "type"], "the automation is not linked");
  assert.deepEqual(hass.log.ws.find((m) => m.type === "input_datetime/create"), { type: "input_datetime/create",
    name: "Blood pressure last measurement", icon: "mdi:calendar-heart", has_date: true, has_time: true });
  const auto = autoCalls(hass);
  assert.equal(auto.length, 1);
  assert.equal(auto[0].method, "POST");
  assert.match(auto[0].path, /^config\/automation\/config\/\d+$/);
  assert.deepEqual(auto[0].data, plain(api.bpcAutomationConfig(SYS, DIA, last)), "sources found by discovery");
  const flows = hass.log.api.filter((c) => c.data && c.data.state);
  assert.deepEqual(flows.map((f) => f.data.name), ["Blood pressure systolic today", "Blood pressure diastolic today"]);
  for (const f of flows) {
    assert.equal(f.data.unit_of_measurement, "mmHg");
    assert.equal(f.data.state_class, "measurement");
    assert.ok(!("device_class" in f.data));
  }
  assert.equal(flows[0].data.state, api.bpcTodayTemplate(SYS, last));
  assert.equal(flows[1].data.state, api.bpcTodayTemplate(DIA, last));
});

test("create helpers: initial value of the input_datetime", async () => {
  const now = Date.now();
  const s = (v, t) => ({ s: String(v), lu: t / 1000 });
  /* last reading 3 hours ago in the recorder history */
  let hass = helperHass({ history: {
    [SYS]: [s(130, now - 5 * DAY), s(124, now - 2 * DAY), s(128, now - 3 * H)],
    [DIA]: [s(84, now - 5 * DAY), s(80, now - 3 * H + 5000)]
  } });
  await api.bpcCreateHelpers(hass, {}, 0);
  const hist = hass.log.ws.find((m) => m.type === "history/history_during_period");
  assert.deepEqual(hist.entity_ids, [SYS, DIA]);
  assert.ok(Math.abs(Date.parse(hist.start_time) - (now - 30 * DAY)) < 60000, "last 30 days");
  assert.deepEqual(hass.log.services, [{ domain: "input_datetime", service: "set_datetime",
    data: { entity_id: "input_datetime.blood_pressure_last_measurement", timestamp: Math.round((now - 3 * H) / 1000) } }]);
  /* no reading in the history (only the baseline): "never measured", not today 00:00 */
  hass = helperHass({ history: { [SYS]: [s(130, now - 5 * DAY)] } });
  await api.bpcCreateHelpers(hass, {}, 0);
  assert.deepEqual(hass.log.services[0].data,
    { entity_id: "input_datetime.blood_pressure_last_measurement", datetime: "2000-01-01 00:00:00" });
  assert.equal(api.BPC_NEVER, "2000-01-01 00:00:00");
});

test("create helpers: existing helpers are reused by name, nothing is created twice", async () => {
  const first = helperHass();
  const r1 = await api.bpcCreateHelpers(first, {}, 0);
  assert.equal(r1.created, 4);
  /* the same instance after the creation, with a card without links */
  const second = helperHass();
  for (const e of first.registry) second.states[e.entity_id] = { state: "unknown", attributes: {} };
  second.states["automation.blood_pressure_record_measurement"] = { state: "on",
    attributes: { friendly_name: "Blood pressure record measurement" } };
  const r2 = await api.bpcCreateHelpers(second, {}, 0);
  assert.equal(r2.error, null);
  assert.equal(r2.created, 0);
  assert.equal(r2.reused, 4);
  assert.equal(second.log.ws.length + second.log.api.length + second.log.services.length, 0);
  for (const k of api.BPC_HELPER_KEYS) assert.equal(r2.config[k], r1.config[k]);
  /* pressing the button again with the links in place */
  const r3 = await api.bpcCreateHelpers(second, r2.config, 0);
  assert.deepEqual([r3.created, r3.reused], [0, 4]);
  /* an automation with another entity id is found by its friendly name; helpers made by hand stay linked */
  const third = helperHass();
  third.states["automation.my_rule"] = { state: "on", attributes: { friendly_name: "Blood pressure record measurement" } };
  third.states["input_datetime.my_last"] = { state: "2026-03-10 07:00:00", attributes: { timestamp: T0 / 1000 } };
  const r4 = await api.bpcCreateHelpers(third, { last_entity: "input_datetime.my_last" }, 0);
  assert.equal(r4.config.last_entity, "input_datetime.my_last");
  assert.deepEqual([r4.created, r4.reused], [2, 2]);
  assert.equal(autoCalls(third).length, 0);
  assert.match(third.log.api.find((c) => c.data && c.data.state).data.state, /input_datetime\.my_last/);
});

test("create helpers: without blood pressure sensors nothing is created", async () => {
  const hass = helperHass({ noMonitor: true });
  const r = await api.bpcCreateHelpers(hass, { title: "X" }, 0);
  assert.equal(r.noSensors, true);
  assert.equal(r.created, 0);
  assert.equal(hass.log.ws.length + hass.log.api.length + hass.log.services.length, 0);
  /* configured sensors are used even when discovery finds nothing */
  const r2 = await api.bpcCreateHelpers(hass, { systolic_entity: "sensor.s", diastolic_entity: "sensor.d" }, 0);
  assert.equal(r2.noSensors, false);
  assert.equal(r2.created, 4);
  assert.deepEqual(autoCalls(hass)[0].data.trigger[0].entity_id, ["sensor.s", "sensor.d"]);
});

test("create helpers: a config flow error keeps the helpers already created", async () => {
  const hass = helperHass({ failTemplate: true });
  const r = await api.bpcCreateHelpers(hass, {}, 0);
  assert.match(r.error, /invalid_template/);
  assert.equal(r.created, 2);
  assert.equal(r.config.last_entity, "input_datetime.blood_pressure_last_measurement");
  assert.equal(r.config.systolic_today_entity, undefined);
  /* a second press continues where it stopped */
  const ok = helperHass();
  for (const e of hass.registry) ok.states[e.entity_id] = { state: "unknown", attributes: {} };
  ok.states["automation.blood_pressure_record_measurement"] = { state: "on", attributes: {} };
  const r2 = await api.bpcCreateHelpers(ok, r.config, 0);
  assert.equal(r2.error, null);
  assert.deepEqual([r2.created, r2.reused], [2, 2]);
  assert.equal(ok.log.ws.filter((m) => m.type === "input_datetime/create").length, 0);
  assert.equal(autoCalls(ok).length, 0);
});

test("the YAML package matches what the button creates", () => {
  const pkg = readFileSync(new URL("../examples/packages/blood_pressure.yaml", import.meta.url), "utf8");
  const H_ = api.BPC_HELPERS;
  const last = "input_datetime." + api.bpcSlug(H_.last.name);
  assert.ok(pkg.includes("\n  " + api.bpcSlug(H_.last.name) + ":\n"), "input_datetime object id");
  assert.ok(pkg.includes("name: " + H_.last.name));
  assert.ok(pkg.includes("icon: " + H_.last.icon));
  assert.ok(pkg.includes("alias: " + H_.automation.name));
  assert.ok(pkg.includes("max_exceeded: silent"));
  assert.ok(pkg.includes(api.bpcAutomationConfig("a", "b", last).condition[0].value_template), "automation condition");
  for (const t of H_.today) {
    assert.ok(pkg.includes("name: " + t.name), t.name);
    assert.ok(pkg.includes("unique_id: " + api.bpcSlug(t.name)), t.name);
  }
  assert.ok(pkg.includes(api.bpcTodayTemplate("sensor.my_monitor_systolic", last)), "systolic template");
  assert.ok(pkg.includes(api.bpcTodayTemplate("sensor.my_monitor_diastolic", last)), "diastolic template");
  assert.equal((pkg.match(/state_class: measurement/g) || []).length, 2);
  assert.ok(!/device_class/.test(pkg));
});
