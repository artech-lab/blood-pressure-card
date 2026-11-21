// Regenerates the README images with fictional demo data (no real readings).
// The last 10 days come from a simulated recorder history (exact readings), older days from simulated
// long-term statistics, as on a real instance with the default recorder retention.
// Needs the dev dependencies:  npm install && npx playwright install chromium
// Run with:  npm run screenshots   (CHROME_PATH=/path/to/chrome to use another browser)
const { chromium } = require("playwright");
const mdi = require("@mdi/js");
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const CARD = path.join(ROOT, "dist", "blood-pressure-card.js");
const OUT = path.join(ROOT, "images");
const ORIGIN = "http://ha.local";

const icons = { "mdi:heart-pulse": mdi.mdiHeartPulse, "mdi:heart": mdi.mdiHeart, "mdi:chart-line": mdi.mdiChartLine };

const THEMES = {
  dark: "--primary-color:#03a9f4;--primary-text-color:#e1e1e1;--secondary-text-color:#9b9b9b;--card-background-color:#1c1c1c;--divider-color:rgba(225,225,225,.12);background:#111111;",
  light: "--primary-color:#03a9f4;--primary-text-color:#212121;--secondary-text-color:#727272;--card-background-color:#ffffff;--divider-color:rgba(0,0,0,.12);background:#fafafa;"
};
const html = (theme) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:20px;font-family:Inter,Roboto,"DejaVu Sans",sans-serif;-webkit-font-smoothing:antialiased;${THEMES[theme]}}
#host{width:430px}</style></head><body><div id="host"></div><script>
const ICONS = ${JSON.stringify(icons)};
customElements.define("ha-card", class extends HTMLElement { constructor(){ super(); this.attachShadow({mode:"open"}).innerHTML =
 '<style>:host{display:block;background:var(--card-background-color);border-radius:12px;border:1px solid var(--divider-color);color:var(--primary-text-color);box-sizing:border-box;overflow:hidden}</style><slot></slot>'; } });
