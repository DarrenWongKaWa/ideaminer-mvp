# Changelog

All notable changes to IdeaMiner MVP.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-06-09

### Changed
- **Polish release.** Comprehensive UX pass: page transitions, focus indicators,
  and a unified brand color.
- Restructured README with hero / features / demo / quick-start / deployment
  sections for an OSS-ready first impression.
- Expanded mock-ideas dataset from 12 to 34 entries spanning 7 fields
  (物理学 / 化学 / 生物学 / 计算机科学 / 数学 / 材料科学 / 跨学科).

### Added
- Real LLM provider (OpenAI-compatible): `js/openai-llm-provider.js`.
- `createProvider()` factory in `js/llm-provider.js` to switch between Mock and
  OpenAI providers at runtime.
- Settings page (`#/settings`) with provider toggle and API-key input.
- 4th bottom-nav item: ⚙️ 设置.
- Voice input: pulse animation + better error toasts when Web Speech API fails.
- GitHub Pages auto-deploy workflow (`.github/workflows/deploy.yml`).
- `.nojekyll` to disable Jekyll processing of the static site.
- Favicon (inline SVG, no extra HTTP request).

## [0.1.0] - 2026-06-09

### Added
- Initial 丐版 MVP — fully static, no build step, browser-only.
- 4 pages: 完善科研画像 / 灵感探索 / 收藏 / 我的.
- Hash-based routing (`#/profile`, `#/explore`, `#/saved`, `#/my`).
- Mock LLM with 12 hand-written ideas across 6 fields.
- 3-dimension reviewer (FNV-1a hash-based deterministic scores for 创新 /
  可行 / 重要).
- LocalStorage persistence for profile, favorites, and feedback history.
- Voice input via Web Speech API (zh-CN), feature-detected.
- `AbortController` wired through IdeaGenerator → LLMProvider for clean
  request cancellation on route switch.
- LICENSE (MIT).