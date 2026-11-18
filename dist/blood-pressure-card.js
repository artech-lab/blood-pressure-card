/*
 * Blood Pressure Card for Home Assistant
 * https://github.com/artech-lab/blood-pressure-card
 *
 * A dashboard card for blood pressure monitors: the last reading on the bands
 * of the ESH 2023, ESC 2024 or ACC/AHA 2025 guideline, its category, the pulse,
 * a 7-day average and a daily history of the readings.
 *
 * Works out of the box: the card finds the systolic, diastolic and pulse
 * sensors of the monitor by itself (Withings, Omron, Health Connect, ESPHome,
 * any integration). The history comes from the recorder: exact readings while
 * they are kept, long-term statistics for older days.
 *
 * Copyright (C) 2026 The blood-pressure-card contributors
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option)
 * any later version. This program is distributed in the hope that it will be
 * useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General
 * Public License for more details: <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The source is plain ASCII: non-ASCII characters are written as \u escapes.
 */

const BPC_VERSION = "1.0.0";
const BPC_TAG = "blood-pressure-card";
const BPC_EDITOR_TAG = BPC_TAG + "-editor";
const BPC_REPO_URL = "https://github.com/artech-lab/blood-pressure-card";
const BPC_DOT = "\u00b7";
const BPC_DAY = 86400000;
const BPC_HOUR = 3600000;
/* Monitors and cloud integrations update systolic and diastolic separately:
   changes closer than this belong to the same reading. */
const BPC_PAIR_MS = 120000;
/* A daily statistic is a day with readings only if its value moved by more
   than this: a flat day is the previous reading carried over. */
const BPC_FLAT = 0.001;

const BPC_DEFAULTS = {
  history_days: 30,
  show_history: true,
  show_average: true,
  show_reference: true
};

/* Office blood pressure classifications. "systolic" and "diastolic" hold the
   lower bound (mmHg) of every category after the first. A reading takes the
   higher category reached by either value ("and/or" in all three guidelines).
   A repeated bound means the category in between cannot be reached by that
   value alone: in the ACC/AHA table "elevated" needs a diastolic below 80. */
const BPC_GUIDELINES = {
  // 2023 ESH Guidelines for the management of arterial hypertension.
  esh_2023: {
    categories: ["optimal", "normal", "high_normal", "grade_1_hypertension", "grade_2_hypertension", "grade_3_hypertension"],
    systolic: [120, 130, 140, 160, 180],
    diastolic: [80, 85, 90, 100, 110]
  },
  // 2024 ESC Guidelines for the management of elevated blood pressure and hypertension.
  esc_2024: {
    categories: ["non_elevated", "elevated", "hypertension"],
    systolic: [120, 140],
    diastolic: [70, 90]
  },
  // 2025 AHA/ACC guideline for high blood pressure in adults (same categories as 2017).
  acc_aha_2025: {
    categories: ["normal", "elevated", "stage_1_hypertension", "stage_2_hypertension"],
    systolic: [120, 130, 140],
    diastolic: [80, 80, 90]
  }
};
const BPC_DEFAULT_GUIDELINE = "esh_2023";
/* Countries whose users most likely follow the ACC/AHA guideline. */
const BPC_ACC_AHA_COUNTRIES = ["US"];

/* Colours by number of categories, from the lowest to the highest. */
const BPC_SEVERE = "var(--blood-pressure-severe-color, #b71c1c)";
const BPC_PALETTES = {
  3: ["var(--green-color, #4caf50)", "var(--amber-color, #ffc107)", "var(--red-color, #f44336)"],
  4: ["var(--green-color, #4caf50)", "var(--amber-color, #ffc107)", "var(--orange-color, #ff9800)",
    "var(--red-color, #f44336)"],
  6: ["var(--green-color, #4caf50)", "var(--light-green-color, #8bc34a)", "var(--amber-color, #ffc107)",
    "var(--orange-color, #ff9800)", "var(--red-color, #f44336)", BPC_SEVERE]
};

/* Words that identify the sensors of a monitor, whatever the integration and language. */
const BPC_WORDS = {
  systolic: ["systol", "sistol"],
  diastolic: ["diastol"],
  pulse: ["pulse", "puls", "battito"],
  heart: ["heart", "frequenza", "cardi"],
  derived: ["average", "media", "mean", "resting", "riposo", "min", "max"]
};

