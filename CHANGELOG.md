# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Look realigned with the original inline card (v2.0.2), with every current feature kept:
  - ESH 2023 bands with five segments on the scales 90–190 and 50–120 mmHg, as in the original; the
    classification keeps grade 3, shown as *Hypertension 3* with the marker at the end of the red segment;
  - spacing, tooltip and marker as in the original; the whole value row opens the systolic sensor and holds
    the category chip;
  - subtitle "ESC/ESH guidelines · measured 2 h ago", relative times "just now", "N min ago", "N h ago",
    "N d ago", and reference "Optimal: below 120/80 mmHg (ESC)" (the other guidelines show their name);
  - no "Waiting for the first reading" line: missing values show "--";
  - history header "60-day history", Monday labels as day/month up to 90 days, days estimated from the
    statistics at full opacity, tooltip with the weekday, the category and the SYS / DIA rows only.
- New defaults: `history_days` 60 (was 30) and `show_average` false (was true).

## [1.1.0] - 2026-11-21

### Added

- **Create helpers** button in the visual editor (administrators only): in one click it creates an
  `input_datetime` with the time of the last measurement, an automation that sets it at every new
  measurement, and two template sensors "Blood pressure systolic today" / "diastolic today" whose daily
  long-term statistics hold an exact and permanent history, then links them to the card. Existing helpers
  with the same names are reused, so pressing it again never creates duplicates. The helpers are optional:
  without them the card works as in 1.0.0.
- New options `last_entity`, `systolic_today_entity` and `diastolic_today_entity`, in a new editor section
  "Helpers for history and automations".
- The history uses the daily statistics of the "today" sensors, marked *from the daily sensors* in the
  tooltip: after the start of the recorder history exact readings come first, on its first day the
  helpers, before it the helpers and then the statistics of the monitor's sensors.
- The time of the last measurement also comes from the `input_datetime` helper when it is more recent than
  the recorder history; a change of the helper reloads the history.
- YAML package `examples/packages/blood_pressure.yaml` with the same helpers, for those who prefer YAML.

## [1.0.0] - 2026-11-18

First public release.

### Added

- Card for blood pressure monitors: last reading on the bands of the ESH 2023, ESC 2024 or ACC/AHA 2025
  guideline, category of each value and of the reading, pulse, 7-day average, time of the last
  measurement and a guideline reference.
- Automatic discovery of the systolic, diastolic and pulse sensors of any integration, independent of the
  language; per-sensor overrides.
- Daily history (7-365 days) with min, mean and max per value: exact readings from the recorder history,
  older days from the long-term statistics; values restored after a restart are not counted.
- Grade 3 hypertension (>= 180/110 mmHg) in the ESH bands, missing in earlier inline versions of the card.
- The options `sys_entity` and `dia_entity` of earlier inline versions still work; the editor renames them.
- English and Italian localization of the card and of the visual editor.
- Native look: theme colours, light and dark mode, sections layout, keyboard accessible, reduced motion.
- Warning in the browser console when two copies of the card are loaded.
- Unit tests, browser end-to-end tests, HACS validation and release workflows.

[Unreleased]: https://github.com/artech-lab/blood-pressure-card/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/artech-lab/blood-pressure-card/releases/tag/v1.1.0
[1.0.0]: https://github.com/artech-lab/blood-pressure-card/releases/tag/v1.0.0
