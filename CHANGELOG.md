# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-08-27

### Changed

- README rewritten as public install docs (npm/git install and uninstall, settings, `/login`)
- Changelog version links point at GitHub instead of mixed npm/GitHub URLs
- Link [`pi-cursor-sdk`](https://www.npmjs.com/package/pi-cursor-sdk) as the conflicting alternative
- [AGENTS.md](https://github.com/morizkay/pi-cursor-auth/blob/main/AGENTS.md) for contributors working in this repo

## [0.1.1] - 2026-08-27

### Added

- Changelog
- GitHub Release so the repo has a tagged version besides npm

## [0.1.0] - 2026-08-26

Initial public release. Minimal pi extension that uses a Cursor SDK API key as a model provider.

### Added

- `cursor` provider backed by `@cursor/sdk`, streaming thinking and text into pi
- API key resolution from `CURSOR_API_KEY`, pi `/login`, or `/cursor-auth`
- `/cursor-auth [key]` to store the key in `~/.pi/agent/auth.json`
- `/cursor-refresh-models` to reload the live Cursor model catalog
- Unknown model ids (including `auto-smart`) mapped to `cursor/default`
- Per-session Cursor agent reuse across follow-up turns
- Unit tests plus a live integration test against Cursor

### Fixed

- Streamed assistant text and thinking accumulated into a single pi block per turn (Cursor emits one word per chunk; without this, each word rendered on its own line)

[Unreleased]: https://github.com/morizkay/pi-cursor-auth/compare/v0.1.2...main
[0.1.2]: https://github.com/morizkay/pi-cursor-auth/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/morizkay/pi-cursor-auth/compare/579fc344fd29e85c1b2667c2d9a82f79dddbec87...v0.1.1
[0.1.0]: https://github.com/morizkay/pi-cursor-auth/tree/579fc344fd29e85c1b2667c2d9a82f79dddbec87