const BPC_I18N = {
  en: {
    card_name: "Blood Pressure Card",
    card_description: "Blood pressure on the bands of the ESH, ESC or ACC/AHA guideline, with category, pulse, 7-day average and daily history.",
    default_title: "Blood pressure",
    systolic: "Systolic",
    diastolic: "Diastolic",
    measured: "measured {when}",
    measured_on: "measured on {date}",
    now: "just now",
    no_sensors: "No blood pressure sensors found",
    no_sensors_hint: "Pick the systolic and diastolic sensors (mmHg) of your monitor in the card editor.",
    no_values: "Waiting for the first reading",
    reference: "{label}: below {sys}/{dia} mmHg",
    average: "7-day average",
    history: "Last {n} days",
    loading: "Loading...",
    no_history: "No readings in this period",
    history_error: "History not available",
    readings: "{n} readings",
    reading: "1 reading",
    from_statistics: "estimated from statistics",
    min: "min",
    mean: "avg",
    max: "max",
    g_esh_2023: "ESH 2023 guideline",
    g_esc_2024: "ESC 2024 guideline",
    g_acc_aha_2025: "ACC/AHA 2025 guideline",
    c_optimal: "Optimal",
    c_normal: "Normal",
    c_high_normal: "High-normal",
    c_grade_1_hypertension: "Hypertension 1",
    c_grade_2_hypertension: "Hypertension 2",
    c_grade_3_hypertension: "Hypertension 3",
    c_non_elevated: "Non-elevated",
    c_elevated: "Elevated",
    c_hypertension: "Hypertension",
    c_stage_1_hypertension: "Stage 1",
    c_stage_2_hypertension: "Stage 2",
    ed_systolic_entity: "Systolic pressure sensor (optional, found automatically)",
    ed_diastolic_entity: "Diastolic pressure sensor (optional, found automatically)",
    ed_pulse_entity: "Pulse sensor (optional, found automatically)",
    ed_guideline: "Classification guideline",
    ed_esh_2023: "ESH 2023 (Europe): optimal ... hypertension grade 3",
    ed_esc_2024: "ESC 2024 (Europe): non-elevated, elevated, hypertension",
    ed_acc_aha_2025: "ACC/AHA 2025 (United States): normal ... hypertension stage 2",
    ed_title: "Title",
    ed_icon: "Icon",
    ed_history_days: "History days",
    ed_show_history: "Show history",
    ed_show_average: "Show 7-day average",
    ed_show_reference: "Show guideline reference"
  },
  it: {
    card_name: "Blood Pressure Card",
    card_description: "Pressione arteriosa sulle fasce della linea guida ESH, ESC o ACC/AHA, con categoria, battito, media di 7 giorni e storico giornaliero.",
    default_title: "Pressione arteriosa",
    systolic: "Sistolica",
    diastolic: "Diastolica",
    measured: "misurata {when}",
    measured_on: "misurata il {date}",
    now: "adesso",
    no_sensors: "Nessun sensore di pressione trovato",
    no_sensors_hint: "Scegli i sensori di pressione sistolica e diastolica (mmHg) del misuratore nell'editor della card.",
    no_values: "In attesa della prima misurazione",
    reference: "{label}: sotto {sys}/{dia} mmHg",
    average: "Media 7 giorni",
    history: "Ultimi {n} giorni",
    loading: "Caricamento...",
    no_history: "Nessuna misurazione nel periodo",
    history_error: "Storico non disponibile",
    readings: "{n} misurazioni",
    reading: "1 misurazione",
    from_statistics: "stimato dalle statistiche",
    min: "min",
    mean: "media",
    max: "max",
    g_esh_2023: "linee guida ESH 2023",
    g_esc_2024: "linee guida ESC 2024",
    g_acc_aha_2025: "linee guida ACC/AHA 2025",
    c_optimal: "Ottimale",
    c_normal: "Normale",
    c_high_normal: "Normale-alta",
    c_grade_1_hypertension: "Ipertensione 1",
    c_grade_2_hypertension: "Ipertensione 2",
    c_grade_3_hypertension: "Ipertensione 3",
    c_non_elevated: "Non elevata",
    c_elevated: "Elevata",
    c_hypertension: "Ipertensione",
    c_stage_1_hypertension: "Stadio 1",
    c_stage_2_hypertension: "Stadio 2",
    ed_systolic_entity: "Sensore pressione sistolica (opzionale, trovato automaticamente)",
    ed_diastolic_entity: "Sensore pressione diastolica (opzionale, trovato automaticamente)",
    ed_pulse_entity: "Sensore battito (opzionale, trovato automaticamente)",
    ed_guideline: "Linea guida di classificazione",
    ed_esh_2023: "ESH 2023 (Europa): ottimale ... ipertensione grado 3",
    ed_esc_2024: "ESC 2024 (Europa): non elevata, elevata, ipertensione",
    ed_acc_aha_2025: "ACC/AHA 2025 (Stati Uniti): normale ... ipertensione stadio 2",
    ed_title: "Titolo",
    ed_icon: "Icona",
    ed_history_days: "Giorni di storico",
    ed_show_history: "Mostra storico",
    ed_show_average: "Mostra media 7 giorni",
    ed_show_reference: "Mostra riferimento della linea guida"
  }
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function bpcLang(hass) {
  const l = (hass && ((hass.locale && hass.locale.language) || hass.language)) ||
    (typeof navigator !== "undefined" ? navigator.language : "en");
  const code = String(l || "en").toLowerCase().split(/[-_]/)[0];
  return BPC_I18N[code] ? code : "en";
}

function bpcLocale(hass) {
  return String((hass && ((hass.locale && hass.locale.language) || hass.language)) || "en").replace("_", "-");
}

function bpcT(lang, key, vars) {
  const table = BPC_I18N[lang] || BPC_I18N.en;
  let s = table[key] != null ? table[key] : (BPC_I18N.en[key] != null ? BPC_I18N.en[key] : key);
  if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}

function bpcEsc(v) {
  return String(v == null ? "" : v).replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]);
}

function bpcNumber(value) {
  if (value === null || value === undefined || value === "" || value === "unknown" || value === "unavailable") return null;
  const n = Number(value);
  return isFinite(n) ? n : null;
}

function bpcNum(hass, id) {
  const st = id && hass && hass.states ? hass.states[id] : null;
  return st ? bpcNumber(st.state) : null;
}

function bpcLevel(value, bounds) {
  let n = 0;
  for (const b of bounds) if (value >= b) n++;
  return n;
}

/* Index in guideline.categories of a reading. */
function bpcClassify(guideline, systolic, diastolic) {
  let level = 0;
  if (systolic !== null && systolic !== undefined) level = Math.max(level, bpcLevel(systolic, guideline.systolic));
  if (diastolic !== null && diastolic !== undefined) level = Math.max(level, bpcLevel(diastolic, guideline.diastolic));
  return level;
}

function bpcColor(index, count) {
  const p = BPC_PALETTES[count] || BPC_PALETTES[6];
  return p[Math.max(0, Math.min(p.length - 1, index))];
}

function bpcDefaultGuideline(hass) {
  const country = hass && hass.config && hass.config.country;
  return BPC_ACC_AHA_COUNTRIES.indexOf(country) >= 0 ? "acc_aha_2025" : BPC_DEFAULT_GUIDELINE;
}

function bpcDayKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function bpcDayStart(key) {
  const p = String(key).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]).getTime();
}

function bpcNiceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function bpcRelative(hass, ms, now) {
  const lang = bpcLang(hass);
  const s = Math.max(0, ((now || Date.now()) - ms) / 1000);
  if (s < 90) return bpcT(lang, "now");
  const [v, u] = s < 3600 ? [Math.round(s / 60), "minute"] : s < 86400 ? [Math.round(s / 3600), "hour"] : [Math.round(s / 86400), "day"];
  try {
    return new Intl.RelativeTimeFormat(bpcLocale(hass), { numeric: "auto" }).format(-v, u);
  } catch (e) {
    return v + " " + u;
  }
}

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

