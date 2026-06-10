# Changelog

All notable changes to IdeaMiner MVP.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-06-10

### Changed
- **Full English localization.** All user-facing strings, the system prompt in
  `js/openai-llm-provider.js`, the 34 mock ideas, and all documentation are now
  in English. The Web Speech API voice input is still `zh-CN` (configurable in
  `js/voice.js`).
- README demo link now points to the live GitHub Pages deployment
  (`https://darrenwongkawa.github.io/ideaminer-mvp/`).

### Added
- GitHub Pages enabled on the repository (build source: GitHub Actions); the
  workflow auto-deploys on every push to `main`.

## [0.2.0] - 2026-06-09

### Changed
- **Polish release.** Comprehensive UX pass: page transitions, focus indicators,
  and a unified brand color.
- Restructured README with hero / features / demo / quick-start / deployment
  sections for an OSS-ready first impression.
- Expanded mock-ideas dataset from 12 to 34 entries spanning 7 fields
  (Physics / Chemistry / Biology / Computer Science / Mathematics / Materials
  Science / Interdisciplinary).

### Added
- Real LLM provider (OpenAI-compatible): `js/openai-llm-provider.js`.
- `createProvider()` factory in `js/llm-provider.js` to switch between Mock and
  OpenAI providers at runtime.
- Settings page (`#/settings`) with provider toggle and API-key input.
- 4th bottom-nav item: ⚙️ Settings.
- Voice input: pulse animation + better error toasts when Web Speech API fails.
- GitHub Pages auto-deploy workflow (`.github/workflows/deploy.yml`).
- `.nojekyll` to disable Jekyll processing of the static site.
- Favicon (inline SVG, no extra HTTP request).

## [0.1.0] - 2026-06-09

### Added
- Initial MVP — fully static, no build step, browser-only.
- 4 pages: Refine Profile / Explore Ideas / Saved / Profile.
- Hash-based routing (`#/profile`, `#/explore`, `#/saved`, `#/my`).
- Mock LLM with 12 hand-written ideas across 6 fields.
- 3-dimension reviewer (FNV-1a hash-based deterministic scores for Innovation
  / Feasibility / Importance).
- LocalStorage persistence for profile, favorites, and feedback history.
- Voice input via Web Speech API (zh-CN), feature-detected.
- `AbortController` wired through IdeaGenerator → LLMProvider for clean
  request cancellation on route switch.
- LICENSE (MIT).
