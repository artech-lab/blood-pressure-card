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
  const log = { ws: [], more: [], api: [], services: [] };
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
  // optional helpers: the "today" sensors and the time of the last measurement (3 hours ago)
  if (opts.helpers) {
    add("sensor.blood_pressure_systolic_today", "mmHg", "unknown");
    add("sensor.blood_pressure_diastolic_today", "mmHg", "unknown");
    states["input_datetime.blood_pressure_last_measurement"] = { state: "x", attributes: { timestamp: (now - 3 * H) / 1000 } };
  }
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
    "sensor.arm_monitor_diastolic": [{ start: day(9), min: 82, max: 92, mean: 86 }, { start: day(8), min: 92, max: 92, mean: 92 }],
    // daily statistics of the "today" helpers: a flat day (one reading) and the start day of the raw history
    "sensor.blood_pressure_systolic_today": [{ start: day(7), min: 141, max: 141, mean: 141 }, { start: day(5), min: 129, max: 135, mean: 132 }],
    "sensor.blood_pressure_diastolic_today": [{ start: day(7), min: 89, max: 89, mean: 89 }, { start: day(5), min: 80, max: 86, mean: 83 }]
  };
  const registry = [];
  let flows = 0;
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return {
    language: lang, locale: { language: lang }, states: states, entities: entities, config: { country: opts.country || "IT" },
    user: { is_admin: !!opts.admin },
    callWS: async function (msg) {
      log.ws.push(msg.type);
      await new Promise((r) => setTimeout(r, 5));
      if (msg.type === "history/history_during_period") return raw;
      if (msg.type === "recorder/statistics_during_period") {
        log.statIds = msg.statistic_ids;
        const out = {};
        for (const id of msg.statistic_ids) if (stats[id]) out[id] = stats[id];
        return out;
      }
      if (msg.type === "config/entity_registry/list") return registry;
      if (msg.type === "input_datetime/create") {
        registry.push({ entity_id: "input_datetime." + slug(msg.name), platform: "input_datetime", unique_id: slug(msg.name) });
        return { id: slug(msg.name) };
      }
      throw new Error("unexpected " + msg.type);
    },
    callApi: async function (method, path, data) {
      log.api.push(path);
      await new Promise((r) => setTimeout(r, 5));
      if (path.indexOf("config/automation/config/") === 0) return { result: "ok" };
      if (path === "config/config_entries/flow") { flows += 1; return { type: "menu", flow_id: "f" + flows }; }
      if (data.next_step_id) return { type: "form", flow_id: path.split("/").pop() };
      registry.push({ entity_id: "sensor." + slug(data.name), platform: "template", config_entry_id: "e" + flows });
      return { type: "create_entry", result: { entry_id: "e" + flows } };
    },
    callService: async function (domain, service, data) {
      log.services.push([domain, service, data]);
    }
  };
};
window.mountEditor = function (config, hass) {
  const ed = document.createElement("blood-pressure-card-editor");
  ed._hpWait = 1;
  window.__configs = [];
  ed.addEventListener("config-changed", (ev) => { window.__configs.push(ev.detail.config); });
  document.getElementById("host").innerHTML = "";
  document.getElementById("host").appendChild(ed);
  ed.setConfig(config);
  ed.hass = hass;
  window.editor = ed;
  return ed;
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
assert.match(await q("#hsub"), /^ESC\/ESH guidelines . measured just now$/);
assert.equal(await q("#ref"), "Optimal: below 120/80 mmHg (ESC)");
assert.equal(await q(".histhead"), "60-day history");
assert.equal(await hidden("#avg"), true, "the 7-day average is off by default");
assert.equal(await page.evaluate(() => window.card.shadowRoot.querySelectorAll("#row_sys .seg").length), 5, "five ESH segments");
assert.deepEqual(await page.evaluate(() => [...window.card.shadowRoot.querySelectorAll("#row_sys .tick")].map((t) => t.textContent)),
  ["120", "130", "140", "160"]);
assert.deepEqual(await page.evaluate(() => [...window.card.shadowRoot.querySelectorAll("#row_dia .tick")].map((t) => t.textContent)),
  ["80", "85", "90", "100"]);
assert.equal(await page.evaluate(() => window.card.shadowRoot.querySelector("#big .chip") !== null), true, "the chip is in the clickable row");
assert.deepEqual(await page.evaluate(() => window.__log.ws.sort()),
  ["history/history_during_period", "recorder/statistics_during_period"]);
console.log("ok - discovery and rendering");

// 2. history: two exact days, the statistics day before the history, the restore ignored
const capsules = await page.evaluate(() => window.card._points.map((p) => p.x.source + ":" + (p.x.count || "-")));
assert.deepEqual(capsules, ["statistics:-", "readings:1", "readings:1"]);
assert.equal(await page.evaluate(() => window.card.shadowRoot.querySelectorAll("svg line[opacity='0.6']").length), 0,
  "statistics days at full opacity");
await page.evaluate(() => window.mount({ show_average: true }, window.makeHass("en")));
await settle();
assert.equal(await hidden("#avg"), false);
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
assert.equal(await page.evaluate(() => window.card.shadowRoot.querySelectorAll("#tip > div").length), 3, "header, SYS and DIA only");
const tiph = await q("#tip .tiph");
const today = new Date();
assert.equal(tiph, today.toLocaleDateString("en", { weekday: "short" }) + " " + today.getDate() + "/" + (today.getMonth() + 1) + " Normal");
console.log("ok - tooltip");

// 3b. history with the "today" helpers: helper days before and on the start day of the raw history
const TODAY = { systolic_today_entity: "sensor.blood_pressure_systolic_today",
  diastolic_today_entity: "sensor.blood_pressure_diastolic_today", last_entity: "input_datetime.blood_pressure_last_measurement" };
await page.evaluate((cfg) => window.mount(cfg, window.makeHass("en", { helpers: true })), TODAY);
await settle();
assert.deepEqual(await page.evaluate(() => window.__log.statIds), ["sensor.arm_monitor_systolic", "sensor.arm_monitor_diastolic",
  "sensor.blood_pressure_systolic_today", "sensor.blood_pressure_diastolic_today"]);
assert.equal(await page.evaluate(() => window.__log.ws.filter((t) => t === "recorder/statistics_during_period").length), 1,
  "one statistics call for all sensors");
// the statistics day is 9 days old (the helpers start 7 days ago); 5 days ago is the start of the raw history
assert.deepEqual(await page.evaluate(() => window.card._points.map((p) => p.x.source)),
  ["statistics", "helpers", "helpers", "readings", "readings"]);
const tipAt = (i) => page.evaluate((i) => {
  const svg = window.card.shadowRoot.querySelector("svg");
  const r = svg.getBoundingClientRect();
  const p = window.card._points[i];
  svg.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + p.cx * r.width / 480, clientY: r.top + 50 }));
  return window.card.shadowRoot.getElementById("tip").textContent;
}, i);
const tip1 = await tipAt(1);
assert.match(tip1, /SYS min 141 . avg 141 . max 141/);
assert.doesNotMatch(tip1, /reading|sensors|statistics/, "no source line in the tooltip");
assert.match(await q("#hsub"), /measured just now$/, "the last reading in the history is more recent than the helper");
// without raw history the time comes from the helper
await page.evaluate((cfg) => window.mount(cfg, window.makeHass("it", { helpers: true, noRaw: true })), TODAY);
await settle();
assert.match(await q("#hsub"), /^linee guida ESC\/ESH . misura 3 h fa$/);
assert.deepEqual(await page.evaluate(() => window.card._points.map((p) => p.x.source)), ["statistics", "helpers", "helpers"]);
assert.match(await tipAt(2), /^\S+ \d+\/\d+ \S+/);
assert.match(await tipAt(2), /SYS min \d+ . media \d+ . max \d+DIA min/);
// a new measurement recorded in the helper reloads the history
const before = await page.evaluate(() => window.__log.ws.length);
await page.evaluate(() => {
  const h = Object.assign({}, window.card._hass);
  h.states = Object.assign({}, h.states, { "input_datetime.blood_pressure_last_measurement":
    { state: "y", attributes: { timestamp: Date.now() / 1000 - 30 } } });
  window.card.hass = h;
});
await settle();
assert.equal(await page.evaluate(() => window.__log.ws.length), before + 2);
assert.match(await q("#hsub"), /misura adesso$/);
console.log("ok - history with helpers");

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