function bpcText(hass, id) {
  const st = hass.states[id];
  const reg = (hass.entities && hass.entities[id]) || {};
  return [id, st && st.attributes && st.attributes.friendly_name, reg.translation_key, reg.name]
    .filter(Boolean).join(" ").toLowerCase();
}

function bpcHas(text, kind) {
  return BPC_WORDS[kind].some((w) => text.indexOf(w) >= 0);
}

/* The sensors of a blood pressure monitor: pressure sensors in mmHg whose name
   says systolic / diastolic (preferably on the same device), and a bpm sensor
   on that device for the pulse. Hidden and diagnostic entities are skipped. */
function bpcDiscover(hass) {
  const out = { systolic: null, diastolic: null, pulse: null };
  if (!hass || !hass.states) return out;
  const pressure = [], rates = [];
  for (const id of Object.keys(hass.states).sort()) {
    if (id.indexOf("sensor.") !== 0) continue;
    const reg = (hass.entities && hass.entities[id]) || {};
    if (reg.hidden || reg.entity_category) continue;
    const unit = String((hass.states[id].attributes || {}).unit_of_measurement || "").toLowerCase();
    if (unit === "mmhg") pressure.push({ id, text: bpcText(hass, id), device: reg.device_id || null });
    else if (unit === "bpm" || unit === "beats/min") rates.push({ id, text: bpcText(hass, id), device: reg.device_id || null });
  }
  const sys = pressure.filter((p) => bpcHas(p.text, "systolic"));
  const dia = pressure.filter((p) => bpcHas(p.text, "diastolic"));
  if (!sys.length || !dia.length) return out;
  let pick = null;
  for (const s of sys) {
    const mate = dia.find((d) => s.device && d.device === s.device);
    if (mate) { pick = [s, mate]; break; }
  }
  if (!pick) pick = [sys[0], dia[0]];
  out.systolic = pick[0].id;
  out.diastolic = pick[1].id;
  const device = pick[0].device;
  /* the pulse of the reading: "pulse" before "heart rate", averages last */
  const score = (r) => 2 * bpcHas(r.text, "pulse") + bpcHas(r.text, "heart") - 3 * bpcHas(r.text, "derived");
  const pulses = rates.filter((r) => device && r.device === device);
  pulses.sort((a, b) => score(b) - score(a));
  if (pulses.length) out.pulse = pulses[0].id;
  return out;
}

/* The effective configuration: options of earlier versions are accepted
   (sys_entity, dia_entity), missing sensors are discovered. */
