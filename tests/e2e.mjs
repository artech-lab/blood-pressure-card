// End-to-end test in a real browser engine, with a simulated Home Assistant.
// Requires the dev dependencies:  npm install && npx playwright install chromium
// Run with:  npm run test:e2e   (a few seconds; CHROME_PATH=/path/to/chrome to use another browser)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const CARD = fileURLToPath(new URL("../dist/blood-pressure-card.js", import.meta.url));

const STUBS = `
<style>body{margin:0;padding:16px;background:#111;font-family:sans-serif;
  --primary-color:#03a9f4;--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;
  --card-background-color:#1c1c1c;--divider-color:rgba(225,225,225,.12);}
  #host{width:420px}</style>
<div id="host"></div>
<script>
customElements.define("ha-card", class extends HTMLElement {
  constructor(){ super(); this.attachShadow({mode:"open"}).innerHTML = '<slot></slot>'; }
});
customElements.define("ha-icon", class extends HTMLElement {});
customElements.define("ha-form", class extends HTMLElement {});
const H = 3600000, DAY = 86400000;
window.makeHass = function (lang, opts) {
  opts = opts || {};
  const log = { ws: [], more: [] };
  window.__log = log;
  const now = Date.now();
  const states = {}, entities = {};
  const add = function (id, unit, value, key) {
    states[id] = { state: String(value), attributes: { unit_of_measurement: unit, friendly_name: id } };
    entities[id] = { entity_id: id, device_id: "monitor", platform: "demo", translation_key: key || null };
  };
  add("sensor.arm_monitor_systolic", "mmHg", opts.sys || 126, "systolic_blood_pressure");
  add("sensor.arm_monitor_diastolic", "mmHg", opts.dia || 81, "diastolic_blood_pressure");
  add("sensor.arm_monitor_pulse", "bpm", 66, "heart_pulse");
  add("sensor.room_pressure", "hPa", 1013);
  const day = (n) => { const d = new Date(now - n * DAY); d.setHours(0, 0, 0, 0); return d.getTime(); };
  // recorder: two readings in the raw history (yesterday and a minute ago), statistics for older days
  const raw = opts.noRaw ? {} : {
    "sensor.arm_monitor_systolic": [
      { s: "131", lu: (now - 5 * DAY) / 1000 }, { s: "unavailable", lu: (now - 2 * DAY) / 1000 },
      { s: "131", lu: (now - 2 * DAY + 60000) / 1000 }, { s: "138", lu: (day(1) + 10 * H) / 1000 },
      { s: String(opts.sys || 126), lu: (now - 60000) / 1000 }],
    "sensor.arm_monitor_diastolic": [
      { s: "83", lu: (now - 5 * DAY) / 1000 }, { s: "88", lu: (day(1) + 10 * H + 4000) / 1000 },
      { s: String(opts.dia || 81), lu: (now - 58000) / 1000 }]
  };
  const stats = {
    "sensor.arm_monitor_systolic": [{ start: day(9), min: 128, max: 144, mean: 133 }, { start: day(8), min: 144, max: 144, mean: 144 }],
    "sensor.arm_monitor_diastolic": [{ start: day(9), min: 82, max: 92, mean: 86 }, { start: day(8), min: 92, max: 92, mean: 92 }]
  };
  return {
    language: lang, locale: { language: lang }, states: states, entities: entities, config: { country: opts.country || "IT" },
    callWS: async function (msg) {
      log.ws.push(msg.type);
      if (msg.type === "history/history_during_period") return raw;
      if (msg.type === "recorder/statistics_during_period") return stats;
      throw new Error("unexpected " + msg.type);
    }
  };
};
window.mount = function (config, hass) {
  const card = document.createElement("blood-pressure-card");
  card.setConfig(Object.assign({ type: "custom:blood-pressure-card" }, config));
  card.addEventListener("hass-more-info", function (ev) { window.__log.more.push(ev.detail.entityId); });
  document.getElementById("host").innerHTML = "";
  document.getElementById("host").appendChild(card);
  card.hass = hass;
  window.card = card;
  return card;
};
</script>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.setContent(STUBS);
await page.addScriptTag({ path: CARD });
const q = (sel) => page.evaluate((s) => {
  const el = window.card.shadowRoot.querySelector(s);
  return el ? el.textContent.trim() : null;
}, sel);
const hidden = (sel) => page.evaluate((s) => window.card.shadowRoot.querySelector(s).hidden, sel);
const settle = () => page.waitForTimeout(150);

// 1. discovery and rendering without configuration
await page.evaluate(() => window.mount({}, window.makeHass("en")));
await settle();
assert.equal(await q("#v_sys"), "126");
assert.equal(await q("#v_dia"), "81");
assert.equal(await q("#chip"), "Normal");
assert.equal(await q("#rz_sys"), "Normal");
assert.equal(await q("#pv"), "66 bpm");
assert.match(await q("#hsub"), /^ESH 2023 guideline . measured just now$/);
assert.equal(await q("#ref"), "Optimal: below 120/80 mmHg");
assert.deepEqual(await page.evaluate(() => window.__log.ws.sort()),
  ["history/history_during_period", "recorder/statistics_during_period"]);
console.log("ok - discovery and rendering");

// 2. history: two exact days, the statistics day before the history, the restore ignored
const capsules = await page.evaluate(() => window.card._points.map((p) => p.x.source + ":" + (p.x.count || "-")));
assert.deepEqual(capsules, ["statistics:-", "readings:1", "readings:1"]);
assert.equal(await q("#av"), "132/85", "mean of the two exact days (the statistics day is older than 7 days)");
console.log("ok - history");

// 3. tooltip on the last day
await page.evaluate(() => {
  const svg = window.card.shadowRoot.querySelector("svg");
  const r = svg.getBoundingClientRect();
  const p = window.card._points[window.card._points.length - 1];
  svg.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + p.cx * r.width / 480, clientY: r.top + 50 }));
});
assert.match(await q("#tip"), /SYS min 126 . avg 126 . max 126/);
assert.match(await q("#tip"), /1 reading$/);
console.log("ok - tooltip");

// 4. more-info from a click and from the keyboard
await page.evaluate(() => window.card.shadowRoot.getElementById("row_dia").click());
await page.evaluate(() => window.card.shadowRoot.getElementById("pulse").dispatchEvent(
  new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true })));
assert.deepEqual(await page.evaluate(() => window.__log.more), ["sensor.arm_monitor_diastolic", "sensor.arm_monitor_pulse"]);
console.log("ok - more-info");

// 5. Italian, ACC/AHA, options of the previous version, statistics only
await page.evaluate(() => window.mount({ sys_entity: "sensor.arm_monitor_systolic", dia_entity: "sensor.arm_monitor_diastolic",
  guideline: "acc_aha_2025", title: "<b>Pressione</b>", show_reference: false },
  window.makeHass("it", { sys: 125, dia: 82, noRaw: true })));
await settle();
assert.equal(await q("#chip"), "Stadio 1");
assert.equal(await q("#rz_sys"), "Elevata");
assert.equal(await q(".htitle"), "<b>Pressione</b>", "the title is text, not HTML");
assert.match(await q("#hsub"), /^linee guida ACC\/AHA 2025 . misurata il /);
assert.equal(await hidden("#ref"), true);
assert.equal(await hidden("#pulse"), true, "no pulse is guessed for configured sensors");
assert.equal(await hidden("#avg"), true, "no day in the last week");
console.log("ok - Italian, guideline, previous options");

// 6. no sensors
await page.evaluate(() => { const h = window.makeHass("en"); h.states = {}; h.entities = {}; window.mount({}, h); });
assert.equal(await q(".empty .t"), "No blood pressure sensors found");
console.log("ok - empty state");

// 7. editor: emits a clean configuration
const cfg = await page.evaluate(async () => {
  const ed = document.createElement("blood-pressure-card-editor");
  let out = null;
  ed.addEventListener("config-changed", (ev) => { out = ev.detail.config; });
  document.getElementById("host").appendChild(ed);
  ed.setConfig({ type: "custom:blood-pressure-card", sys_entity: "sensor.arm_monitor_systolic" });
  ed.hass = window.makeHass("it");
  await new Promise((r) => setTimeout(r, 50));
  const form = ed.querySelector("ha-form");
  const labels = [form.computeLabel({ name: "guideline" }), form.computeLabel({ name: "history_days" })];
  const data = form.data;
  form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: Object.assign({}, data, { title: "", history_days: 60 }) } }));
  return { out, labels, guideline: data.guideline };
});
assert.deepEqual(cfg.labels, ["Linea guida di classificazione", "Giorni di storico"]);
assert.equal(cfg.guideline, "esh_2023");
assert.equal(cfg.out.systolic_entity, "sensor.arm_monitor_systolic");
assert.equal(cfg.out.history_days, 60);
assert.ok(!("sys_entity" in cfg.out) && !("title" in cfg.out) && !("show_history" in cfg.out));
console.log("ok - editor");

assert.deepEqual(errors, [], "no page errors");
await browser.close();
console.log("all end-to-end tests passed");