// 5b. ESH grade 3 (185/112): five segments, the marker at the end of the red one
await page.evaluate(() => window.mount({ show_average: true }, window.makeHass("it", { sys: 185, dia: 112 })));
await settle();
assert.equal(await q("#chip"), "Ipertensione 3");
assert.equal(await q("#rz_sys"), "Ipertensione 3");
assert.equal(await q("#rz_dia"), "Ipertensione 3");
assert.equal(await q("#ref"), "Ottimale: sotto 120/80 mmHg (ESC)");
assert.equal(await q(".histhead"), "Storico 60 giorni");
const g3 = await page.evaluate(() => {
  const r = window.card.shadowRoot;
  const pos = (k) => {
    const segs = [...r.querySelectorAll("#row_" + k + " .seg")];
    const red = segs[segs.length - 1].getBoundingClientRect(), band = r.querySelector("#row_" + k + " .band").getBoundingClientRect();
    const mk = r.getElementById(k + "_mk");
    const c = mk.getBoundingClientRect();
    return { segs: segs.length, inRed: c.left + c.width / 2 >= red.left && c.left + c.width / 2 <= band.right + 0.5,
      left: parseFloat(mk.style.left), color: mk.style.background, chip: r.getElementById("chip").style.background,
      redEnd: Math.abs(red.right - band.right) < 0.5 };
  };
  return { sys: pos("sys"), dia: pos("dia") };
});
assert.equal(g3.sys.segs, 5);
assert.equal(g3.sys.redEnd, true, "the red segment reaches the end of the scale");
assert.equal(g3.sys.inRed, true, "systolic marker in the red segment");
assert.equal(g3.dia.inRed, true, "diastolic marker in the red segment");
assert.equal(g3.sys.left, 95);
assert.match(g3.sys.chip, /blood-pressure-severe-color/);
assert.match(g3.sys.color, /blood-pressure-severe-color/);
// a value beyond the scale stays at its end
await page.evaluate(() => window.mount({}, window.makeHass("en", { sys: 230, dia: 135 })));
await settle();
assert.deepEqual(await page.evaluate(() => [parseFloat(window.card.shadowRoot.getElementById("sys_mk").style.left),
  parseFloat(window.card.shadowRoot.getElementById("dia_mk").style.left)]), [100, 100]);