customElements.define("ha-icon", class extends HTMLElement {
  static get observedAttributes(){ return ["icon"]; }
  connectedCallback(){ this.render(); } attributeChangedCallback(){ this.render(); }
  render(){ if(!this.shadowRoot) this.attachShadow({mode:"open"}); const p = ICONS[this.getAttribute("icon")] || "";
    this.shadowRoot.innerHTML = '<style>:host{display:inline-flex;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px)}svg{width:100%;height:100%;fill:currentColor}</style><svg viewBox="0 0 24 24"><path d="'+p+'"/></svg>'; }
});
</script></body></html>`;

/* fictional monitor: registry, states, recorder history and statistics */
function demo(lang, now) {
  const H = 3600000, DAY = 86400000;
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const midnight = (n) => { const d = new Date(now - n * DAY); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const sysRaw = [], diaRaw = [], sysStats = [], diaStats = [];
  let last = { s: 132, d: 85 };
  for (let n = 55; n >= 0; n--) {
    const skip = n % 7 === 3 || n % 11 === 5;
    const count = skip ? 0 : rand() < 0.45 ? 2 : 1;
    const day = { s: [], d: [] };
    for (let k = 0; k < count; k++) {
      const t = midnight(n) + (k === 0 ? 7.5 : 20.2) * H + rand() * 1800000;
      if (n === 0 && t > now - 2 * H) continue;
      const s = Math.round(120 + rand() * 18 + (n > 35 ? 6 : 0)), d = Math.round(76 + rand() * 11 + (n > 35 ? 3 : 0));
      day.s.push([t, s]);
      day.d.push([t + 3000, d]);
    }
    if (n === 0) { day.s.push([now - 2 * H, 126]); day.d.push([now - 2 * H + 3000, 81]); }
    if (n <= 9) {
      for (const [t, v] of day.s) sysRaw.push({ s: String(v), lu: t / 1000 });
      for (const [t, v] of day.d) diaRaw.push({ s: String(v), lu: t / 1000 });
    } else {
      const stat = (prev, vals) => {
        const all = [prev].concat(vals.map((x) => x[1]));
        return { start: midnight(n), min: Math.min(...all), max: Math.max(...all), mean: all.reduce((a, b) => a + b) / all.length };
      };
      sysStats.push(stat(last.s, day.s));
      diaStats.push(stat(last.d, day.d));
    }
    if (day.s.length) last = { s: day.s[day.s.length - 1][1], d: day.d[day.d.length - 1][1] };
  }
  // the raw history starts 10 days ago with the value carried over from before
  sysRaw.unshift({ s: String(sysStats[sysStats.length - 1].mean), lu: midnight(9) / 1000 - 60 });
  diaRaw.unshift({ s: String(diaStats[diaStats.length - 1].mean), lu: midnight(9) / 1000 - 60 });
  const ids = ["sensor.arm_monitor_systolic", "sensor.arm_monitor_diastolic", "sensor.arm_monitor_pulse"];
  const keys = ["systolic_blood_pressure", "diastolic_blood_pressure", "heart_pulse"];
  const values = ["126", "81", "66"], units = ["mmHg", "mmHg", "bpm"];
  const states = {}, entities = {};
  ids.forEach((id, i) => {
    states[id] = { state: values[i], attributes: { unit_of_measurement: units[i] } };
    entities[id] = { entity_id: id, device_id: "demo_monitor", platform: "demo", translation_key: keys[i] };
  });
  return {
    hass: { language: lang, locale: { language: lang }, states, entities, config: { country: "IT" } },
    raw: { [ids[0]]: sysRaw, [ids[1]]: diaRaw },
    stats: { [ids[0]]: sysStats, [ids[1]]: diaStats }
  };
}

(async () => {
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const shot = async (file, theme, lang) => {
    const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 470, height: 1200 } });
    page.on("pageerror", (e) => console.error("PAGE ERROR", e.message));
    await page.route(ORIGIN + "/**", (route) => route.fulfill({ contentType: "text/html", body: html(theme) }));
    await page.goto(ORIGIN + "/");
    await page.addScriptTag({ path: CARD });
    await page.evaluate((d) => {
      d.hass.callWS = async (msg) => (msg.type === "history/history_during_period" ? d.raw : d.stats);
      const card = document.createElement("blood-pressure-card");
      card.setConfig({ type: "custom:blood-pressure-card" });
      document.getElementById("host").appendChild(card);
      card.hass = d.hass;
      window.card = card;
    }, demo(lang, Date.now()));
    await page.waitForFunction(() => window.card.shadowRoot.querySelector("#plot svg"));
    await page.waitForTimeout(800);
    await page.locator("#host").screenshot({ path: file });
    await page.close();
    console.log("wrote", path.relative(ROOT, file));
  };
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "bpc-shots-"));
  await shot(path.join(tmp, "dark-en.png"), "dark", "en");
  await shot(path.join(OUT, "light-it.png"), "light", "it");

  /* composite preview: English dark on the left, Italian light on the right */
  const b64 = (f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64");
  const fig = (f, t) => `<figure><img src="${b64(f)}"><figcaption>${t}</figcaption></figure>`;
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1100, height: 1400 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:Inter,Roboto,"DejaVu Sans",sans-serif;-webkit-font-smoothing:antialiased}
    #c{display:inline-flex;gap:28px;align-items:flex-start;padding:30px 32px 26px;background:#111111;}
    figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}
    img{width:470px;display:block}
    figcaption{color:#9b9b9b;font-size:15px;letter-spacing:.2px}
  </style></head><body><div id="c">
    ${fig(path.join(tmp, "dark-en.png"), "ESH 2023 guideline, dark theme")}
    ${fig(path.join(OUT, "light-it.png"), "Italian, light theme")}
  </div></body></html>`);
  await page.waitForTimeout(300);
  await page.locator("#c").screenshot({ path: path.join(OUT, "preview.png") });
  await page.close();
  console.log("wrote images/preview.png");
  fs.rmSync(tmp, { recursive: true, force: true });
  await browser.close();
})();
