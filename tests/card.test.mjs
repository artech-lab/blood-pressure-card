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
  " bpcMergeDays, bpcAverage, bpcEditorSchema, bpcCleanConfig };",
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

test("merge: exact days from the history, statistics before it", () => {
  const stat = (date) => ({ date, source: "statistics" });
  const read = (date) => ({ date, source: "readings" });
  const stats = { "2026-03-01": stat("2026-03-01"), "2026-03-05": stat("2026-03-05"), "2026-03-08": stat("2026-03-08") };
  const from = Date.UTC(2026, 2, 5, 12);
  let merged = plain(api.bpcMergeDays({ "2026-03-08": read("2026-03-08") }, stats, from));
  assert.deepEqual(merged.map((d) => d.date + ":" + d.source),
    ["2026-03-01:statistics", "2026-03-05:statistics", "2026-03-08:readings"]);
  merged = plain(api.bpcMergeDays({ "2026-03-05": read("2026-03-05") }, stats, from));
  assert.deepEqual(merged.map((d) => d.source), ["statistics", "readings"]);
  assert.equal(plain(api.bpcMergeDays({}, stats, null)).length, 3);
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