assert.equal(await q("#chip"), "Hypertension 3");
console.log("ok - ESH grade 3");

// 5c. missing values: only the dashes, no waiting line
await page.evaluate(() => { const h = window.makeHass("en"); h.states["sensor.arm_monitor_systolic"].state = "unknown";
  h.states["sensor.arm_monitor_diastolic"].state = "unavailable"; window.mount({}, h); });
await settle();
assert.equal(await q("#v_sys"), "--");
assert.equal(await q("#v_dia"), "--");
assert.equal(await hidden("#chip"), true);
assert.equal(await page.evaluate(() => window.card.shadowRoot.getElementById("wait")), null);
assert.doesNotMatch(await page.evaluate(() => window.card.shadowRoot.querySelector("ha-card").textContent), /Waiting/);
// the whole value row opens the systolic sensor, also from the keyboard
await page.evaluate(() => { window.__log.more = []; window.card.shadowRoot.querySelector("#big .bigunit").click();
  window.card.shadowRoot.getElementById("big").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true })); });
assert.deepEqual(await page.evaluate(() => window.__log.more), ["sensor.arm_monitor_systolic", "sensor.arm_monitor_systolic"]);
console.log("ok - missing values and value row");

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
  const shown = [data.history_days, data.show_average];
  form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: Object.assign({}, data, { title: "", history_days: 90 }) } }));
  return { out, labels, guideline: data.guideline, shown };
});
assert.deepEqual(cfg.labels, ["Linea guida di classificazione", "Giorni di storico"]);
assert.equal(cfg.guideline, "esh_2023");
assert.equal(cfg.out.systolic_entity, "sensor.arm_monitor_systolic");
assert.deepEqual(cfg.shown, [60, false], "the editor shows the new defaults");
assert.equal(cfg.out.history_days, 90);
assert.ok(!("sys_entity" in cfg.out) && !("title" in cfg.out) && !("show_history" in cfg.out) && !("show_average" in cfg.out));
console.log("ok - editor");

