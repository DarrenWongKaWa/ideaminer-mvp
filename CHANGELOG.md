# Changelog

All notable changes to IdeaMiner MVP.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-06-10

### Added
- **Search by text or voice** on the Explore Ideas page. The user can
  type a free-form query or tap 🎤 to speak one; the app finds the
  best-matching idea from the 34 hand-written entries and shows a
  small "🔍 Matched: <query>" badge above the question.
- `js/idea-search.js`: a new module exporting `tokenizeQuery`,
  `scoreIdea`, and `bestMatch`. Tokenizer lowercases, splits on
  non-word characters, drops tokens shorter than 2 chars, and
  deduplicates. The scorer awards +3 per token in `question`,
  +2 per token in `background` / `significance`, +1 per token in
  any of `methods[i]`, and a +1 bonus if the token appears in
  `field`. Score 0 means "no match".
- `IdeaGenerator.nextWithQuery(profile, query, signal)`: empty
  query falls back to the regular random flow; non-empty query
  runs through `bestMatch` and, on a hit, returns a `ReviewedIdea`
  with the original idea id preserved (prefixed with `search-`)
  and `_matchedQuery` / `_score` attached for the badge. On no
  match, throws a recognizable `Error("No idea matched '<query>'")`
  so `app.js` can render the "Surprise me" empty state.
- `MockLLMProvider.getIdeas()`: a public accessor for the already-
  loaded ideas array (awaits the in-flight first load).
- Search row UI in `app.js`: text input + 🎤 voice button + Search
  button + Clear (×) button. Voice input reuses the existing
  `VoiceInput` class (zh-CN) and auto-submits on the final
  utterance. The 4 feedback buttons (Like / Dislike / Unrelated /
  Copy) still work unchanged on a matched idea. Voice permission
  denied, no-speech, and audio-capture errors each show a clear
  toast.
- CSS: `.search` row, `.search__input`, `.search__mic`,
  `.search__submit`, `.search__clear`, `.search__match-badge`. The
  320-360 px mobile breakpoint is explicitly handled so the row
  does not overflow.
- README: "Search by text or voice" feature line under Features
  and a new "🔍 How search works" section explaining the scoring
  algorithm and the design choice of keeping the scorer a separate
  module.

### Notes
- Search query is not persisted in `localStorage` (kept simple for
  v0.4.0; a "recent searches" row is a candidate for v0.5).
- The real LLM provider (`OpenAILLMProvider`) does not implement
  `getIdeas()`, so search in OpenAI mode currently shows the
  "no match" empty state. Wiring the query into the LLM prompt
  is a future-work item.

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
