# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/artech-lab/blood-pressure-card/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/artech-lab/blood-pressure-card/releases/tag/v1.0.0
