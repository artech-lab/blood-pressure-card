# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: Blood Pressure Card

Home Assistant dashboard card (Lovelace custom card) for blood pressure monitors of any integration. It is
distributed through HACS (category `plugin`, shown as "Dashboard"; from Home Assistant 2026.11 HACS is
built in as the Marketplace).

Answer the maintainer in the language they write in. Code, comments, commit messages and the English
README stay in English.

## Commands

```bash
npm run check        # syntax check of the card
npm test             # unit tests (node:test, no dependencies, Node 20+); CI runs them with TZ=UTC
node --test --test-name-pattern="discovery" tests/card.test.mjs   # a single unit test, by name
npm install && npx playwright install chromium   # once, for the two commands below
npm run test:e2e     # browser tests with a simulated Home Assistant (a few seconds)
npm run screenshots  # regenerates images/preview.png and images/light-it.png with demo data
```

`CHROME_PATH=/path/to/chrome` makes the two Playwright commands use an installed browser instead of the one
downloaded by `npx playwright install`.

The unit tests reach the card's functions only through the `globalThis.__api` list built at the top of
`tests/card.test.mjs`: add a new top-level function there before testing it. `tests/e2e.mjs` is a plain
sequential script (one shared page, plain `assert`), not a test runner, so it cannot run one case alone.

ASCII check (also in CI): `grep -nP '[^\x00-\x7F]' dist/blood-pressure-card.js` must print nothing.

Slash commands: `/publish` (first publication on GitHub, release, HACS default store) and
`/release X.Y.Z` (later versions). Maintainer notes: `PUBLISHING.md`.

## Layout

| Path | Content |
| --- | --- |
| `dist/blood-pressure-card.js` | The whole card: one dependency-free file, no build step. HACS serves it as is |
| `tests/card.test.mjs` | Unit tests: the card runs in a `vm` sandbox, top-level functions are tested directly |
| `tests/e2e.mjs` | Playwright tests with stub `ha-card` / `ha-icon` / `ha-form` and a mocked `hass` (`callWS`) |
| `scripts/screenshots.cjs` | Builds the README images from a fictional monitor with simulated history and statistics |
| `examples/` | `minimal.yaml`, `full.yaml` |
| `README.md`, `README.it.md` | English and Italian documentation: keep them aligned |
| `hacs.json`, `.github/workflows/` | HACS metadata, validation (HACS action + tests) and release workflows |

## Architecture of the card file

In order: constants and defaults (`BPC_DEFAULTS`), the guidelines `BPC_GUIDELINES`, colour palettes
`BPC_PALETTES` (one per number of categories), discovery words `BPC_WORDS`, dictionary `BPC_I18N`
(`en`, `it`), helpers, discovery (`bpcDiscover`, `bpcResolve`), history (`bpcChanges`, `bpcReadings`,
`bpcDaysFromReadings`, `bpcDaysFromStatistics`, `bpcMergeDays`, `bpcAverage`), editor schema, CSS, the card
class `BloodPressureCard`, the editor `BloodPressureCardEditor` (`bpcCleanConfig`), registration.

- **Guidelines**: each one lists its categories and, per value, the lower bound of every category after the
  first. A reading takes the higher category of the two values (`bpcClassify`). A repeated bound makes a
  category unreachable by that value alone (ACC/AHA "elevated" needs a diastolic below 80); the band
  drawing skips zero-width segments. A new guideline needs: an entry in `BPC_GUIDELINES`, `g_<key>`,
  `ed_<key>` and `c_<category>` in both languages, a palette if its number of categories is new, a table in
  both READMEs and classification tests.
- **Discovery**: sensors in mmHg matched by words in entity id, friendly name and translation key
  (`BPC_WORDS`), pair on the same device first; pulse = bpm sensor of that device, `pulse` before `heart`,
  averages last. Hidden and diagnostic entities are skipped. The pulse is guessed only when neither
  pressure sensor is configured.
- **History**: two WebSocket calls, `history/history_during_period` (minimal, no attributes, all changes)
  and `recorder/statistics_during_period` (period `day`). Raw history -> value changes (baseline and
  restored values ignored) -> readings (changes within `BPC_PAIR_MS` paired) -> exact days. Statistics only
  for the days before the raw history starts (flat days dropped). Fetched on first render, when a source
  value changes, and every hour.
- **Updates**: `set hass` runs at every state change; the DOM is built once per layout (`_layout`) and
  updated in place only when a signature of the shown values changes (`_sig`). Clicks and keys are
  delegated from `ha-card`.
- **Compatibility**: `sys_entity` / `dia_entity` of the earlier inline card are accepted
  (`bpcResolve`) and renamed by the editor (`bpcCleanConfig`); keep it that way.

## Rules

1. `dist/blood-pressure-card.js` is ASCII only. Write non-ASCII characters as `\uXXXX` escapes and run
   the ASCII check after every edit: some tools silently turn escapes into real characters.
2. Every user-visible string goes into `BPC_I18N`, in **both** `en` and `it`, with the same placeholders
   (`{n}`). Unit tests fail otherwise, including missing editor labels (`ed_<option>`).
3. Plain JavaScript custom elements, no Lit, no imports, no bundler, no runtime dependencies.
4. Values coming from Home Assistant or the configuration are inserted with `textContent` or escaped with
   `bpcEsc()`.
5. Never put personal data in the repository: no names, e-mails, locations, time zones, real entity ids,
   blood pressure values of a real person or details of a specific Home Assistant instance. Images use
   fictional demo data only (`npm run screenshots`). Copyright holder: "The blood-pressure-card
   contributors".
6. Until `/publish` runs, the repository owner is the placeholder `GITHUB_USER`. Do not hardcode another
   owner; `/publish` replaces it everywhere except in `PUBLISHING.md`, `CLAUDE.md` and `.claude/`.
7. Version lives in three places: `BPC_VERSION` in the card, `version` in `package.json`, `CHANGELOG.md`.
   The release workflow fails if the tag `vX.Y.Z` does not match.
8. User-facing changes: update `CHANGELOG.md` (section `Unreleased`) and both READMEs; regenerate the
   images when the look of the card changes.
9. Medical content: categories and thresholds must match the cited guidelines; the card never diagnoses
   and the READMEs keep the disclaimer.

## Trying it on a Home Assistant instance

Copy `dist/blood-pressure-card.js` to `/config/www/` and add the resource
`/local/blood-pressure-card.js?v=N` (type JavaScript module), bumping `N` to bypass caches; or add the
GitHub repository to HACS as a custom repository of type Dashboard. Remove other copies of the resource
(including an inline one with the same tag): the console warns about duplicates.
