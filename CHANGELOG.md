# Changelog

All notable changes to IdeaMiner MVP.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.5.1] - 2026-06-10

### Fixed
- **Critical regression on first random pick after page load** —
  the v0.5.0 refactor that introduced `_mergedPool()` in
  `MockLLMProvider.generateIdea` removed the `await this._load()`
  that v0.4.0 had. On a fresh page, `this._cache` is `null` so
  the merged pool was `[...userIdeas, ...null]` = just user
  ideas, and clicking "Next idea" with no user ideas yet threw
  `MockLLMProvider: no ideas available (mock-ideas.json empty
  and no user ideas)`. Fix: restore the `await this._load()`
  before computing the merged pool. (Caught by the live site
  smoke test; the v0.5.0 unit smoke test was non-representative
  because it pre-loaded the cache.)

## [0.5.0] - 2026-06-10

### Added
- **Add your own idea**: a new `#/new` page lets the user fill a form
  (field, question, background, significance, methods) with text or
  voice input (the same `VoiceInput` class, `zh-CN`, with the live
  interim result filling the textarea), then save to localStorage
  and join the explore / search pool.
- "✨ Your idea" badge on user-submitted cards in the explore flow.
  The badge is rendered whenever the displayed `ReviewedIdea` has
  `_user: true` or its id starts with `user-`.
- "My Ideas" section on `#/my` (after the feedback stats) with a
  per-row **Delete** button (with `window.confirm`) and a **+ Add
  new** button in the section header. Empty state shows a hint
  pointing to the **+ Add new** button.
- "+ Add your own idea" pill button below the search row on the
  Explore Ideas page, plus a second copy inside the "No idea
  matched" empty-state CTA.
- `Storage.addUserIdea(draft, reviewer)` — generates a `user-…` id,
  runs `MockReviewer` (when supplied) for 3-dim scores, persists
  under `ideaminer.user-ideas.v1`. Async review upgrade is patched
  into the record in place, so the sync return value is
  immediately usable. The reviewer is also exposed via
  `state.generator.reviewer` so callers can reuse the same scoring
  pipeline that powers the explore flow.
- `Storage.getUserIdeas()` — returns the user-submitted list,
  newest first.
- `Storage.deleteUserIdea(id)` — removes an entry by id, returns
  `true` if removed.
- `Storage.getMergedIdeas()` — async accessor that fetches
  `data/mock-ideas.json` and prepends the user-ideas list, so a
  future backend storage can be a single integration point.
- `MockLLMProvider.setUserIdeas(ideas)` / `getUserIdeas()` — set
  the user pool; subsequent `generateIdea()` calls draw from the
  merged `[user, mock]` array (user first, so they appear early
  in random exploration). Also propagates into `getIdeas()` so
  the search path (`IdeaGenerator._loadIdeas()` →
  `llm.getIdeas()`) sees user ideas too.
- `MockLLMProvider.getLastPick()` — returns the original id,
  field, `isUser` flag, and review of the most recent
  `generateIdea()` pick, so the `IdeaGenerator` can preserve the
  user-idea id (and `_user: true` flag) when wrapping the draft
  into a `ReviewedIdea`. The base `LLMProvider.getLastPick()`
  returns `null`, so real LLM providers need no change.
- `app.js` boot path: `rebuildProvider()` now calls
  `syncUserIdeasIntoProvider()` after each provider swap, and
  `addUserIdea` / `deleteUserIdea` call it again so the pool
  stays in sync without rebuilding the generator.
- CSS: `.form-page` / `.form-page__field` / `.form-page__field-label`
  (with `--required` modifier) / `.form-page__field-hint` /
  `.form-page__voice-row` / `.form-page__textarea` /
  `.form-page__mic` / `.form-page__actions`,
  `.badge--yours` (mint/amber gradient), `.explore__add-button`
  (pill), `.empty__cta-row`, `.my-ideas-list` /
  `.my-ideas-item` / `.my-ideas-item__delete`, `.badge--field`,
  plus a 360 px breakpoint for `.my-ideas-item`.

### Changed
- `IdeaGenerator.next` and `nextWithQuery` now preserve the
  user-idea id (no `search-` prefix, no fresh `rv-` id) and reuse
  the user-idea's review scores, so the user sees stable scores
  on their own idea and feedback / save continue to dedupe
  correctly.
- `renderExploreIdea()` renders the "✨ Your idea" badge inside
  the existing `.card__badges` flex row, before the three
  Innovation / Feasibility / Importance badges.
- `renderExploreNoMatch()` shows the new "+ Add your own idea"
  CTA inside the empty-state action row.

### Notes
- The real LLM provider (`OpenAILLMProvider`) does not yet merge
  user ideas into the search / random pool; that's a v0.6
  follow-up. In mock mode (the default), everything works
  end-to-end.
- No export / import — user ideas live in your browser's
  `localStorage` only. Clearing site data loses them.

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