function bpcResolve(config, hass) {
  const c = Object.assign({}, BPC_DEFAULTS, config || {});
  if (!c.systolic_entity && c.sys_entity) c.systolic_entity = c.sys_entity;
  if (!c.diastolic_entity && c.dia_entity) c.diastolic_entity = c.dia_entity;
  if (!BPC_GUIDELINES[c.guideline]) c.guideline = bpcDefaultGuideline(hass);
  if (!c.systolic_entity || !c.diastolic_entity) {
    const found = bpcDiscover(hass);
    if (!c.systolic_entity && !c.diastolic_entity) {
      c.systolic_entity = found.systolic;
      c.diastolic_entity = found.diastolic;
      if (!("pulse_entity" in (config || {}))) c.pulse_entity = found.pulse;
    }
  }
  c.history_days = Math.min(365, Math.max(7, Math.round(Number(c.history_days) || BPC_DEFAULTS.history_days)));
  return c;
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/* Value changes of one sensor from recorder states ({s, lu} or {state,
   last_updated}): a numeric value different from the previous numeric value.
   Values restored after a restart (same value again, possibly after
   unavailable) are not changes; the first value is only the baseline. */
function bpcChanges(rows) {
  const out = [];
  let prev = null;
  for (const r of rows || []) {
    const v = bpcNumber(r.s !== undefined ? r.s : r.state);
    if (v === null) continue;
    const raw = r.lu !== undefined ? r.lu : (r.lc !== undefined ? r.lc : r.last_updated);
    const t = typeof raw === "number" ? (raw < 1e11 ? raw * 1000 : raw) : Date.parse(raw);
    if (prev !== null && Math.abs(v - prev) > BPC_FLAT && isFinite(t)) out.push({ t, v });
    prev = v;
  }
  return out;
}

/* Readings from the recorder history of the two sensors: changes of either
   value within BPC_PAIR_MS form one reading with the latest value of each. */
function bpcReadings(sysRows, diaRows) {
  const events = bpcChanges(sysRows).map((e) => ({ t: e.t, k: "s", v: e.v }))
    .concat(bpcChanges(diaRows).map((e) => ({ t: e.t, k: "d", v: e.v })))
    .sort((a, b) => a.t - b.t);
  const last = { s: null, d: null };
  for (const rows of [[sysRows, "s"], [diaRows, "d"]]) {
    const first = (rows[0] || []).find((r) => bpcNumber(r.s !== undefined ? r.s : r.state) !== null);
    if (first) last[rows[1]] = bpcNumber(first.s !== undefined ? first.s : first.state);
  }
  const readings = [];
  let cur = null;
  for (const e of events) {
    if (cur && e.t - cur.start <= BPC_PAIR_MS) {
      last[e.k] = e.v;
    } else {
      if (cur) readings.push({ t: cur.start, systolic: last.s, diastolic: last.d });
      cur = { start: e.t };
      last[e.k] = e.v;
    }
  }
  if (cur) readings.push({ t: cur.start, systolic: last.s, diastolic: last.d });
  return readings.filter((r) => r.systolic !== null || r.diastolic !== null);
}

function bpcSummary(values) {
  if (!values.length) return null;
  let sum = 0;
  for (const v of values) sum += v;
  return { min: Math.min.apply(null, values), max: Math.max.apply(null, values), mean: sum / values.length };
}

/* Daily min / mean / max of the readings, by local day. */
function bpcDaysFromReadings(readings) {
  const days = {};
  for (const r of readings) {
    const key = bpcDayKey(r.t);
    (days[key] = days[key] || []).push(r);
  }
  const out = {};
  for (const key of Object.keys(days)) {
    const list = days[key];
    out[key] = {
      date: key,
      source: "readings",
      count: list.length,
      systolic: bpcSummary(list.map((r) => r.systolic).filter((v) => v !== null)),
      diastolic: bpcSummary(list.map((r) => r.diastolic).filter((v) => v !== null))
    };
  }
  return out;
}

/* Days with readings from daily long-term statistics: flat days (minimum
   equal to maximum) are the previous reading carried over and are left out. */
function bpcDaysFromStatistics(sysRows, diaRows) {
  const axis = (rows) => {
    const out = {};
    for (const r of rows || []) {
      if (r.min == null || r.max == null || r.mean == null) continue;
      const t = typeof r.start === "number" ? (r.start < 1e11 ? r.start * 1000 : r.start) : Date.parse(r.start);
      out[bpcDayKey(t)] = { min: r.min, max: r.max, mean: r.mean };
    }
    return out;
  };
  const s = axis(sysRows), d = axis(diaRows);
  const out = {};
  for (const key of Object.keys(Object.assign({}, s, d))) {
    const moved = [s[key], d[key]].some((a) => a && a.max - a.min > BPC_FLAT);
    if (moved) out[key] = { date: key, source: "statistics", count: null, systolic: s[key] || null, diastolic: d[key] || null };
  }
  return out;
}

/* Exact days from the recorder history from rawFrom on, statistics before. */
function bpcMergeDays(readingDays, statisticDays, rawFrom) {
  const from = rawFrom ? bpcDayKey(rawFrom) : null;
  const out = {};
  for (const key of Object.keys(statisticDays)) {
    if (!from || key < from || (key === from && !readingDays[key])) out[key] = statisticDays[key];
  }
  for (const key of Object.keys(readingDays)) out[key] = readingDays[key];
  return Object.keys(out).sort().map((k) => out[k]);
}

/* Mean of the daily means of the last 7 local days (today included). */
function bpcAverage(days, now) {
  const from = bpcDayKey((now || Date.now()) - 6 * BPC_DAY);
  const recent = days.filter((d) => d.date >= from);
  const mean = (axis) => {
    const v = recent.map((d) => d[axis] && d[axis].mean).filter((x) => typeof x === "number");
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const sys = mean("systolic"), dia = mean("diastolic");
  return sys === null || dia === null ? null : { systolic: sys, diastolic: dia, days: recent.length };
}

/* ------------------------------------------------------------------ */
/* Editor schema                                                       */
/* ------------------------------------------------------------------ */

function bpcEditorSchema(lang) {
  const sensor = { entity: { domain: "sensor" } };
  return [
    { name: "systolic_entity", selector: sensor },
    { name: "diastolic_entity", selector: sensor },
    { name: "pulse_entity", selector: sensor },
    {
      name: "guideline",
      selector: {
        select: {
          mode: "dropdown",
          options: Object.keys(BPC_GUIDELINES).map((k) => ({ value: k, label: bpcT(lang, "ed_" + k) }))
        }
      }
    },
    {
      type: "grid", name: "", schema: [
        { name: "title", selector: { text: {} } },
        { name: "icon", selector: { icon: {} } },
        { name: "history_days", selector: { number: { min: 7, max: 365, mode: "box" } } },
        { name: "show_history", selector: { boolean: {} } },
        { name: "show_average", selector: { boolean: {} } },
        { name: "show_reference", selector: { boolean: {} } }
      ]
    }
  ];
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

const BPC_STYLE = `
ha-card{padding:12px 16px 14px;overflow:hidden}
.head{display:flex;align-items:center;gap:10px;padding:2px 0 10px}
.hic{width:38px;height:38px;min-width:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--red-color,#f44336);background:color-mix(in srgb,var(--red-color,#f44336) 20%,transparent)}
.hic ha-icon{--mdc-icon-size:21px;display:block;line-height:0}
.ht{flex:1;min-width:0}
.htitle{font-size:16px;font-weight:600;color:var(--primary-text-color);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hsub{font-size:11.5px;color:var(--secondary-text-color);line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.big{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.vals{cursor:pointer;display:flex;align-items:baseline;gap:8px}
.bigval{font-size:30px;font-weight:700;line-height:1;color:var(--primary-text-color)}
.slash{color:var(--secondary-text-color)}
.bigunit{font-size:13px;color:var(--secondary-text-color)}
.chip{margin-left:auto;font-size:12px;font-weight:700;border-radius:12px;padding:4px 12px;color:#fff;white-space:nowrap}
.row{margin-bottom:12px;cursor:pointer}
.rowhead{display:flex;align-items:baseline;gap:6px;margin-bottom:6px}
.rlab{font-size:12px;font-weight:600;text-transform:uppercase;color:var(--secondary-text-color)}
.rval{font-size:15px;font-weight:700}
.rzone{font-size:11.5px;font-weight:600;margin-left:auto}
.bandwrap{position:relative;padding-bottom:14px}
.band{position:relative;display:flex;height:10px;border-radius:5px}
.seg{height:100%}
.seg.first{border-radius:5px 0 0 5px}.seg.last{border-radius:0 5px 5px 0}
.marker{position:absolute;top:-3px;width:16px;height:16px;border-radius:50%;box-sizing:border-box;border:2.5px solid var(--card-background-color,#1c1c1c);transform:translateX(-8px);transition:left .4s ease}
.ticks{position:absolute;left:0;right:0;top:12px;height:12px}
.tick{position:absolute;transform:translateX(-50%);font-size:9.5px;color:var(--secondary-text-color)}
.wait{font-size:12px;color:var(--secondary-text-color);margin:-4px 0 10px}
.hist{margin-top:4px;padding-top:10px;border-top:1px solid var(--divider-color)}
.histhead{font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--secondary-text-color);margin-bottom:6px}
.plot{width:100%;position:relative}
.plot svg{display:block;width:100%;height:auto;cursor:crosshair}
.grid-line{stroke:color-mix(in srgb,var(--primary-text-color) 12%,transparent)}
.day-line{stroke:color-mix(in srgb,var(--primary-text-color) 7%,transparent)}
.ylab{font:400 10px sans-serif;fill:var(--secondary-text-color)}
.xlab{font:500 10px sans-serif;fill:var(--secondary-text-color);text-anchor:middle}
.msg{font-size:12px;color:var(--secondary-text-color);padding:10px 0;text-align:center}
.empty{padding:16px;text-align:center}
.empty .t{font-size:14px;font-weight:600;color:var(--primary-text-color);margin-bottom:4px}
.empty .h{font-size:12px;color:var(--secondary-text-color)}
.tip{position:absolute;top:2px;left:0;pointer-events:none;z-index:2;background:var(--card-background-color,#1c1c1c);border:1px solid var(--divider-color);border-radius:10px;padding:7px 10px;font-size:11.5px;color:var(--primary-text-color);white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.15)}
.tiph{font-weight:700;margin-bottom:3px}
.tiprow{color:var(--secondary-text-color);line-height:1.5}
.tipv{color:var(--primary-text-color);font-weight:600}
.tipn{color:var(--secondary-text-color);font-size:10.5px;margin-top:2px}
.foot{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid var(--divider-color)}
.fitem{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--primary-text-color);font-weight:600}
.fitem ha-icon{--mdc-icon-size:16px;display:block;line-height:0}
.pulse{cursor:pointer}
.pulse ha-icon{color:var(--red-color,#f44336)}
.avg ha-icon{color:var(--secondary-text-color)}
.flab{font-weight:400;color:var(--secondary-text-color)}
.ref{margin-left:auto;font-size:11px;color:var(--secondary-text-color);white-space:nowrap}
[hidden]{display:none !important}
@media (prefers-reduced-motion: reduce){.marker{transition:none}}
`;

class BloodPressureCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  static async getConfigElement() {
    return document.createElement(BPC_EDITOR_TAG);
  }

  setConfig(config) {
    this._config = Object.assign({}, config || {});
    this._built = false;
    this._sig = null;
    this._histSig = null;
    this._hist = null;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return this._config && this._config.show_history === false ? 4 : 7;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  connectedCallback() {
    if (!this._timer) this._timer = setInterval(() => this._maybeFetch(true), BPC_HOUR);
  }

  disconnectedCallback() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _root() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    return this.shadowRoot;
  }

  _empty(lang) {
    this._built = false;
    this._layout = null;
    this._root().innerHTML = `<style>${BPC_STYLE}</style><ha-card><div class="empty"><div class="t">${bpcEsc(bpcT(lang, "no_sensors"))}</div><div class="h">${bpcEsc(bpcT(lang, "no_sensors_hint"))}</div></div></ha-card>`;
  }

  _scales(g) {
    const s = g.systolic, d = g.diastolic;
    return {
      sys: { min: 90, max: Math.max(190, s[s.length - 1] + 20), cuts: s },
      dia: { min: 50, max: Math.max(120, d[d.length - 1] + 10), cuts: d }
    };
  }

  _band(g, scale, id) {
    const span = scale.max - scale.min;
    const n = g.categories.length;
    const widths = [];
    let prev = scale.min;
    for (let i = 0; i < n; i++) {
      const to = i < scale.cuts.length ? scale.cuts[i] : scale.max;
      widths.push([i, Math.max(0, to - prev)]);
      prev = Math.max(prev, to);
    }
    const shown = widths.filter((w) => w[1] > 0);
    let segs = "", ticks = "";
    shown.forEach((w, k) => {
      const cls = "seg" + (k === 0 ? " first" : "") + (k === shown.length - 1 ? " last" : "");
      segs += `<div class="${cls}" style="width:${(w[1] / span * 100).toFixed(2)}%;background:${bpcColor(w[0], n)}"></div>`;
    });
    const seen = {};
    for (const cut of scale.cuts) {
      if (seen[cut]) continue;
      seen[cut] = 1;
      ticks += `<span class="tick" style="left:${((cut - scale.min) / span * 100).toFixed(2)}%">${cut}</span>`;
    }
    return `<div class="bandwrap"><div class="band">${segs}<div class="marker" id="${id}_mk" hidden></div></div><div class="ticks">${ticks}</div></div>`;
  }

  _build(c, lang) {
    const g = BPC_GUIDELINES[c.guideline];
    const sc = this._scales(g);
    const title = c.title || c.name || bpcT(lang, "default_title");
    this._root().innerHTML = `<style>${BPC_STYLE}</style>
<ha-card>
  <div class="head"><div class="hic"><ha-icon icon="${bpcEsc(c.icon || "mdi:heart-pulse")}"></ha-icon></div>
    <div class="ht"><div class="htitle">${bpcEsc(title)}</div><div class="hsub" id="hsub"></div></div></div>
  <div class="big"><div class="vals" id="vals" role="button" tabindex="0"><span class="bigval"><span id="v_sys">--</span><span class="slash">/</span><span id="v_dia">--</span></span>
    <span class="bigunit">mmHg</span></div><span class="chip" id="chip" hidden></span></div>
  <div class="wait" id="wait" hidden>${bpcEsc(bpcT(lang, "no_values"))}</div>
  <div class="row" id="row_sys" data-entity="sys" role="button" tabindex="0"><div class="rowhead"><span class="rlab">${bpcEsc(bpcT(lang, "systolic"))}</span>
    <span class="rval" id="rv_sys">--</span><span class="rzone" id="rz_sys"></span></div>${this._band(g, sc.sys, "sys")}</div>
  <div class="row" id="row_dia" data-entity="dia" role="button" tabindex="0"><div class="rowhead"><span class="rlab">${bpcEsc(bpcT(lang, "diastolic"))}</span>
    <span class="rval" id="rv_dia">--</span><span class="rzone" id="rz_dia"></span></div>${this._band(g, sc.dia, "dia")}</div>
  <div class="hist" id="hist" hidden><div class="histhead">${bpcEsc(bpcT(lang, "history", { n: c.history_days }))}</div>
    <div class="plot" id="plot"><div class="msg">${bpcEsc(bpcT(lang, "loading"))}</div></div></div>
  <div class="foot" id="foot" hidden>
    <div class="fitem pulse" id="pulse" data-entity="pulse" role="button" tabindex="0" hidden><ha-icon icon="mdi:heart"></ha-icon><span id="pv"></span></div>
    <div class="fitem avg" id="avg" hidden><ha-icon icon="mdi:chart-line"></ha-icon><span class="flab">${bpcEsc(bpcT(lang, "average"))}</span><span id="av"></span></div>
    <div class="ref" id="ref" hidden></div>
  </div>
</ha-card>`;
    const root = this.shadowRoot;
    const open = (ev) => {
      const el = ev.target.closest && ev.target.closest("[data-entity],#vals");
      if (!el) return;
      if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
      const which = el.id === "vals" ? "sys" : el.dataset.entity;
      const id = which === "sys" ? this._c.systolic_entity : which === "dia" ? this._c.diastolic_entity : this._c.pulse_entity;
      if (!id) return;
      if (ev.type === "keydown") ev.preventDefault();
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
    };
    root.querySelector("ha-card").addEventListener("click", open);
    root.querySelector("ha-card").addEventListener("keydown", open);
    this._built = true;
  }

  _setRow(key, v, scale, g, lang) {
    const $ = (id) => this.shadowRoot.getElementById(id);
    const mk = $(key + "_mk"), rv = $("rv_" + key), rz = $("rz_" + key), big = $("v_" + key);
    if (v === null) {
      mk.hidden = true;
      rv.textContent = "--";
      rv.style.color = "var(--secondary-text-color)";
      rz.textContent = "";
      big.textContent = "--";
      big.style.color = "";
      return;
    }
    const zi = bpcLevel(v, scale.cuts);
    const color = bpcColor(zi, g.categories.length);
    mk.hidden = false;
    mk.style.left = Math.max(0, Math.min(100, (v - scale.min) / (scale.max - scale.min) * 100)) + "%";
    mk.style.background = color;
    rv.textContent = Math.round(v);
    rv.style.color = color;
    rz.textContent = bpcT(lang, "c_" + g.categories[zi]);
    rz.style.color = color;
    big.textContent = Math.round(v);
    big.style.color = color;
  }

  _render() {
    const h = this._hass;
    if (!h || !this._config) return;
    const lang = bpcLang(h);
    const c = bpcResolve(this._config, h);
    this._c = c;
    if (!c.systolic_entity || !c.diastolic_entity) return this._empty(lang);
    const layout = JSON.stringify([c.guideline, c.title, c.name, c.icon, c.history_days, lang]);
    if (!this._built || layout !== this._layout) {
      this._build(c, lang);
      this._layout = layout;
      this._sig = null;
      if (this._hist) this._renderHist();
    }
    const g = BPC_GUIDELINES[c.guideline];
    const sc = this._scales(g);
    const sys = bpcNum(h, c.systolic_entity), dia = bpcNum(h, c.diastolic_entity);
    const pulse = bpcNum(h, c.pulse_entity);
    this._maybeFetch(false);
    const last = this._hist && this._hist.last;
    const when = last ? (last.exact ? bpcT(lang, "measured", { when: bpcRelative(h, last.t) })
      : bpcT(lang, "measured_on", { date: new Date(last.t).toLocaleDateString(bpcLocale(h), { day: "numeric", month: "short" }) })) : "";
    const avg = this._hist && this._hist.average;
    const sig = [sys, dia, pulse, when, avg && avg.systolic, avg && avg.diastolic, c.show_average, c.show_reference, c.show_history].join("|");
    if (sig === this._sig) return;
    this._sig = sig;

    const $ = (id) => this.shadowRoot.getElementById(id);
    $("hsub").textContent = [bpcT(lang, "g_" + c.guideline), when].filter(Boolean).join(" " + BPC_DOT + " ");
    this._setRow("sys", sys, sc.sys, g, lang);
    this._setRow("dia", dia, sc.dia, g, lang);
    $("wait").hidden = !(sys === null || dia === null);
    const chip = $("chip");
    chip.hidden = sys === null || dia === null;
    if (!chip.hidden) {
      const ci = bpcClassify(g, sys, dia);
      chip.textContent = bpcT(lang, "c_" + g.categories[ci]);
      chip.style.background = bpcColor(ci, g.categories.length);
    }
    const showPulse = pulse !== null;
    const showAvg = c.show_average !== false && !!avg;
    const showRef = c.show_reference !== false;
    $("pulse").hidden = !showPulse;
    if (showPulse) $("pv").textContent = Math.round(pulse) + " bpm";
    $("avg").hidden = !showAvg;
    if (showAvg) $("av").textContent = Math.round(avg.systolic) + "/" + Math.round(avg.diastolic);
    $("ref").hidden = !showRef;
    if (showRef) {
      $("ref").textContent = bpcT(lang, "reference", { label: bpcT(lang, "c_" + g.categories[0]), sys: g.systolic[0], dia: g.diastolic[0] });
    }
    $("foot").hidden = !(showPulse || showAvg || showRef);
    $("hist").hidden = c.show_history === false;
  }

  /* History: on first render, when a value changes, and every hour. */
  _maybeFetch(force) {
    const c = this._c, h = this._hass;
    if (!h || !c || !this._built || this._loading) return;
    if (c.show_history === false && c.show_average === false) return;
    const st = (id) => (id && h.states[id] ? h.states[id].state : "");
    const sig = [c.systolic_entity, c.diastolic_entity, c.history_days, st(c.systolic_entity), st(c.diastolic_entity)].join("|");
    if (!force && sig === this._histSig) return;
    this._histSig = sig;
    this._fetch(c);
  }

  async _fetch(c) {
    const h = this._hass;
    this._loading = true;
    const ids = [c.systolic_entity, c.diastolic_entity];
    const end = new Date();
    end.setHours(24, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - c.history_days);
    const now = new Date();
    const range = { start_time: start.toISOString(), end_time: now.toISOString() };
    try {
      const [raw, stats] = await Promise.all([
        h.callWS(Object.assign({
          type: "history/history_during_period", entity_ids: ids, minimal_response: true,
          no_attributes: true, significant_changes_only: false
        }, range)).catch(() => ({})),
        h.callWS(Object.assign({
          type: "recorder/statistics_during_period", statistic_ids: ids, period: "day",
          types: ["min", "max", "mean"]
        }, range)).catch(() => ({}))
      ]);
      const sysRaw = (raw && raw[ids[0]]) || [], diaRaw = (raw && raw[ids[1]]) || [];
      const firsts = [sysRaw[0], diaRaw[0]].filter(Boolean).map((r) => {
        const v = r.lu !== undefined ? r.lu : r.last_updated;
        return typeof v === "number" ? (v < 1e11 ? v * 1000 : v) : Date.parse(v);
      }).filter((t) => isFinite(t));
      const rawFrom = firsts.length ? Math.max.apply(null, firsts) : null;
      const readings = bpcReadings(sysRaw, diaRaw);
      const days = bpcMergeDays(bpcDaysFromReadings(readings),
        bpcDaysFromStatistics(stats && stats[ids[0]], stats && stats[ids[1]]), rawFrom)
        .filter((d) => d.date >= bpcDayKey(start.getTime()));
      let last = null;
      if (readings.length) last = { t: readings[readings.length - 1].t, exact: true };
      else if (days.length) last = { t: bpcDayStart(days[days.length - 1].date) + BPC_DAY / 2, exact: false };
      this._hist = { days, last, average: bpcAverage(days), start: start.getTime(), end: end.getTime(), n: c.history_days };
      this._sig = null;
      this._renderHist();
      this._render();
    } catch (e) {
      const plot = this.shadowRoot && this.shadowRoot.getElementById("plot");
      if (plot) plot.innerHTML = `<div class="msg">${bpcEsc(bpcT(bpcLang(h), "history_error"))}</div>`;
    }
    this._loading = false;
  }

  _dayLevel(d, g) {
    return bpcClassify(g, d.systolic ? d.systolic.mean : null, d.diastolic ? d.diastolic.mean : null);
  }

  _renderHist() {
    const d = this._hist, c = this._c, h = this._hass;
    const plot = this.shadowRoot && this.shadowRoot.getElementById("plot");
    if (!plot || !d || !c) return;
    const lang = bpcLang(h);
    const g = BPC_GUIDELINES[c.guideline];
    const days = d.days.filter((x) => x.systolic || x.diastolic);
    if (!days.length) {
      plot.innerHTML = `<div class="msg">${bpcEsc(bpcT(lang, "no_history"))}</div>`;
      return;
    }
    let lo = Infinity, hi = -Infinity;
    for (const x of days) {
      for (const b of [x.systolic, x.diastolic]) {
        if (!b) continue;
        lo = Math.min(lo, b.min);
        hi = Math.max(hi, b.max);
      }
    }
    const pad = (hi - lo) * 0.08 + 2;
    lo -= pad;
    hi += pad;
    const step = bpcNiceStep((hi - lo) / 4.5);
    const W = 480, H = 210, L = 6, R = 442, T = 8, B = 178;
    this._geom = { W, L, R };
    const yOf = (v) => B - (v - lo) / (hi - lo) * (B - T);
    const xOf = (ms) => L + (ms - d.start) / (d.end - d.start) * (R - L);
    let svg = "";
    for (let v = Math.ceil(lo / step) * step; v <= hi + 0.001; v += step) {
      const y = yOf(v);
      svg += `<line class="grid-line" x1="${L}" y1="${y.toFixed(1)}" x2="${R}" y2="${y.toFixed(1)}"/><text class="ylab" x="${R + 6}" y="${(y + 3.5).toFixed(1)}">${Math.round(v)}</text>`;
    }
    const weekly = d.n <= 45;
    for (const dt = new Date(d.start); dt.getTime() < d.end; dt.setDate(dt.getDate() + 1)) {
      if (weekly ? dt.getDay() !== 1 : dt.getDate() !== 1) continue;
      const x = xOf(dt.getTime()).toFixed(1);
      const label = dt.toLocaleDateString(bpcLocale(h), weekly ? { day: "numeric", month: "numeric" } : { month: "short" });
      svg += `<line class="day-line" x1="${x}" y1="${T}" x2="${x}" y2="${B}"/><text class="xlab" x="${x}" y="${B + 14}">${bpcEsc(label)}</text>`;
    }
    const slot = (R - L) / d.n;
    svg += `<rect id="hband" x="0" y="${T}" width="${Math.max(1, slot).toFixed(1)}" height="${B - T}" rx="3" fill="color-mix(in srgb,var(--primary-text-color) 9%,transparent)" visibility="hidden" pointer-events="none"/>`;
    const bw = Math.max(2.2, Math.min(6, slot * 0.42));
    this._points = [];
    for (const x of days) {
      const ms = bpcDayStart(x.date);
      const cx = xOf(ms + BPC_DAY / 2);
      const color = bpcColor(this._dayLevel(x, g), g.categories.length);
      const fade = x.source === "statistics" ? ' opacity="0.6"' : "";
      if (x.systolic && x.diastolic) {
        svg += `<line x1="${cx.toFixed(1)}" y1="${yOf(x.systolic.max).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yOf(x.diastolic.min).toFixed(1)}" stroke="${color}" stroke-width="1.2" opacity="0.45"/>`;
      }
      for (const b of [x.systolic, x.diastolic]) {
        if (!b) continue;
        let yA = yOf(b.max), yB = yOf(b.min);
        if (yB - yA < bw) {
          const mid = (yA + yB) / 2;
          yA = mid - bw / 2;
          yB = mid + bw / 2;
        }
        svg += `<line x1="${cx.toFixed(1)}" y1="${yA.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yB.toFixed(1)}" stroke="${color}" stroke-width="${bw.toFixed(1)}" stroke-linecap="round"${fade}/>`;
      }
      this._points.push({ ms, cx, x });
    }
    plot.innerHTML = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${svg}</svg><div class="tip" id="tip" hidden></div>`;
    this._bindHover(plot, xOf, g, lang);
  }

  _bindHover(plot, xOf, g, lang) {
    const svg = plot.querySelector("svg"), tip = plot.querySelector("#tip"), band = plot.querySelector("#hband");
    const h = this._hass;
    const hide = () => {
      tip.hidden = true;
      band.setAttribute("visibility", "hidden");
    };
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
      const vx = px * this._geom.W / r.width;
      if (vx < this._geom.L || vx > this._geom.R) return hide();
      let best = null;
      for (const p of this._points) if (!best || Math.abs(p.cx - vx) < Math.abs(best.cx - vx)) best = p;
      if (!best || Math.abs(best.cx - vx) > (this._geom.R - this._geom.L) / this._hist.n * 3.5) return hide();
      band.setAttribute("x", xOf(best.ms).toFixed(1));
      band.setAttribute("visibility", "visible");
      const x = best.x, zi = this._dayLevel(x, g);
      const row = (name, b) => !b ? "" :
        `<div class="tiprow">${name} ${bpcEsc(bpcT(lang, "min"))} <span class="tipv">${Math.round(b.min)}</span> ${BPC_DOT} ${bpcEsc(bpcT(lang, "mean"))} <span class="tipv">${Math.round(b.mean)}</span> ${BPC_DOT} ${bpcEsc(bpcT(lang, "max"))} <span class="tipv">${Math.round(b.max)}</span></div>`;
      const note = x.source === "statistics" ? bpcT(lang, "from_statistics") : x.count === 1 ? bpcT(lang, "reading") : bpcT(lang, "readings", { n: x.count });
      const day = new Date(best.ms).toLocaleDateString(bpcLocale(h), { weekday: "short", day: "numeric", month: "numeric" });
      tip.innerHTML = `<div class="tiph">${bpcEsc(day)} <span style="color:${bpcColor(zi, g.categories.length)}">${bpcEsc(bpcT(lang, "c_" + g.categories[zi]))}</span></div>` +
        row("SYS", x.systolic) + row("DIA", x.diastolic) + `<div class="tipn">${bpcEsc(note)}</div>`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(r.width - tw - 4, px - tw / 2)) + "px";
    };
    svg.addEventListener("mousemove", move);
    svg.addEventListener("mouseleave", hide);
    svg.addEventListener("touchstart", move, { passive: true });
    svg.addEventListener("touchend", hide);
  }
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

async function bpcEnsureHaForm() {
  if (customElements.get("ha-form")) return;
  try {
    const helpers = await window.loadCardHelpers();
    const card = await helpers.createCardElement({ type: "entities", entities: [] });
    if (card && card.constructor && card.constructor.getConfigElement) await card.constructor.getConfigElement();
  } catch (e) {
    /* ha-form is defined by the dashboard editor anyway */
  }
  await Promise.race([customElements.whenDefined("ha-form"), new Promise((r) => setTimeout(r, 2000))]);
}

/* A clean configuration: no empty values, no defaults, options of earlier
   versions renamed. */
function bpcCleanConfig(config) {
  const out = Object.assign({}, config);
  if (out.sys_entity && !out.systolic_entity) out.systolic_entity = out.sys_entity;
  if (out.dia_entity && !out.diastolic_entity) out.diastolic_entity = out.dia_entity;
  delete out.sys_entity;
  delete out.dia_entity;
  for (const k of Object.keys(out)) {
    if (out[k] === "" || out[k] === undefined || out[k] === null) delete out[k];
    else if (k in BPC_DEFAULTS && out[k] === BPC_DEFAULTS[k]) delete out[k];
  }
  out.type = "custom:" + BPC_TAG;
  return out;
}

class BloodPressureCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = Object.assign({}, config);
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  async _update() {
    if (!this._hass || !this._config) return;
    if (!this._form) {
      await bpcEnsureHaForm();
      if (this._form) return;
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => (s.name ? bpcT(bpcLang(this._hass), "ed_" + s.name) : "");
      this._form.addEventListener("value-changed", (ev) => {
        this._config = bpcCleanConfig(Object.assign({}, this._config, ev.detail.value || {}));
        this.dispatchEvent(new CustomEvent("config-changed", {
          detail: { config: JSON.parse(JSON.stringify(this._config)) }, bubbles: true, composed: true
        }));
      });
      this.appendChild(this._form);
    }
    const lang = bpcLang(this._hass);
    const shown = bpcResolve(this._config, this._hass);
    this._form.hass = this._hass;
    this._form.schema = bpcEditorSchema(lang);
    this._form.data = {
      systolic_entity: shown.systolic_entity || undefined,
      diastolic_entity: shown.diastolic_entity || undefined,
      pulse_entity: shown.pulse_entity || undefined,
      guideline: shown.guideline,
      title: this._config.title,
      icon: this._config.icon,
      history_days: shown.history_days,
      show_history: shown.show_history !== false,
      show_average: shown.show_average !== false,
      show_reference: shown.show_reference !== false
    };
  }
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

if (customElements.get(BPC_TAG)) {
  console.warn("BLOOD-PRESSURE-CARD: another copy of the card is already loaded; remove the duplicate resource.");
} else {
  customElements.define(BPC_TAG, BloodPressureCard);
  customElements.define(BPC_EDITOR_TAG, BloodPressureCardEditor);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: BPC_TAG,
    name: "Blood Pressure Card",
    description: "Blood pressure on the bands of the ESH, ESC or ACC/AHA guideline, with category, pulse, 7-day average and history.",
    preview: true,
    documentationURL: BPC_REPO_URL
  });
  console.info("%c BLOOD-PRESSURE-CARD %c v" + BPC_VERSION + " ",
    "background:#e53935;color:#fff;border-radius:4px 0 0 4px;padding:2px 6px",
    "background:#444;color:#fff;border-radius:0 4px 4px 0;padding:2px 6px");
}