// 8. editor: the "Create helpers" button
const hp = (sel) => page.evaluate((s) => {
  const el = window.editor.querySelector(s);
  return el ? { text: el.textContent, hidden: el.hidden } : null;
}, sel);
await page.evaluate(() => window.mountEditor({ type: "custom:blood-pressure-card", guideline: "esc_2024" },
  window.makeHass("en", { admin: true })));
await page.waitForFunction(() => window.editor.querySelector(".bpc-hp button"), null, { timeout: 5000 });
assert.equal((await hp(".bpc-hp-t")).text, "Helpers for history and automations");
assert.equal((await hp(".bpc-hp-s")).text, "0 of 3 helpers linked");
assert.equal((await hp(".bpc-hp button")).text, "Create helpers");
assert.equal((await hp(".bpc-hp button")).hidden, false);
const schema = await page.evaluate(() => window.editor.querySelector("ha-form").schema.map((s) => s.name));
assert.equal(schema[schema.length - 1], "helpers", "expandable section with the three entity selectors");
await page.evaluate(() => window.editor.querySelector(".bpc-hp button").click());
assert.equal((await hp(".bpc-hp button")).text, "Creating helpers...");
await page.waitForFunction(() => /^Done:/.test(window.editor.querySelector(".bpc-hp-s").textContent), null, { timeout: 15000 });
const r8 = await page.evaluate(() => ({ status: window.editor.querySelector(".bpc-hp-s").textContent, configs: window.__configs,
  log: window.__log, data: window.editor.querySelector("ha-form").data }));
assert.match(r8.status, /^Done: 4 created, 0 already present. Save the card/);
assert.equal(r8.configs.length, 1);
assert.deepEqual(r8.configs[0], { type: "custom:blood-pressure-card", guideline: "esc_2024",
  last_entity: "input_datetime.blood_pressure_last_measurement",
  systolic_today_entity: "sensor.blood_pressure_systolic_today", diastolic_today_entity: "sensor.blood_pressure_diastolic_today" });
assert.equal(r8.data.last_entity, "input_datetime.blood_pressure_last_measurement", "the form shows the links");
assert.equal(r8.log.ws.filter((t) => t === "input_datetime/create").length, 1);
assert.equal(r8.log.api.filter((p) => p.indexOf("config/automation/config/") === 0).length, 1);
assert.equal(r8.log.api.filter((p) => p === "config/config_entries/flow").length, 2);
assert.deepEqual(r8.log.services.map((s) => s[0] + "." + s[1]), ["input_datetime.set_datetime"]);
// no blood pressure sensors: a message, nothing created
await page.evaluate(() => {
  const h = window.makeHass("en", { admin: true });
  h.states = {};
  h.entities = {};
  window.mountEditor({}, h);
});
await page.waitForFunction(() => window.editor.querySelector(".bpc-hp button"), null, { timeout: 5000 });
await page.evaluate(() => window.editor.querySelector(".bpc-hp button").click());
await page.waitForFunction(() => window.editor.querySelector(".bpc-hp-s.err"), null, { timeout: 5000 });
assert.match((await hp(".bpc-hp-s")).text, /^Pick the systolic and diastolic sensors first/);
assert.deepEqual(await page.evaluate(() => [window.__configs.length, window.__log.api.length, window.__log.ws.length]), [0, 0, 0]);
// a user who is not an administrator sees no button
await page.evaluate(() => window.mountEditor({ type: "custom:blood-pressure-card" }, window.makeHass("it")));
await page.waitForFunction(() => window.editor.querySelector(".bpc-hp button"), null, { timeout: 5000 });
assert.equal((await hp(".bpc-hp button")).hidden, true);
assert.equal((await hp(".bpc-hp-s")).text, "Solo un amministratore pu\u00f2 creare gli helper.");
assert.equal((await hp(".bpc-hp-t")).text, "Helper per storico e automazioni");
console.log("ok - create helpers from the editor");

assert.deepEqual(errors, [], "no page errors");
await browser.close();
console.log("all end-to-end tests passed");
