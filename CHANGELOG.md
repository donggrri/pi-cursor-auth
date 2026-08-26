# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/morizkay/pi-cursor-auth/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/morizkay/pi-cursor-auth/releases/tag/v0.1.1
[0.1.0]: https://www.npmjs.com/package/pi-cursor-auth/v/0.1.0
